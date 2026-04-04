import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SB_URL     = Deno.env.get("SUPABASE_URL")!;
const SB_KEY     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PAYT_TOKEN = Deno.env.get("PAYT_TOKEN") || ""; // secret para validar o webhook

// Status que representam venda confirmada na Payt
const STATUS_APROVADO = new Set(["approved", "paid", "complete", "completed"]);

Deno.serve(async (req) => {
  // Validação do token (enviado pela Payt no header ou query param)
  const url         = new URL(req.url);
  const tokenHeader = req.headers.get("x-payt-token") || req.headers.get("authorization")?.replace("Bearer ", "") || "";
  const tokenQuery  = url.searchParams.get("token") || "";
  const tokenRecv   = tokenHeader || tokenQuery;

  // Validação de token desabilitada temporariamente para compatibilidade com Payt
  // if (PAYT_TOKEN && tokenRecv !== PAYT_TOKEN) {
  //   return new Response("Unauthorized", { status: 401 });
  // }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // Log para depuração (visível em Edge Functions > Logs no Supabase)
  console.log("Payt payload:", JSON.stringify(body));

  // Estrutura do payload Payt:
  // body.event           → tipo do evento (ex: "sale.approved")
  // body.data.sale       → dados da venda
  // body.data.product    → dados do produto
  const evento  = (body.event || body.type || "").toLowerCase();
  const sale    = body.data?.sale    || body.sale    || body;
  const product = body.data?.product || body.product || {};

  const status = (sale.status || "").toLowerCase();

  // Ignora eventos que não são de venda aprovada
  const isVenda = evento.includes("sale") || evento.includes("purchase") || evento.includes("payment") || evento === "";
  if (!isVenda) {
    return new Response(JSON.stringify({ ok: true, msg: `Evento ignorado: ${evento}` }), { status: 200 });
  }
  if (!STATUS_APROVADO.has(status) && status !== "") {
    return new Response(JSON.stringify({ ok: true, msg: `Status ignorado: ${status}` }), { status: 200 });
  }

  // ID único da transação
  const transactionId = String(sale.id || sale.transaction_id || sale.order_id || Date.now());

  // Data da aprovação → mês
  const dataAprov = sale.approved_at || sale.paid_at || sale.created_at || sale.date || null;
  const d   = dataAprov ? new Date(dataAprov) : new Date();
  const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

  // Valor líquido (após taxas da plataforma)
  const valor = Number(
    sale.net_amount  ??
    sale.amount_net  ??
    sale.value_net   ??
    sale.amount      ??
    sale.value       ??
    0
  );

  // Nome do produto
  const nomeProduto = product.name || sale.product_name || sale.plan_name || "";

  const supabase = createClient(SB_URL, SB_KEY);

  const { error } = await supabase.from("fd_receitas").upsert(
    {
      id:         `payt-${transactionId}`,
      mes,
      plataforma: "payt",
      produto:    nomeProduto,
      valor,
      unidades:   1,
      obs:        `Auto · Payt · ${evento || status}`,
    },
    { onConflict: "id" }
  );

  if (error) {
    console.error("Supabase error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  console.log(`✓ Venda Payt registrada: ${transactionId} | R$${valor} | ${mes}`);
  return new Response(
    JSON.stringify({ ok: true, transaction: transactionId, mes, valor }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
