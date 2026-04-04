import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Variáveis injetadas pelo Supabase automaticamente
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Seu hottok configurado como secret no Supabase
const HOTTOK = Deno.env.get("HOTTOK") || "";

// Eventos que representam uma venda confirmada
const EVENTOS_VENDA = new Set([
  "PURCHASE_COMPLETE",
  "PURCHASE_APPROVED",
  "PURCHASE_OUT_OF_SHOPPING_CART",
]);

Deno.serve(async (req) => {
  // Hotmart envia o hottok como query param ?hottok=xxx
  const url = new URL(req.url);
  const hottok = url.searchParams.get("hottok") || req.headers.get("x-hotmart-hottok") || "";

  if (HOTTOK && hottok !== HOTTOK) {
    return new Response("Unauthorized", { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const evento = body.event;

  // Ignora eventos que não são vendas (ex: abandono de carrinho, reembolso, etc.)
  if (!EVENTOS_VENDA.has(evento)) {
    return new Response(JSON.stringify({ ok: true, msg: `Evento ignorado: ${evento}` }), { status: 200 });
  }

  const data     = body.data;
  const purchase = data?.purchase;
  const product  = data?.product;

  // Só processa se aprovada
  if (!["APPROVED", "COMPLETE"].includes(purchase?.status)) {
    return new Response(JSON.stringify({ ok: true, msg: `Status ignorado: ${purchase?.status}` }), { status: 200 });
  }

  // Converte timestamp (ms) para "YYYY-MM"
  const ts  = purchase.approved_date || purchase.order_date || Date.now();
  const d   = new Date(ts);
  const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

  // Valor: preferência por price.value (após taxas), fallback full_price
  const valor = Number(purchase.price?.value ?? purchase.full_price?.value ?? 0);

  const supabase = createClient(SB_URL, SB_KEY);

  const { error } = await supabase.from("fd_receitas").upsert(
    {
      id:         purchase.transaction,
      mes,
      plataforma: "hotmart",
      produto:    product?.name || "",
      valor,
      unidades:   1,
      obs:        `Auto · ${evento}`,
    },
    { onConflict: "id" }
  );

  if (error) {
    console.error("Supabase error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  console.log(`✓ Venda registrada: ${purchase.transaction} | R$${valor} | ${mes}`);
  return new Response(
    JSON.stringify({ ok: true, transaction: purchase.transaction, mes, valor }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
