import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SB_URL        = Deno.env.get("SUPABASE_URL")!;
const SB_KEY        = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HM_BASIC      = Deno.env.get("HOTMART_BASIC")!;    // base64(client_id:client_secret)
const HM_CLIENT_ID  = Deno.env.get("HOTMART_CLIENT_ID")!;
const HM_CLIENT_SEC = Deno.env.get("HOTMART_CLIENT_SECRET")!;
const IMPORT_TOKEN  = Deno.env.get("IMPORT_TOKEN")!;     // senha para proteger este endpoint

// Busca access_token OAuth da Hotmart
async function getHotmartToken(): Promise<string> {
  const r = await fetch(
    `https://api-sec-vlc.hotmart.com/security/oauth/token?grant_type=client_credentials&client_id=${HM_CLIENT_ID}&client_secret=${HM_CLIENT_SEC}`,
    {
      method: "POST",
      headers: {
        "Authorization": `Basic ${HM_BASIC}`,
        "Content-Type": "application/json",
      },
    }
  );
  if (!r.ok) throw new Error(`Auth Hotmart falhou: ${await r.text()}`);
  const j = await r.json();
  return j.access_token;
}

// Busca todas as páginas de vendas aprovadas em um intervalo de datas
async function buscarVendas(token: string, startMs: number, endMs: number) {
  const vendas: any[] = [];
  let pageToken: string | null = null;

  do {
    const params = new URLSearchParams({
      transaction_status: "APPROVED,COMPLETE",
      start_date: String(startMs),
      end_date:   String(endMs),
      max_results: "500",
    });
    if (pageToken) params.set("page_token", pageToken);

    const r = await fetch(
      `https://developers.hotmart.com/payments/api/v1/sales/history?${params}`,
      { headers: { "Authorization": `Bearer ${token}` } }
    );

    if (!r.ok) throw new Error(`API Hotmart: ${await r.text()}`);
    const j = await r.json();

    const items = j.items || [];
    vendas.push(...items);
    pageToken = j.page_info?.next_page_token || null;

  } while (pageToken);

  return vendas;
}

Deno.serve(async (req) => {
  // Proteção por token
  const url   = new URL(req.url);
  const token = url.searchParams.get("token") || "";
  if (token !== IMPORT_TOKEN) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Parâmetro: ?mes=2025-01  (padrão: mês atual)
  const mesParam = url.searchParams.get("mes");
  const [ano, mo] = mesParam
    ? mesParam.split("-").map(Number)
    : [new Date().getFullYear(), new Date().getMonth() + 1];

  const startMs = new Date(ano, mo - 1, 1).getTime();
  const endMs   = new Date(ano, mo, 1).getTime() - 1;       // último ms do mês

  try {
    const hmToken = await getHotmartToken();
    const vendas  = await buscarVendas(hmToken, startMs, endMs);

    if (vendas.length === 0) {
      return new Response(JSON.stringify({ ok: true, importadas: 0, mes: mesParam }), { status: 200 });
    }

    // Mapeia para o formato do banco
    const rows = vendas.map((v: any) => {
      const purchase = v.purchase;
      const product  = v.product;
      const ts       = purchase.approved_date || purchase.order_date || startMs;
      const d        = new Date(ts);
      const mes      = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const valor    = Number(purchase.price?.value ?? purchase.full_price?.value ?? 0);

      return {
        id:         purchase.transaction,
        mes,
        plataforma: "hotmart",
        produto:    product?.name || "",
        valor,
        unidades:   1,
        obs:        "Importado via API",
      };
    });

    const supabase = createClient(SB_URL, SB_KEY);
    const { error } = await supabase
      .from("fd_receitas")
      .upsert(rows, { onConflict: "id" });

    if (error) throw new Error(error.message);

    return new Response(
      JSON.stringify({ ok: true, importadas: rows.length, mes: `${ano}-${String(mo).padStart(2,"0")}` }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  } catch (e: any) {
    console.error(e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
});
