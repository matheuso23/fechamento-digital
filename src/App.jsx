import React, { useState, useMemo, useCallback, useEffect } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";

// ─── SUPABASE ─────────────────────────────────────────────────────────────────
const SB_URL = import.meta.env.VITE_SB_URL || "";
const SB_KEY = import.meta.env.VITE_SB_KEY || "";
const SB_ON  = Boolean(SB_URL && SB_KEY);
const sbH    = {"Content-Type":"application/json","apikey":SB_KEY,"Authorization":`Bearer ${SB_KEY}`};
const sbUrl  = (t, qs="") => `${SB_URL}/rest/v1/${t}${qs}`;

const sbGet = async (table, qs="") => {
  const r = await fetch(sbUrl(table, qs), {headers:{...sbH,"Accept":"application/json"}});
  if (!r.ok) throw new Error(await r.text());
  return r.json();
};
const sbUpsert = async (table, data) => {
  const r = await fetch(sbUrl(table), {
    method:"POST",
    headers:{...sbH,"Prefer":"resolution=merge-duplicates"},
    body:JSON.stringify(Array.isArray(data) ? data : [data]),
  });
  if (!r.ok) throw new Error(await r.text());
};
const sbDelete = async (table, id, col="id") => {
  const r = await fetch(sbUrl(table, `?${col}=eq.${id}`), {method:"DELETE", headers:sbH});
  if (!r.ok) throw new Error(await r.text());
};

// ─── CONVERSORES DB ↔ FRONTEND ────────────────────────────────────────────────
const recFromDB  = r => ({id:r.id, mes:r.mes, plataforma:r.plataforma, produto:r.produto||"", valor:Number(r.valor), unidades:r.unidades, obs:r.obs||"", taxaPerc:r.taxa_perc??null, taxaFixa:r.taxa_fixa??null});
const recToDB    = d => ({id:d.id, mes:d.mes, plataforma:d.plataforma, produto:d.produto||"", valor:d.valor, unidades:d.unidades, obs:d.obs||"", taxa_perc:d.taxaPerc??null, taxa_fixa:d.taxaFixa??null});
const adFromDB   = r => ({id:r.id, mes:r.mes, plataforma:r.plataforma, campanha:r.campanha, investimento:Number(r.investimento), obs:r.obs||""});
const adToDB     = d => ({id:d.id, mes:d.mes, plataforma:d.plataforma, campanha:d.campanha, investimento:d.investimento, obs:d.obs||""});
const despFromDB = r => ({id:r.id, mes:r.mes, cat:r.cat, desc:r.descricao, valor:Number(r.valor), recorrente:r.recorrente, obs:r.obs||""});
const despToDB   = d => ({id:d.id, mes:d.mes, cat:d.cat, descricao:d.desc, valor:d.valor, recorrente:d.recorrente, obs:d.obs||""});
const prodFromDB = r => ({id:r.id, nome:r.nome, tipo:r.tipo, preco:Number(r.preco), ativo:r.ativo});
const prodToDB   = d => ({id:d.id, nome:d.nome, tipo:d.tipo, preco:d.preco, ativo:d.ativo});
const fechsFromDB= rows => rows.reduce((acc,r) => ({...acc,[r.mes]:{status:r.status, obs:r.obs||"", dataFechamento:r.data_fechamento||null}}), {});
const fechToDB   = (mes, d) => ({mes, status:d.status, obs:d.obs||"", data_fechamento:d.dataFechamento||null});

// ─── TEMA ─────────────────────────────────────────────────────────────────────
const C = {
  bg:"#09090f",    surface:"#0e1018",  card:"#131720",
  border:"#1d2535",dim:"#253045",      faint:"#334155",
  accent:"#6366f1",accentBg:"#0d0d24",
  green:"#22c55e", greenBg:"#05180c",
  red:"#f85149",   redBg:"#1c0808",
  yellow:"#eab308",yellowBg:"#1c1500",
  blue:"#3b82f6",  blueBg:"#060e22",
  purple:"#a855f7",purpleBg:"#130b1e",
  teal:"#14b8a6",  tealBg:"#051818",
  orange:"#f97316",orangeBg:"#1c0800",
  pink:"#ec4899",
  text:"#e2e8f0",  muted:"#64748b",
};

// ─── PLATAFORMAS DE VENDA ─────────────────────────────────────────────────────
// taxaPerc = % sobre o valor bruto  |  taxaFixa = R$ fixo por venda
const PLATS_REC = [
  {id:"hotmart",   label:"Hotmart",    icon:"🔥", cor:C.orange, taxaPerc:9.9,  taxaFixa:0   },
  {id:"payt",      label:"Payt",       icon:"💜", cor:C.purple, taxaPerc:4.99, taxaFixa:0   },
  {id:"eduzz",     label:"Eduzz",      icon:"⚡", cor:C.yellow, taxaPerc:4.99, taxaFixa:0   },
  {id:"monetizze", label:"Monetizze",  icon:"💎", cor:C.blue,   taxaPerc:9.9,  taxaFixa:0   },
  {id:"kiwify",    label:"Kiwify",     icon:"🥝", cor:C.green,  taxaPerc:9.99, taxaFixa:0   },
  {id:"braip",     label:"Braip",      icon:"🎯", cor:C.red,    taxaPerc:9.9,  taxaFixa:0   },
  {id:"lastlink",  label:"Lastlink",   icon:"🔗", cor:C.teal,   taxaPerc:4.9,  taxaFixa:0   },
  {id:"stripe",    label:"Stripe",     icon:"💳", cor:C.purple, taxaPerc:2.9,  taxaFixa:1.5 },
  {id:"outros",    label:"Outros",     icon:"💼", cor:C.muted,  taxaPerc:0,    taxaFixa:0   },
];

// Calcula o valor total de taxa de uma receita
// Usa taxaPerc/taxaFixa do lançamento se informados, senão usa o padrão da plataforma
function calcTaxa(valor, unidades, plat, taxaPercOver, taxaFixaOver) {
  const perc  = taxaPercOver != null ? Number(taxaPercOver) : plat.taxaPerc;
  const fixa  = taxaFixaOver != null ? Number(taxaFixaOver) : plat.taxaFixa;
  return valor * (perc / 100) + fixa * (unidades || 1);
}

// ─── PLATAFORMAS DE ANÚNCIOS ──────────────────────────────────────────────────
const PLATS_ADS = [
  {id:"meta",       label:"Meta Ads",   icon:"📘", cor:"#1877f2"},
  {id:"google",     label:"Google Ads", icon:"🔍", cor:C.red    },
  {id:"tiktok",     label:"TikTok Ads", icon:"🎵", cor:"#ff0050"},
  {id:"youtube",    label:"YouTube",    icon:"▶️", cor:C.red    },
  {id:"kwai",       label:"Kwai Ads",   icon:"📲", cor:C.orange },
  {id:"outros_ads", label:"Outros",     icon:"📢", cor:C.muted  },
];

// ─── CATEGORIAS DE DESPESA ────────────────────────────────────────────────────
const CATS_DESP = [
  {id:"email_mkt", label:"Email Marketing",      icon:"📧", cor:C.blue  },
  {id:"crm",       label:"CRM / Vendas",         icon:"👥", cor:C.purple},
  {id:"landing",   label:"Landing / Funil",      icon:"🖥️", cor:C.teal  },
  {id:"hosting",   label:"Hospedagem / DNS",     icon:"🌐", cor:C.green },
  {id:"design",    label:"Design / Criativo",    icon:"🎨", cor:C.pink  },
  {id:"video",     label:"Vídeo / Streaming",    icon:"📹", cor:C.red   },
  {id:"automacao", label:"Automação",            icon:"⚙️", cor:C.orange},
  {id:"conteudo",  label:"Produção de Conteúdo", icon:"✍️", cor:C.yellow},
  {id:"afiliados", label:"Afiliados / Comissões",icon:"🤝", cor:C.accent},
  {id:"equipe",    label:"Equipe / Freelancers", icon:"👷", cor:"#94a3b8"},
  {id:"contabil",  label:"Contabilidade / Jur.", icon:"⚖️", cor:C.muted },
  {id:"outros_d",  label:"Outros",               icon:"🔧", cor:C.faint },
];

const TIPOS_PRODUTO = [
  {id:"curso",      label:"Curso Online"},
  {id:"mentoria",   label:"Mentoria"},
  {id:"ebook",      label:"E-book"},
  {id:"material",   label:"Material / Pack"},
  {id:"servico",    label:"Serviço"},
  {id:"assinatura", label:"Assinatura / Recorrente"},
  {id:"outro",      label:"Outro"},
];

// ─── UTILITÁRIOS ──────────────────────────────────────────────────────────────
const fmtR  = v => (v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const fmtRk = v => {
  const a = Math.abs(v||0);
  if (a>=1e6) return `R$\u00A0${((v||0)/1e6).toFixed(2)}M`;
  if (a>=1e3) return `R$\u00A0${((v||0)/1e3).toFixed(1)}k`;
  return fmtR(v);
};
const uid    = () => `${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
const mesAtu = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; };
const mesLbl = m => {
  if (!m) return "";
  const [a,mo] = m.split("-");
  return ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"][+mo-1]+"/"+a.slice(2);
};
const mesBack  = (m,n) => { let [y,mo]=m.split("-").map(Number); mo-=n; while(mo<=0){mo+=12;y--;} return `${y}-${String(mo).padStart(2,"0")}`; };
const ultMeses = (n, from) => Array.from({length:n},(_,i)=>mesBack(from||mesAtu(),n-1-i));
const getPR = id => PLATS_REC.find(p=>p.id===id)||PLATS_REC.at(-1);
const getPA = id => PLATS_ADS.find(p=>p.id===id)||PLATS_ADS.at(-1);
const getCD = id => CATS_DESP.find(c=>c.id===id)||CATS_DESP.at(-1);

// ─── localStorage FALLBACK (quando não há Supabase) ───────────────────────────
function loadLS(key, fallback) {
  try { const s=localStorage.getItem(key); return s?JSON.parse(s):fallback; } catch { return fallback; }
}
function saveLS(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

// ─── DADOS DE DEMONSTRAÇÃO ────────────────────────────────────────────────────
const DM = ultMeses(3);

const DEMO_PRODS = [
  {id:"p1",nome:"Curso de Copywriting",  tipo:"curso",   preco:297, ativo:true },
  {id:"p2",nome:"Curso de Tráfego Pago", tipo:"curso",   preco:497, ativo:true },
  {id:"p3",nome:"Mentoria em Grupo",     tipo:"mentoria",preco:997, ativo:true },
  {id:"p4",nome:"Pack de Templates",     tipo:"material",preco:47,  ativo:true },
];
const DEMO_REC = [
  {id:"r1", mes:DM[0],plataforma:"hotmart",  produto:"p1",valor:14850,unidades:50,obs:""},
  {id:"r2", mes:DM[0],plataforma:"hotmart",  produto:"p2",valor:9940, unidades:20,obs:""},
  {id:"r3", mes:DM[0],plataforma:"kiwify",   produto:"p4",valor:2350, unidades:50,obs:""},
  {id:"r4", mes:DM[0],plataforma:"stripe",   produto:"p3",valor:5970, unidades:6, obs:""},
  {id:"r5", mes:DM[1],plataforma:"hotmart",  produto:"p1",valor:19610,unidades:66,obs:""},
  {id:"r6", mes:DM[1],plataforma:"hotmart",  produto:"p2",valor:14910,unidades:30,obs:""},
  {id:"r7", mes:DM[1],plataforma:"kiwify",   produto:"p4",valor:3290, unidades:70,obs:""},
  {id:"r8", mes:DM[1],plataforma:"monetizze",produto:"p3",valor:14955,unidades:15,obs:""},
  {id:"r9", mes:DM[2],plataforma:"hotmart",  produto:"p1",valor:22440,unidades:75,obs:""},
  {id:"r10",mes:DM[2],plataforma:"hotmart",  produto:"p2",valor:17415,unidades:35,obs:""},
  {id:"r11",mes:DM[2],plataforma:"kiwify",   produto:"p4",valor:4230, unidades:90,obs:""},
  {id:"r12",mes:DM[2],plataforma:"monetizze",produto:"p3",valor:19940,unidades:20,obs:"Recorde!"},
  {id:"r13",mes:DM[2],plataforma:"stripe",   produto:"p3",valor:4985, unidades:5, obs:""},
];
const DEMO_ADS = [
  {id:"a1",mes:DM[0],plataforma:"meta",  campanha:"Copy — Remarketing",    investimento:4200,obs:""},
  {id:"a2",mes:DM[0],plataforma:"google",campanha:"Copy — Search",         investimento:1800,obs:""},
  {id:"a3",mes:DM[1],plataforma:"meta",  campanha:"Tráfego — Topo Funil",  investimento:5800,obs:""},
  {id:"a4",mes:DM[1],plataforma:"meta",  campanha:"Tráfego — Retargeting", investimento:2200,obs:""},
  {id:"a5",mes:DM[1],plataforma:"google",campanha:"Tráfego — Search",      investimento:2100,obs:""},
  {id:"a6",mes:DM[1],plataforma:"tiktok",campanha:"Criativo Teste A",      investimento:1200,obs:"Teste"},
  {id:"a7",mes:DM[2],plataforma:"meta",  campanha:"Funil Completo",        investimento:7500,obs:""},
  {id:"a8",mes:DM[2],plataforma:"google",campanha:"Brand + Search",        investimento:2800,obs:""},
  {id:"a9",mes:DM[2],plataforma:"tiktok",campanha:"Criativo v2",           investimento:2200,obs:""},
];
const DEMO_DESP = [
  {id:"d1", mes:DM[0],cat:"email_mkt",desc:"ActiveCampaign",        valor:297, recorrente:true, obs:""},
  {id:"d2", mes:DM[0],cat:"landing",  desc:"ClickFunnels",           valor:297, recorrente:true, obs:""},
  {id:"d3", mes:DM[0],cat:"hosting",  desc:"Hostgator + Domínios",   valor:189, recorrente:true, obs:""},
  {id:"d4", mes:DM[0],cat:"design",   desc:"Canva Pro",              valor:54,  recorrente:true, obs:""},
  {id:"d5", mes:DM[0],cat:"automacao",desc:"Zapier",                 valor:197, recorrente:true, obs:""},
  {id:"d6", mes:DM[0],cat:"contabil", desc:"Contador",               valor:350, recorrente:true, obs:""},
  {id:"d7", mes:DM[0],cat:"equipe",   desc:"Designer Freelancer",    valor:1200,recorrente:false,obs:"Artes campanha"},
  {id:"d8", mes:DM[1],cat:"email_mkt",desc:"ActiveCampaign",        valor:297, recorrente:true, obs:""},
  {id:"d9", mes:DM[1],cat:"landing",  desc:"ClickFunnels",           valor:297, recorrente:true, obs:""},
  {id:"d10",mes:DM[1],cat:"hosting",  desc:"Hostgator + Domínios",   valor:189, recorrente:true, obs:""},
  {id:"d11",mes:DM[1],cat:"design",   desc:"Canva Pro",              valor:54,  recorrente:true, obs:""},
  {id:"d12",mes:DM[1],cat:"automacao",desc:"Zapier",                 valor:197, recorrente:true, obs:""},
  {id:"d13",mes:DM[1],cat:"contabil", desc:"Contador",               valor:350, recorrente:true, obs:""},
  {id:"d14",mes:DM[1],cat:"equipe",   desc:"Copywriter Freelancer",  valor:800, recorrente:false,obs:"Scripts"},
  {id:"d15",mes:DM[1],cat:"video",    desc:"Vimeo Pro",              valor:89,  recorrente:true, obs:""},
  {id:"d16",mes:DM[2],cat:"email_mkt",desc:"ActiveCampaign",        valor:297, recorrente:true, obs:""},
  {id:"d17",mes:DM[2],cat:"landing",  desc:"ClickFunnels",           valor:297, recorrente:true, obs:""},
  {id:"d18",mes:DM[2],cat:"hosting",  desc:"Hostgator + Domínios",   valor:189, recorrente:true, obs:""},
  {id:"d19",mes:DM[2],cat:"design",   desc:"Canva Pro",              valor:54,  recorrente:true, obs:""},
  {id:"d20",mes:DM[2],cat:"automacao",desc:"Zapier",                 valor:197, recorrente:true, obs:""},
  {id:"d21",mes:DM[2],cat:"contabil", desc:"Contador",               valor:350, recorrente:true, obs:""},
  {id:"d22",mes:DM[2],cat:"equipe",   desc:"Designer + Copy",        valor:2000,recorrente:false,obs:"Lançamento"},
  {id:"d23",mes:DM[2],cat:"video",    desc:"Vimeo Pro",              valor:89,  recorrente:true, obs:""},
  {id:"d24",mes:DM[2],cat:"crm",      desc:"HubSpot Starter",        valor:540, recorrente:true, obs:""},
];

// ─── ÁTOMOS UI ────────────────────────────────────────────────────────────────
function KPI({label,value,sub,color,topColor,small}) {
  const c = color||C.accent;
  return (
    <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:5,
                 padding:small?"9px 12px":"13px 16px",position:"relative",overflow:"hidden"}}>
      <div style={{position:"absolute",top:0,left:0,right:0,height:2,background:topColor||c}}/>
      <div style={{fontSize:10,color:C.muted,letterSpacing:1,marginBottom:4}}>{label}</div>
      <div style={{fontSize:small?14:20,fontWeight:700,color:c}}>{value}</div>
      {sub && <div style={{fontSize:10,color:C.muted,marginTop:3}}>{sub}</div>}
    </div>
  );
}
function Lbl({children}) {
  return <div style={{fontSize:10,color:C.muted,letterSpacing:1,marginBottom:4}}>{children}</div>;
}
function FInp({error,sx,...p}) {
  return <input {...p} style={{background:C.surface,border:`1px solid ${error?C.red:C.border}`,
    color:C.text,fontFamily:"inherit",fontSize:13,borderRadius:3,padding:"7px 10px",
    outline:"none",width:"100%",...sx}}/>;
}
function FSel({children,sx,...p}) {
  return (
    <select {...p} style={{background:C.surface,border:`1px solid ${C.border}`,
      color:C.text,fontFamily:"inherit",fontSize:13,borderRadius:3,padding:"7px 10px",
      outline:"none",width:"100%",...sx}}>
      {children}
    </select>
  );
}
function FTxt({sx,...p}) {
  return <textarea {...p} style={{background:C.surface,border:`1px solid ${C.border}`,
    color:C.text,fontFamily:"inherit",fontSize:13,borderRadius:3,padding:"7px 10px",
    outline:"none",width:"100%",resize:"vertical",...sx}}/>;
}
const BTN = {
  primary:{background:C.accent,  color:"#fff",  border:"none"},
  green:  {background:C.greenBg, color:C.green, border:`1px solid ${C.green}33`},
  red:    {background:C.redBg,   color:C.red,   border:`1px solid ${C.red}33`},
  ghost:  {background:"none",    color:C.muted, border:`1px solid ${C.dim}`},
  blue:   {background:C.blueBg,  color:C.blue,  border:`1px solid ${C.blue}33`},
  yellow: {background:C.yellowBg,color:C.yellow,border:`1px solid ${C.yellow}33`},
  orange: {background:C.orangeBg,color:C.orange,border:`1px solid ${C.orange}33`},
};
function Btn({v,sx,children,...p}) {
  return <button {...p} style={{...BTN[v||"ghost"],fontFamily:"inherit",fontSize:12,fontWeight:600,
    borderRadius:3,padding:"6px 13px",cursor:"pointer",...sx}}>{children}</button>;
}
function ProgBar({pct,color,h}) {
  return (
    <div style={{height:h||5,background:C.dim,borderRadius:2,overflow:"hidden"}}>
      <div style={{height:"100%",width:`${Math.min(100,pct||0)}%`,background:color||C.accent,
                   borderRadius:2,transition:"width .4s"}}/>
    </div>
  );
}
function Modal({title,sub,onClose,onSave,saveLabel,maxW,children}) {
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.87)",display:"flex",
                 alignItems:"center",justifyContent:"center",zIndex:500,padding:16}}>
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:6,
                   width:"100%",maxWidth:maxW||560,maxHeight:"92vh",overflowY:"auto"}}>
        <div style={{padding:"14px 20px",borderBottom:`1px solid ${C.border}`,display:"flex",
                     justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{fontSize:14,fontWeight:700}}>{title}</div>
            {sub && <div style={{fontSize:10,color:C.muted,letterSpacing:1,marginTop:2}}>{sub}</div>}
          </div>
          <Btn onClick={onClose} sx={{padding:"3px 8px"}}>✕</Btn>
        </div>
        <div style={{padding:"16px 20px",display:"flex",flexDirection:"column",gap:12}}>{children}</div>
        {onSave && (
          <div style={{padding:"12px 20px",borderTop:`1px solid ${C.border}`,display:"flex",
                       gap:8,justifyContent:"flex-end"}}>
            <Btn onClick={onClose}>Cancelar</Btn>
            <Btn v="primary" onClick={onSave}>{saveLabel||"Salvar"}</Btn>
          </div>
        )}
      </div>
    </div>
  );
}
function ConfirmDel({msg,onCancel,onConfirm}) {
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.87)",display:"flex",
                 alignItems:"center",justifyContent:"center",zIndex:600}}>
      <div style={{background:C.card,border:`1px solid ${C.red}44`,borderRadius:6,
                   padding:28,maxWidth:340,width:"90%",textAlign:"center"}}>
        <div style={{fontSize:28,marginBottom:10}}>⚠️</div>
        <div style={{fontSize:14,fontWeight:700,marginBottom:6}}>Confirmar exclusão</div>
        <div style={{fontSize:12,color:C.muted,marginBottom:20}}>{msg||"Esta ação não pode ser desfeita."}</div>
        <div style={{display:"flex",gap:10,justifyContent:"center"}}>
          <Btn onClick={onCancel}>Cancelar</Btn>
          <Btn v="red" onClick={onConfirm}>Excluir</Btn>
        </div>
      </div>
    </div>
  );
}
function Toast({toast}) {
  if (!toast) return null;
  const cor = toast.t==="red"?C.red:toast.t==="yellow"?C.yellow:C.green;
  const bg  = toast.t==="red"?C.redBg:toast.t==="yellow"?C.yellowBg:C.greenBg;
  return (
    <div style={{position:"fixed",bottom:22,right:22,background:bg,border:`1px solid ${cor}55`,
                 color:cor,padding:"11px 18px",borderRadius:4,fontSize:13,fontWeight:600,
                 zIndex:700,boxShadow:"0 4px 20px rgba(0,0,0,.5)"}}>
      {toast.t==="red"?"✕":"✓"} {toast.msg}
    </div>
  );
}

// ─── TELA DE CARREGAMENTO ─────────────────────────────────────────────────────
function TelaCarregando({erro}) {
  return (
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",flexDirection:"column",
                 alignItems:"center",justifyContent:"center",fontFamily:"'IBM Plex Mono',monospace",gap:16}}>
      <div style={{background:C.accent,color:"#fff",fontWeight:700,fontSize:14,
                   padding:"6px 14px",letterSpacing:2,borderRadius:3,marginBottom:8}}>FECHO MENSAL</div>
      {!erro ? (
        <>
          <div style={{fontSize:13,color:C.muted}}>Conectando ao banco de dados...</div>
          <div style={{display:"flex",gap:6}}>
            {[0,1,2].map(i=>(
              <div key={i} style={{width:8,height:8,borderRadius:"50%",background:C.accent,
                                   animation:`pulse 1.2s ${i*0.2}s infinite`}}/>
            ))}
          </div>
        </>
      ) : (
        <div style={{background:C.redBg,border:`1px solid ${C.red}33`,color:C.red,
                     padding:"14px 20px",borderRadius:4,maxWidth:500,textAlign:"center",fontSize:13}}>
          <div style={{fontWeight:700,marginBottom:6}}>Erro ao conectar</div>
          <div style={{color:C.muted,fontSize:12}}>{erro}</div>
        </div>
      )}
    </div>
  );
}

// ─── TELA DE CONFIGURAÇÃO (sem credenciais) ───────────────────────────────────
function TelaSetup() {
  return (
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",alignItems:"center",
                 justifyContent:"center",fontFamily:"'IBM Plex Mono',monospace",padding:24}}>
      <div style={{maxWidth:580,width:"100%"}}>
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{background:C.accent,color:"#fff",fontWeight:700,fontSize:16,
                       padding:"8px 18px",letterSpacing:2,borderRadius:3,display:"inline-block",marginBottom:12}}>
            FECHO MENSAL
          </div>
          <div style={{fontSize:13,color:C.muted}}>Configure o banco de dados para começar</div>
        </div>
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:6,padding:28}}>
          <div style={{fontSize:13,fontWeight:700,marginBottom:20,color:C.accent}}>⚙️ Configuração do Supabase</div>

          {[
            ["1. Crie um projeto gratuito em", "supabase.com"],
            ["2. Execute o SQL de setup", "arquivo supabase-setup.sql"],
            ["3. Copie as credenciais", "Settings > API no painel"],
            ["4. Crie o arquivo .env.local", "na raiz do projeto"],
          ].map(([step, detail], i) => (
            <div key={i} style={{display:"flex",gap:12,marginBottom:14,alignItems:"flex-start"}}>
              <div style={{width:24,height:24,borderRadius:"50%",background:C.accentBg,
                           border:`1px solid ${C.accent}33`,color:C.accent,fontSize:11,
                           fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                {i+1}
              </div>
              <div>
                <div style={{fontSize:12,fontWeight:600}}>{step}</div>
                <div style={{fontSize:11,color:C.muted,marginTop:2}}>{detail}</div>
              </div>
            </div>
          ))}

          <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:4,
                       padding:"12px 16px",marginTop:8}}>
            <div style={{fontSize:10,color:C.muted,letterSpacing:1,marginBottom:8}}>CONTEÚDO DO .env.local</div>
            <div style={{fontFamily:"monospace",fontSize:12,color:C.teal,lineHeight:1.8}}>
              VITE_SB_URL=https://seu-projeto.supabase.co<br/>
              VITE_SB_KEY=sua_anon_key
            </div>
          </div>

          <div style={{marginTop:16,padding:"10px 14px",background:C.yellowBg,
                       border:`1px solid ${C.yellow}33`,borderRadius:4,fontSize:12,color:C.yellow}}>
            Após criar o .env.local, reinicie o servidor com <strong>npm run dev</strong>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── CÁLCULOS DO MÊS ─────────────────────────────────────────────────────────
function calcMes(receitas, anuncios, despesas, mes) {
  const rMes = receitas.filter(r=>r.mes===mes);
  const aMes = anuncios.filter(a=>a.mes===mes);
  const dMes = despesas.filter(d=>d.mes===mes);
  const recBruta   = rMes.reduce((s,r)=>s+r.valor,0);
  const taxasPlat  = rMes.reduce((s,r)=>s+calcTaxa(r.valor,r.unidades,getPR(r.plataforma),r.taxaPerc,r.taxaFixa),0);
  const recLiq     = recBruta-taxasPlat;
  const totalAds   = aMes.reduce((s,a)=>s+a.investimento,0);
  const totalDesp  = dMes.reduce((s,d)=>s+d.valor,0);
  const lucroBruto = recLiq-totalAds;
  const resultado  = lucroBruto-totalDesp;
  const roas       = totalAds>0 ? recBruta/totalAds : 0;
  const margem     = recBruta>0 ? (resultado/recBruta)*100 : 0;
  const totalVendas= rMes.reduce((s,r)=>s+r.unidades,0);
  const cpa        = totalVendas>0 ? totalAds/totalVendas : 0;
  return {recBruta,taxasPlat,recLiq,totalAds,totalDesp,lucroBruto,resultado,roas,margem,totalVendas,cpa};
}

// ─── TAB DASHBOARD ────────────────────────────────────────────────────────────
function TabDashboard({receitas,anuncios,despesas,produtos,fechamentos,mesSel}) {
  const c = calcMes(receitas,anuncios,despesas,mesSel);
  const meses6 = ultMeses(6,mesSel);
  const evolucao = meses6.map(m => {
    const mc = calcMes(receitas,anuncios,despesas,m);
    return {mes:mesLbl(m), receita:mc.recBruta, anuncios:mc.totalAds, despesas:mc.totalDesp, resultado:mc.resultado};
  });
  const porPlatRec = PLATS_REC.map(p => {
    const v = receitas.filter(r=>r.mes===mesSel&&r.plataforma===p.id).reduce((s,r)=>s+r.valor,0);
    return {...p, valor:v};
  }).filter(p=>p.valor>0).sort((a,b)=>b.valor-a.valor);
  const porPlatAds = PLATS_ADS.map(p => {
    const v = anuncios.filter(a=>a.mes===mesSel&&a.plataforma===p.id).reduce((s,a)=>s+a.investimento,0);
    return {...p, valor:v};
  }).filter(p=>p.valor>0).sort((a,b)=>b.valor-a.valor);
  const topProd = produtos.map(p => {
    const v = receitas.filter(r=>r.mes===mesSel&&r.produto===p.id).reduce((s,r)=>s+r.valor,0);
    const u = receitas.filter(r=>r.mes===mesSel&&r.produto===p.id).reduce((s,r)=>s+r.unidades,0);
    return {...p, receita:v, unidades:u};
  }).filter(p=>p.receita>0).sort((a,b)=>b.receita-a.receita);
  const mesesAbertos = ultMeses(4,mesSel).slice(0,3).filter(m =>
    !fechamentos[m] || fechamentos[m].status !== "fechado"
  );
  const feched = fechamentos[mesSel]?.status==="fechado";

  return (
    <div>
      {feched && (
        <div style={{background:C.greenBg,border:`1px solid ${C.green}33`,borderRadius:4,
                     padding:"9px 14px",marginBottom:14,fontSize:12,color:C.green}}>
          ✓ Mês {mesLbl(mesSel)} está <strong>fechado</strong>.
          {fechamentos[mesSel]?.dataFechamento && ` Fechado em ${fechamentos[mesSel].dataFechamento}.`}
        </div>
      )}
      {mesesAbertos.length>0 && !feched && (
        <div style={{background:C.yellowBg,border:`1px solid ${C.yellow}33`,borderRadius:4,
                     padding:"9px 14px",marginBottom:14,fontSize:12,color:C.yellow}}>
          ⚠ Meses pendentes de fechamento: {mesesAbertos.map(m=>mesLbl(m)).join(", ")} — acesse <strong>Fechamento</strong>.
        </div>
      )}
      <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:10,marginBottom:14}}>
        <KPI label="RECEITA BRUTA"    value={fmtRk(c.recBruta)}   color={C.green}  topColor={C.green}  small/>
        <KPI label="TAXAS PLATAFORMA" value={fmtRk(c.taxasPlat)}  color={C.red}    topColor={C.red}    small/>
        <KPI label="RECEITA LÍQUIDA"  value={fmtRk(c.recLiq)}     color={C.teal}   topColor={C.teal}   small/>
        <KPI label="ANÚNCIOS"         value={fmtRk(c.totalAds)}   color={C.orange} topColor={C.orange} small/>
        <KPI label="DESPESAS"         value={fmtRk(c.totalDesp)}  color={C.yellow} topColor={C.yellow} small/>
        <KPI label="RESULTADO"        value={fmtRk(c.resultado)}  color={c.resultado>=0?C.accent:C.red} topColor={C.accent} small/>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:14}}>
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:5,padding:"14px 18px"}}>
          <div style={{fontSize:10,color:C.muted,letterSpacing:1,marginBottom:4}}>ROAS GLOBAL</div>
          <div style={{fontSize:28,fontWeight:700,color:c.roas>=3?C.green:c.roas>=2?C.yellow:c.totalAds>0?C.red:C.muted}}>
            {c.roas>0?c.roas.toFixed(2)+"x":"—"}
          </div>
          <div style={{fontSize:11,color:C.muted,marginTop:3}}>
            {c.roas>=3?"Excelente":c.roas>=2?"Bom":c.roas>=1?"Razoável":c.totalAds===0?"Sem anúncios":"Negativo"}
          </div>
        </div>
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:5,padding:"14px 18px"}}>
          <div style={{fontSize:10,color:C.muted,letterSpacing:1,marginBottom:4}}>MARGEM LÍQUIDA</div>
          <div style={{fontSize:28,fontWeight:700,color:c.margem>=30?C.green:c.margem>=15?C.yellow:c.recBruta>0?C.red:C.muted}}>
            {c.recBruta>0?c.margem.toFixed(1)+"%":"—"}
          </div>
          <div style={{fontSize:11,color:C.muted,marginTop:3}}>sobre receita bruta</div>
        </div>
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:5,padding:"14px 18px"}}>
          <div style={{fontSize:10,color:C.muted,letterSpacing:1,marginBottom:4}}>TOTAL DE VENDAS</div>
          <div style={{fontSize:28,fontWeight:700,color:C.blue}}>{c.totalVendas}</div>
          <div style={{fontSize:11,color:C.muted,marginTop:3}}>
            {c.totalVendas>0&&c.recBruta>0?`Ticket médio ${fmtRk(c.recBruta/c.totalVendas)}`:"unidades"}
          </div>
        </div>
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:5,padding:"14px 18px"}}>
          <div style={{fontSize:10,color:C.muted,letterSpacing:1,marginBottom:4}}>CPA (CUSTO / VENDA)</div>
          <div style={{fontSize:28,fontWeight:700,color:C.purple}}>{c.cpa>0?fmtRk(c.cpa):"—"}</div>
          <div style={{fontSize:11,color:C.muted,marginTop:3}}>custo de aquisição</div>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1.6fr 1fr",gap:12,marginBottom:12}}>
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:5,padding:16}}>
          <div style={{fontSize:10,color:C.muted,letterSpacing:1,marginBottom:12}}>EVOLUÇÃO 6 MESES</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={evolucao} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.dim} vertical={false}/>
              <XAxis dataKey="mes" tick={{fill:C.muted,fontSize:11}} axisLine={false} tickLine={false}/>
              <YAxis tick={{fill:C.muted,fontSize:10}} axisLine={false} tickLine={false} tickFormatter={v=>`${(v/1000).toFixed(0)}k`}/>
              <Tooltip contentStyle={{background:C.card,border:`1px solid ${C.border}`,fontSize:12}} formatter={v=>[fmtR(v),""]}/>
              <Legend wrapperStyle={{fontSize:11,color:C.muted}}/>
              <Bar dataKey="receita"   fill={C.green}  name="Receita Bruta" radius={[2,2,0,0]}/>
              <Bar dataKey="anuncios"  fill={C.orange} name="Anúncios"      radius={[2,2,0,0]}/>
              <Bar dataKey="resultado" fill={C.accent} name="Resultado"     radius={[2,2,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:5,padding:14}}>
            <div style={{fontSize:10,color:C.muted,letterSpacing:1,marginBottom:10}}>RECEITA POR PLATAFORMA</div>
            {porPlatRec.length===0 && <div style={{fontSize:12,color:C.muted,textAlign:"center",padding:"12px 0"}}>Sem dados</div>}
            {porPlatRec.map(p=>(
              <div key={p.id} style={{marginBottom:8}}>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:3}}>
                  <span style={{color:p.cor}}>{p.icon} {p.label}</span>
                  <span style={{fontWeight:700}}>{fmtRk(p.valor)}</span>
                </div>
                <ProgBar pct={c.recBruta>0?(p.valor/c.recBruta)*100:0} color={p.cor} h={4}/>
              </div>
            ))}
          </div>
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:5,padding:14}}>
            <div style={{fontSize:10,color:C.muted,letterSpacing:1,marginBottom:10}}>INVESTIMENTO EM ANÚNCIOS</div>
            {porPlatAds.length===0 && <div style={{fontSize:12,color:C.muted,textAlign:"center",padding:"12px 0"}}>Sem dados</div>}
            {porPlatAds.map(p=>(
              <div key={p.id} style={{marginBottom:8}}>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:3}}>
                  <span style={{color:p.cor}}>{p.icon} {p.label}</span>
                  <span style={{fontWeight:700}}>{fmtRk(p.valor)}</span>
                </div>
                <ProgBar pct={c.totalAds>0?(p.valor/c.totalAds)*100:0} color={p.cor} h={4}/>
              </div>
            ))}
          </div>
        </div>
      </div>
      {topProd.length>0 && (
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:5,padding:16}}>
          <div style={{fontSize:10,color:C.muted,letterSpacing:1,marginBottom:12}}>TOP PRODUTOS — {mesLbl(mesSel)}</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:10}}>
            {topProd.slice(0,6).map((p,i)=>(
              <div key={p.id} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:4,padding:"12px 14px"}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                  <div style={{fontSize:12,fontWeight:700}}>{p.nome}</div>
                  <span style={{fontSize:10,background:C.accentBg,color:C.accent,padding:"1px 6px",borderRadius:2}}>#{i+1}</span>
                </div>
                <div style={{fontSize:10,color:C.muted,marginBottom:6}}>{TIPOS_PRODUTO.find(t=>t.id===p.tipo)?.label||p.tipo}</div>
                <div style={{fontSize:16,fontWeight:700,color:C.green}}>{fmtRk(p.receita)}</div>
                <div style={{fontSize:11,color:C.muted,marginTop:2}}>{p.unidades} vendas · tk {fmtRk(p.unidades>0?p.receita/p.unidades:0)}</div>
                <ProgBar pct={topProd[0].receita>0?(p.receita/topProd[0].receita)*100:0} color={C.accent} h={3}/>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── TAB RECEITAS ─────────────────────────────────────────────────────────────
function ModalReceita({initial,produtos,mes,onSave,onClose}) {
  const blank = {mes,plataforma:"hotmart",produto:"",valor:"",unidades:"1",obs:"",taxaPerc:"",taxaFixa:""};
  const [f,setF]         = useState({...blank,...(initial||{})});
  const [taxaCustom,setTaxaCustom] = useState(!!(initial?.taxaPerc!=null&&initial?.taxaPerc!==""||initial?.taxaFixa!=null&&initial?.taxaFixa!==""));
  const s = k => v => setF(p=>({...p,[k]:v}));
  const plat  = getPR(f.plataforma);
  const valor = parseFloat(f.valor||0);
  const units = parseInt(f.unidades)||1;
  const taxaPercEfet = taxaCustom && f.taxaPerc!=="" ? parseFloat(f.taxaPerc) : plat.taxaPerc;
  const taxaFixaEfet = taxaCustom && f.taxaFixa!=="" ? parseFloat(f.taxaFixa) : plat.taxaFixa;
  const taxa  = calcTaxa(valor, units, plat, taxaCustom&&f.taxaPerc!==""?f.taxaPerc:null, taxaCustom&&f.taxaFixa!==""?f.taxaFixa:null);

  function salvar() {
    const data = {
      ...f,
      valor: valor,
      unidades: units,
      taxaPerc: taxaCustom && f.taxaPerc!=="" ? parseFloat(f.taxaPerc) : null,
      taxaFixa: taxaCustom && f.taxaFixa!=="" ? parseFloat(f.taxaFixa) : null,
    };
    onSave(data);
  }

  return (
    <Modal title={initial?.id?"Editar Receita":"Nova Receita"} sub="LANÇAMENTO DE RECEITA" onClose={onClose} onSave={salvar}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <div>
          <Lbl>PLATAFORMA *</Lbl>
          <FSel value={f.plataforma} onChange={e=>{s("plataforma")(e.target.value);setTaxaCustom(false);}}>
            {PLATS_REC.map(p=><option key={p.id} value={p.id}>{p.icon} {p.label} ({p.taxaPerc}%{p.taxaFixa>0?` + R$${p.taxaFixa}/venda`:""})</option>)}
          </FSel>
        </div>
        <div>
          <Lbl>PRODUTO VINCULADO</Lbl>
          <FSel value={f.produto||""} onChange={e=>s("produto")(e.target.value)}>
            <option value="">Sem vínculo</option>
            {produtos.filter(p=>p.ativo).map(p=><option key={p.id} value={p.id}>{p.nome}</option>)}
          </FSel>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <div><Lbl>VALOR BRUTO (R$) *</Lbl><FInp type="number" min="0" step="0.01" value={f.valor} onChange={e=>s("valor")(e.target.value)}/></div>
        <div><Lbl>UNIDADES VENDIDAS</Lbl><FInp type="number" min="1" value={f.unidades} onChange={e=>s("unidades")(e.target.value)}/></div>
      </div>

      {/* Taxas customizadas */}
      <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:3,padding:"10px 14px"}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom: taxaCustom?10:0}}>
          <input type="checkbox" id="taxaCustom" checked={taxaCustom} onChange={e=>setTaxaCustom(e.target.checked)}
            style={{accentColor:C.accent,cursor:"pointer"}}/>
          <label htmlFor="taxaCustom" style={{fontSize:11,color:C.muted,cursor:"pointer",letterSpacing:1}}>
            PERSONALIZAR TAXAS (padrão: {plat.taxaPerc}%{plat.taxaFixa>0?` + R$${plat.taxaFixa}/venda`:""})
          </label>
        </div>
        {taxaCustom && (
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div>
              <Lbl>TAXA % (ex: 9.9)</Lbl>
              <FInp type="number" min="0" step="0.01" max="100" placeholder={String(plat.taxaPerc)}
                value={f.taxaPerc} onChange={e=>s("taxaPerc")(e.target.value)}/>
            </div>
            <div>
              <Lbl>TAXA FIXA R$/VENDA (ex: 1.50)</Lbl>
              <FInp type="number" min="0" step="0.01" placeholder={String(plat.taxaFixa)}
                value={f.taxaFixa} onChange={e=>s("taxaFixa")(e.target.value)}/>
            </div>
          </div>
        )}
      </div>

      {valor>0 && (
        <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:3,padding:"10px 14px",
                     display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,fontSize:12}}>
          <div>
            <div style={{fontSize:10,color:C.muted,marginBottom:2}}>TAXA TOTAL</div>
            <div style={{color:C.red,fontWeight:700}}>- {fmtR(taxa)}</div>
            <div style={{fontSize:10,color:C.muted}}>{taxaPercEfet}%{taxaFixaEfet>0?` + R$${taxaFixaEfet}×${units}`:""}</div>
          </div>
          <div><div style={{fontSize:10,color:C.muted,marginBottom:2}}>RECEITA LÍQUIDA</div><div style={{color:C.green,fontWeight:700}}>{fmtR(valor-taxa)}</div></div>
          <div><div style={{fontSize:10,color:C.muted,marginBottom:2}}>TICKET MÉDIO</div><div style={{fontWeight:700}}>{fmtR(units>0?valor/units:0)}</div></div>
        </div>
      )}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <div><Lbl>MÊS DE COMPETÊNCIA</Lbl><FInp type="month" value={f.mes} onChange={e=>s("mes")(e.target.value)}/></div>
        <div><Lbl>OBS.</Lbl><FInp value={f.obs} onChange={e=>s("obs")(e.target.value)} placeholder="Opcional"/></div>
      </div>
    </Modal>
  );
}

function TabReceitas({receitas,setReceitas,produtos,mesSel,showToast}) {
  const [form,    setForm]    = useState(null);
  const [del,     setDel]     = useState(null);
  const [filtPlat,setFiltPlat]= useState("todos");

  const itens = useMemo(()=>
    receitas.filter(r=>r.mes===mesSel&&(filtPlat==="todos"||r.plataforma===filtPlat))
      .sort((a,b)=>getPR(a.plataforma).label.localeCompare(getPR(b.plataforma).label))
  ,[receitas,mesSel,filtPlat]);

  const porPlat = useMemo(()=>
    PLATS_REC.map(p=>{
      const items = receitas.filter(r=>r.mes===mesSel&&r.plataforma===p.id);
      const bruto = items.reduce((s,r)=>s+r.valor,0);
      const taxa  = items.reduce((s,r)=>s+calcTaxa(r.valor,r.unidades,p,r.taxaPerc,r.taxaFixa),0);
      const unids = items.reduce((s,r)=>s+r.unidades,0);
      return {...p,bruto,taxa,liquido:bruto-taxa,unids,count:items.length};
    }).filter(p=>p.bruto>0)
  ,[receitas,mesSel]);

  const totalBruto = porPlat.reduce((s,p)=>s+p.bruto,0);
  const totalTaxa  = porPlat.reduce((s,p)=>s+p.taxa,0);
  const totalLiq   = totalBruto-totalTaxa;
  const totalUnids = porPlat.reduce((s,p)=>s+p.unids,0);

  function salvar(data) {
    if (!data.valor) return;
    if (form?.id){setReceitas(rs=>rs.map(r=>r.id===form.id?{...data,id:form.id}:r));showToast("Atualizado!");}
    else{setReceitas(rs=>[...rs,{...data,id:uid()}]);showToast("Receita lançada!");}
    setForm(null);
  }

  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:16}}>
        <KPI label="RECEITA BRUTA"     value={fmtRk(totalBruto)} color={C.green}  topColor={C.green}/>
        <KPI label="TAXAS PLATAFORMAS" value={fmtRk(totalTaxa)}  color={C.red}    topColor={C.red}/>
        <KPI label="RECEITA LÍQUIDA"   value={fmtRk(totalLiq)}   color={C.teal}   topColor={C.teal}/>
        <KPI label="TOTAL DE VENDAS"   value={totalUnids}         color={C.yellow} sub={`${porPlat.length} plataforma${porPlat.length!==1?"s":""}`}/>
      </div>
      {porPlat.length>0 && (
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(195px,1fr))",gap:10,marginBottom:16}}>
          {porPlat.map(p=>(
            <div key={p.id} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:5,padding:14,position:"relative",overflow:"hidden"}}>
              <div style={{position:"absolute",top:0,left:0,right:0,height:2,background:p.cor}}/>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                <div>
                  <div style={{fontSize:12,fontWeight:700}}>{p.icon} {p.label}</div>
                  <div style={{fontSize:10,color:C.muted,marginTop:1}}>taxa {p.taxaPerc}%{p.taxaFixa>0?` + R$${p.taxaFixa}/vd`:""} · {p.unids} vendas</div>
                </div>
                <span style={{fontSize:10,background:C.greenBg,color:C.green,padding:"1px 5px",borderRadius:2}}>
                  {totalBruto>0?`${((p.bruto/totalBruto)*100).toFixed(0)}%`:"—"}
                </span>
              </div>
              <div style={{fontSize:17,fontWeight:700}}>{fmtRk(p.bruto)}</div>
              <div style={{fontSize:11,color:C.red,marginTop:2}}>- {fmtR(p.taxa)} taxa</div>
              <div style={{fontSize:13,fontWeight:700,color:C.green,marginTop:4}}>{fmtRk(p.liquido)} líq.</div>
              <ProgBar pct={totalBruto>0?(p.bruto/totalBruto)*100:0} color={p.cor}/>
            </div>
          ))}
        </div>
      )}
      <div style={{display:"flex",gap:8,marginBottom:12,alignItems:"center"}}>
        <FSel value={filtPlat} onChange={e=>setFiltPlat(e.target.value)} sx={{width:190}}>
          <option value="todos">Todas as plataformas</option>
          {PLATS_REC.map(p=><option key={p.id} value={p.id}>{p.icon} {p.label}</option>)}
        </FSel>
        <Btn v="green" onClick={()=>setForm({})} sx={{marginLeft:"auto"}}>+ Nova Receita</Btn>
      </div>
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:5,overflow:"hidden"}}>
        <div style={{display:"grid",gridTemplateColumns:"1.5fr 1.5fr 1fr 1fr 1fr 1fr auto",
                     padding:"8px 14px",background:C.surface,borderBottom:`1px solid ${C.border}`}}>
          {["PLATAFORMA","PRODUTO","BRUTO","TAXA","LÍQUIDO","VENDAS",""].map(h=>(
            <div key={h} style={{fontSize:10,color:C.muted,letterSpacing:1}}>{h}</div>
          ))}
        </div>
        {itens.length===0 && <div style={{padding:28,textAlign:"center",color:C.muted}}>Nenhuma receita em {mesLbl(mesSel)}.</div>}
        {itens.map((r,i)=>{
          const p   = getPR(r.plataforma);
          const taxa= calcTaxa(r.valor,r.unidades,p,r.taxaPerc,r.taxaFixa);
          const prod= produtos.find(pr=>pr.id===r.produto);
          return (
            <div key={r.id}
              style={{display:"grid",gridTemplateColumns:"1.5fr 1.5fr 1fr 1fr 1fr 1fr auto",
                      padding:"8px 14px",borderBottom:i<itens.length-1?`1px solid ${C.border}`:"none",
                      alignItems:"center",fontSize:12}}
              onMouseEnter={e=>e.currentTarget.style.background=C.surface}
              onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              <div style={{color:p.cor,fontWeight:600}}>{p.icon} {p.label}</div>
              <div style={{color:C.muted}}>{prod?.nome||"—"}</div>
              <div style={{fontWeight:700}}>{fmtR(r.valor)}</div>
              <div style={{color:C.red}}>-{fmtR(taxa)}</div>
              <div style={{fontWeight:700,color:C.green}}>{fmtR(r.valor-taxa)}</div>
              <div style={{color:C.yellow}}>{r.unidades}</div>
              <div style={{display:"flex",gap:3}}>
                <Btn onClick={()=>setForm({...r})} sx={{padding:"2px 6px",fontSize:11}}>✎</Btn>
                <Btn v="red" onClick={()=>setDel(r.id)} sx={{padding:"2px 6px",fontSize:11}}>✕</Btn>
              </div>
            </div>
          );
        })}
        {itens.length>0 && (
          <div style={{display:"grid",gridTemplateColumns:"1.5fr 1.5fr 1fr 1fr 1fr 1fr auto",
                       padding:"10px 14px",background:C.surface,borderTop:`2px solid ${C.border}`,fontSize:12}}>
            <div style={{fontWeight:700,gridColumn:"1/3"}}>TOTAL — {itens.length} lançamento{itens.length!==1?"s":""}</div>
            <div style={{fontWeight:700}}>{fmtRk(totalBruto)}</div>
            <div style={{fontWeight:700,color:C.red}}>-{fmtRk(totalTaxa)}</div>
            <div style={{fontWeight:700,color:C.green}}>{fmtRk(totalLiq)}</div>
            <div style={{fontWeight:700,color:C.yellow}}>{totalUnids}</div>
            <div/>
          </div>
        )}
      </div>
      {form!==null && <ModalReceita initial={form?.id?form:null} produtos={produtos} mes={mesSel} onSave={salvar} onClose={()=>setForm(null)}/>}
      {del && <ConfirmDel onCancel={()=>setDel(null)} onConfirm={()=>{setReceitas(rs=>rs.filter(r=>r.id!==del));setDel(null);showToast("Removido.","yellow");}}/>}
    </div>
  );
}

// ─── TAB ANÚNCIOS ─────────────────────────────────────────────────────────────
function ModalAnuncio({initial,mes,onSave,onClose}) {
  const blank = {mes,plataforma:"meta",campanha:"",investimento:"",obs:""};
  const [f,setF] = useState({...blank,...(initial||{})});
  const s = k => v => setF(p=>({...p,[k]:v}));
  return (
    <Modal title={initial?.id?"Editar Anúncio":"Novo Investimento em Anúncio"} sub="TRÁFEGO PAGO" onClose={onClose}
           onSave={()=>onSave({...f,investimento:parseFloat(f.investimento)||0})}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <div>
          <Lbl>PLATAFORMA *</Lbl>
          <FSel value={f.plataforma} onChange={e=>s("plataforma")(e.target.value)}>
            {PLATS_ADS.map(p=><option key={p.id} value={p.id}>{p.icon} {p.label}</option>)}
          </FSel>
        </div>
        <div><Lbl>CAMPANHA / DESCRIÇÃO *</Lbl><FInp value={f.campanha} onChange={e=>s("campanha")(e.target.value)} placeholder="Ex: Funil Copy — Topo"/></div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <div><Lbl>INVESTIMENTO (R$) *</Lbl><FInp type="number" min="0" step="0.01" value={f.investimento} onChange={e=>s("investimento")(e.target.value)}/></div>
        <div><Lbl>MÊS DE COMPETÊNCIA</Lbl><FInp type="month" value={f.mes} onChange={e=>s("mes")(e.target.value)}/></div>
      </div>
      <div><Lbl>OBS.</Lbl><FTxt rows={2} value={f.obs} onChange={e=>s("obs")(e.target.value)}/></div>
    </Modal>
  );
}

function TabAnuncios({anuncios,setAnuncios,receitas,mesSel,showToast}) {
  const [form,    setForm]    = useState(null);
  const [del,     setDel]     = useState(null);
  const [filtPlat,setFiltPlat]= useState("todos");

  const itens = useMemo(()=>
    anuncios.filter(a=>a.mes===mesSel&&(filtPlat==="todos"||a.plataforma===filtPlat))
      .sort((a,b)=>b.investimento-a.investimento)
  ,[anuncios,mesSel,filtPlat]);

  const porPlat = useMemo(()=>
    PLATS_ADS.map(p=>{
      const items = anuncios.filter(a=>a.mes===mesSel&&a.plataforma===p.id);
      const inv   = items.reduce((s,a)=>s+a.investimento,0);
      return {...p,investimento:inv,count:items.length};
    }).filter(p=>p.investimento>0)
  ,[anuncios,mesSel]);

  const totalInv    = porPlat.reduce((s,p)=>s+p.investimento,0);
  const recBruta    = receitas.filter(r=>r.mes===mesSel).reduce((s,r)=>s+r.valor,0);
  const roas        = totalInv>0 ? recBruta/totalInv : 0;
  const totalVendas = receitas.filter(r=>r.mes===mesSel).reduce((s,r)=>s+r.unidades,0);
  const cpa         = totalVendas>0&&totalInv>0 ? totalInv/totalVendas : 0;

  function salvar(data) {
    if (!data.investimento||!data.campanha) return;
    if (form?.id){setAnuncios(as=>as.map(a=>a.id===form.id?{...data,id:form.id}:a));showToast("Atualizado!");}
    else{setAnuncios(as=>[...as,{...data,id:uid()}]);showToast("Anúncio lançado!");}
    setForm(null);
  }

  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:16}}>
        <KPI label="TOTAL INVESTIDO"   value={fmtRk(totalInv)} color={C.orange} topColor={C.orange}/>
        <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:5,padding:"13px 16px",position:"relative",overflow:"hidden"}}>
          <div style={{position:"absolute",top:0,left:0,right:0,height:2,background:roas>=3?C.green:roas>=2?C.yellow:C.red}}/>
          <div style={{fontSize:10,color:C.muted,letterSpacing:1,marginBottom:4}}>ROAS GLOBAL</div>
          <div style={{fontSize:20,fontWeight:700,color:roas>=3?C.green:roas>=2?C.yellow:totalInv>0?C.red:C.muted}}>
            {roas>0?roas.toFixed(2)+"x":"—"}
          </div>
          <div style={{fontSize:10,color:C.muted,marginTop:3}}>receita bruta / anúncios</div>
        </div>
        <KPI label="CPA (CUSTO/VENDA)" value={cpa>0?fmtRk(cpa):"—"} color={C.purple}/>
        <KPI label="RECEITA NO MÊS"    value={fmtRk(recBruta)} color={C.green} sub={`${itens.length} campanhas`}/>
      </div>
      {porPlat.length>0 && (
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:10,marginBottom:16}}>
          {porPlat.map(p=>(
            <div key={p.id} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:5,padding:14,position:"relative",overflow:"hidden"}}>
              <div style={{position:"absolute",top:0,left:0,right:0,height:2,background:p.cor}}/>
              <div style={{fontSize:12,fontWeight:700,marginBottom:8}}>{p.icon} {p.label}</div>
              <div style={{fontSize:18,fontWeight:700,color:C.orange}}>{fmtRk(p.investimento)}</div>
              <div style={{fontSize:11,color:C.muted,marginTop:2}}>{p.count} campanha{p.count!==1?"s":""}</div>
              <ProgBar pct={totalInv>0?(p.investimento/totalInv)*100:0} color={p.cor}/>
              <div style={{fontSize:10,color:C.muted,marginTop:3}}>{totalInv>0?`${((p.investimento/totalInv)*100).toFixed(1)}% do total`:""}</div>
            </div>
          ))}
        </div>
      )}
      <div style={{display:"flex",gap:8,marginBottom:12,alignItems:"center"}}>
        <FSel value={filtPlat} onChange={e=>setFiltPlat(e.target.value)} sx={{width:190}}>
          <option value="todos">Todas as plataformas</option>
          {PLATS_ADS.map(p=><option key={p.id} value={p.id}>{p.icon} {p.label}</option>)}
        </FSel>
        <Btn v="orange" onClick={()=>setForm({})} sx={{marginLeft:"auto"}}>+ Novo Anúncio</Btn>
      </div>
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:5,overflow:"hidden"}}>
        <div style={{display:"grid",gridTemplateColumns:"1.5fr 2fr 1.2fr auto",
                     padding:"8px 14px",background:C.surface,borderBottom:`1px solid ${C.border}`}}>
          {["PLATAFORMA","CAMPANHA","INVESTIMENTO",""].map(h=>(
            <div key={h} style={{fontSize:10,color:C.muted,letterSpacing:1}}>{h}</div>
          ))}
        </div>
        {itens.length===0 && <div style={{padding:28,textAlign:"center",color:C.muted}}>Nenhum anúncio em {mesLbl(mesSel)}.</div>}
        {itens.map((a,i)=>{
          const p = getPA(a.plataforma);
          return (
            <div key={a.id}
              style={{display:"grid",gridTemplateColumns:"1.5fr 2fr 1.2fr auto",
                      padding:"8px 14px",borderBottom:i<itens.length-1?`1px solid ${C.border}`:"none",
                      alignItems:"center",fontSize:12}}
              onMouseEnter={e=>e.currentTarget.style.background=C.surface}
              onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              <div style={{color:p.cor,fontWeight:600}}>{p.icon} {p.label}</div>
              <div>{a.campanha}{a.obs&&<span style={{color:C.muted,marginLeft:6,fontSize:11}}>· {a.obs}</span>}</div>
              <div style={{fontWeight:700,color:C.orange}}>{fmtR(a.investimento)}</div>
              <div style={{display:"flex",gap:3}}>
                <Btn onClick={()=>setForm({...a})} sx={{padding:"2px 6px",fontSize:11}}>✎</Btn>
                <Btn v="red" onClick={()=>setDel(a.id)} sx={{padding:"2px 6px",fontSize:11}}>✕</Btn>
              </div>
            </div>
          );
        })}
        {itens.length>0 && (
          <div style={{display:"grid",gridTemplateColumns:"1.5fr 2fr 1.2fr auto",
                       padding:"10px 14px",background:C.surface,borderTop:`2px solid ${C.border}`,fontSize:12}}>
            <div style={{fontWeight:700,gridColumn:"1/3"}}>TOTAL — {itens.length} campanha{itens.length!==1?"s":""}</div>
            <div style={{fontWeight:700,color:C.orange}}>{fmtRk(totalInv)}</div>
            <div/>
          </div>
        )}
      </div>
      {form!==null && <ModalAnuncio initial={form?.id?form:null} mes={mesSel} onSave={salvar} onClose={()=>setForm(null)}/>}
      {del && <ConfirmDel onCancel={()=>setDel(null)} onConfirm={()=>{setAnuncios(as=>as.filter(a=>a.id!==del));setDel(null);showToast("Removido.","yellow");}}/>}
    </div>
  );
}

// ─── TAB DESPESAS ─────────────────────────────────────────────────────────────
function ModalDespesa({initial,mes,onSave,onClose}) {
  const blank = {mes,cat:"email_mkt",desc:"",valor:"",recorrente:false,obs:""};
  const [f,setF] = useState({...blank,...(initial||{})});
  const s = k => v => setF(p=>({...p,[k]:v}));
  return (
    <Modal title={initial?.id?"Editar Despesa":"Nova Despesa"} sub="DESPESAS OPERACIONAIS" onClose={onClose}
           onSave={()=>onSave({...f,valor:parseFloat(f.valor)||0})}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <div>
          <Lbl>CATEGORIA *</Lbl>
          <FSel value={f.cat} onChange={e=>s("cat")(e.target.value)}>
            {CATS_DESP.map(c=><option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
          </FSel>
        </div>
        <div><Lbl>DESCRIÇÃO *</Lbl><FInp value={f.desc} onChange={e=>s("desc")(e.target.value)} placeholder="Ex: Canva Pro"/></div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <div><Lbl>VALOR (R$) *</Lbl><FInp type="number" min="0" step="0.01" value={f.valor} onChange={e=>s("valor")(e.target.value)}/></div>
        <div><Lbl>MÊS DE COMPETÊNCIA</Lbl><FInp type="month" value={f.mes} onChange={e=>s("mes")(e.target.value)}/></div>
      </div>
      <div><Lbl>OBS.</Lbl><FTxt rows={2} value={f.obs} onChange={e=>s("obs")(e.target.value)}/></div>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        <input type="checkbox" checked={!!f.recorrente} onChange={e=>s("recorrente")(e.target.checked)}
               style={{accentColor:C.accent,transform:"scale(1.2)",cursor:"pointer"}}/>
        <span style={{fontSize:12,color:C.text}}>Despesa recorrente (assinatura / fixo mensal)</span>
      </div>
    </Modal>
  );
}

function TabDespesas({despesas,setDespesas,mesSel,showToast}) {
  const [form,   setForm]   = useState(null);
  const [del,    setDel]    = useState(null);
  const [filtCat,setFiltCat]= useState("todos");
  const [filtRec,setFiltRec]= useState("todos");

  const itens = useMemo(()=>
    despesas.filter(d=>d.mes===mesSel
      &&(filtCat==="todos"||d.cat===filtCat)
      &&(filtRec==="todos"||(filtRec==="recorrente"?d.recorrente:!d.recorrente)))
      .sort((a,b)=>b.valor-a.valor)
  ,[despesas,mesSel,filtCat,filtRec]);

  const porCat = useMemo(()=>
    CATS_DESP.map(c=>{
      const items = despesas.filter(d=>d.mes===mesSel&&d.cat===c.id);
      return {...c,val:items.reduce((s,d)=>s+d.valor,0),count:items.length};
    }).filter(c=>c.val>0).sort((a,b)=>b.val-a.val)
  ,[despesas,mesSel]);

  const totalDesp = porCat.reduce((s,c)=>s+c.val,0);
  const totalFix  = despesas.filter(d=>d.mes===mesSel&&d.recorrente).reduce((s,d)=>s+d.valor,0);

  function salvar(data) {
    if (!data.desc||!data.valor) return;
    if (form?.id){setDespesas(ds=>ds.map(d=>d.id===form.id?{...data,id:form.id}:d));showToast("Atualizado!");}
    else{setDespesas(ds=>[...ds,{...data,id:uid()}]);showToast("Despesa lançada!");}
    setForm(null);
  }

  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:16}}>
        <KPI label="TOTAL DESPESAS"   value={fmtRk(totalDesp)}        color={C.yellow} topColor={C.yellow}/>
        <KPI label="FIXO (RECORRENTE)"value={fmtRk(totalFix)}         color={C.blue}   topColor={C.blue}/>
        <KPI label="VARIÁVEL"         value={fmtRk(totalDesp-totalFix)}color={C.purple} topColor={C.purple}/>
        <KPI label="CATEGORIAS"       value={porCat.length}           color={C.muted}  sub={`${itens.length} lançamentos`}/>
      </div>
      {porCat.length>0 && (
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:5,padding:16,marginBottom:16}}>
          <div style={{fontSize:10,color:C.muted,letterSpacing:1,marginBottom:12}}>DESPESAS POR CATEGORIA</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            {porCat.map(c=>(
              <div key={c.id} style={{marginBottom:4}}>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:4}}>
                  <span><span style={{color:c.cor}}>{c.icon}</span> {c.label}{c.count>1&&<span style={{fontSize:10,color:C.muted,marginLeft:5}}>{c.count}x</span>}</span>
                  <span style={{fontWeight:700}}>{fmtR(c.val)} <span style={{color:C.muted,fontSize:10}}>({totalDesp>0?((c.val/totalDesp)*100).toFixed(0):0}%)</span></span>
                </div>
                <ProgBar pct={totalDesp>0?(c.val/totalDesp)*100:0} color={c.cor} h={4}/>
              </div>
            ))}
          </div>
        </div>
      )}
      <div style={{display:"flex",gap:8,marginBottom:12,alignItems:"center",flexWrap:"wrap"}}>
        <FSel value={filtCat} onChange={e=>setFiltCat(e.target.value)} sx={{width:210}}>
          <option value="todos">Todas as categorias</option>
          {CATS_DESP.map(c=><option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
        </FSel>
        <div style={{display:"flex",gap:3}}>
          {[["todos","Todos"],["recorrente","Fixos"],["variavel","Variáveis"]].map(([v,l])=>(
            <Btn key={v} onClick={()=>setFiltRec(v)}
                 sx={{padding:"5px 10px",fontSize:11,borderColor:filtRec===v?C.yellow:C.dim,color:filtRec===v?C.yellow:C.muted}}>{l}</Btn>
          ))}
        </div>
        <Btn v="yellow" onClick={()=>setForm({})} sx={{marginLeft:"auto"}}>+ Nova Despesa</Btn>
      </div>
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:5,overflow:"hidden"}}>
        <div style={{display:"grid",gridTemplateColumns:"1.5fr 2fr 1fr .6fr auto",
                     padding:"8px 14px",background:C.surface,borderBottom:`1px solid ${C.border}`}}>
          {["CATEGORIA","DESCRIÇÃO","VALOR","TIPO",""].map(h=>(
            <div key={h} style={{fontSize:10,color:C.muted,letterSpacing:1}}>{h}</div>
          ))}
        </div>
        {itens.length===0 && <div style={{padding:28,textAlign:"center",color:C.muted}}>Nenhuma despesa em {mesLbl(mesSel)}.</div>}
        {itens.map((d,i)=>{
          const cat = getCD(d.cat);
          return (
            <div key={d.id}
              style={{display:"grid",gridTemplateColumns:"1.5fr 2fr 1fr .6fr auto",
                      padding:"8px 14px",borderBottom:i<itens.length-1?`1px solid ${C.border}`:"none",
                      alignItems:"center",fontSize:12}}
              onMouseEnter={e=>e.currentTarget.style.background=C.surface}
              onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              <div style={{color:cat.cor,fontWeight:600}}>{cat.icon} {cat.label}</div>
              <div>{d.desc}{d.obs&&<span style={{color:C.muted,fontSize:11,marginLeft:6}}>· {d.obs}</span>}</div>
              <div style={{fontWeight:700,color:C.yellow}}>{fmtR(d.valor)}</div>
              <span style={{background:d.recorrente?C.blueBg:C.purpleBg,color:d.recorrente?C.blue:C.purple,
                            border:`1px solid ${(d.recorrente?C.blue:C.purple)}33`,
                            fontSize:9,padding:"2px 6px",borderRadius:2,fontWeight:600,whiteSpace:"nowrap"}}>
                {d.recorrente?"FIXO":"VARIÁVEL"}
              </span>
              <div style={{display:"flex",gap:3}}>
                <Btn onClick={()=>setForm({...d})} sx={{padding:"2px 6px",fontSize:11}}>✎</Btn>
                <Btn v="red" onClick={()=>setDel(d.id)} sx={{padding:"2px 6px",fontSize:11}}>✕</Btn>
              </div>
            </div>
          );
        })}
        {itens.length>0 && (
          <div style={{display:"grid",gridTemplateColumns:"1.5fr 2fr 1fr .6fr auto",
                       padding:"10px 14px",background:C.surface,borderTop:`2px solid ${C.border}`,fontSize:12}}>
            <div style={{fontWeight:700,gridColumn:"1/3"}}>TOTAL — {itens.length} despesa{itens.length!==1?"s":""}</div>
            <div style={{fontWeight:700,color:C.yellow}}>{fmtRk(totalDesp)}</div>
            <div/><div/>
          </div>
        )}
      </div>
      {form!==null && <ModalDespesa initial={form?.id?form:null} mes={mesSel} onSave={salvar} onClose={()=>setForm(null)}/>}
      {del && <ConfirmDel onCancel={()=>setDel(null)} onConfirm={()=>{setDespesas(ds=>ds.filter(d=>d.id!==del));setDel(null);showToast("Removido.","yellow");}}/>}
    </div>
  );
}

// ─── TAB PRODUTOS ─────────────────────────────────────────────────────────────
function ModalProduto({initial,onSave,onClose}) {
  const blank = {nome:"",tipo:"curso",preco:"",ativo:true};
  const [f,setF] = useState({...blank,...(initial||{})});
  const s = k => v => setF(p=>({...p,[k]:v}));
  return (
    <Modal title={initial?.id?"Editar Produto":"Novo Produto"} sub="CATÁLOGO" onClose={onClose}
           onSave={()=>onSave({...f,preco:parseFloat(f.preco)||0})}>
      <div style={{display:"grid",gridTemplateColumns:"1.5fr 1fr",gap:12}}>
        <div><Lbl>NOME DO PRODUTO *</Lbl><FInp value={f.nome} onChange={e=>s("nome")(e.target.value)} placeholder="Ex: Curso de Copy"/></div>
        <div>
          <Lbl>TIPO</Lbl>
          <FSel value={f.tipo} onChange={e=>s("tipo")(e.target.value)}>
            {TIPOS_PRODUTO.map(t=><option key={t.id} value={t.id}>{t.label}</option>)}
          </FSel>
        </div>
      </div>
      <div><Lbl>PREÇO PADRÃO (R$)</Lbl><FInp type="number" min="0" step="0.01" value={f.preco} onChange={e=>s("preco")(e.target.value)}/></div>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        <input type="checkbox" checked={!!f.ativo} onChange={e=>s("ativo")(e.target.checked)}
               style={{accentColor:C.accent,transform:"scale(1.2)",cursor:"pointer"}}/>
        <span style={{fontSize:12,color:C.text}}>Produto ativo</span>
      </div>
    </Modal>
  );
}

function TabProdutos({produtos,setProdutos,receitas,mesSel,showToast}) {
  const [form,setForm] = useState(null);
  const [del, setDel]  = useState(null);

  const stats = useMemo(()=>
    produtos.map(p=>{
      const recMes = receitas.filter(r=>r.produto===p.id&&r.mes===mesSel).reduce((s,r)=>s+r.valor,0);
      const recTot = receitas.filter(r=>r.produto===p.id).reduce((s,r)=>s+r.valor,0);
      const vdMes  = receitas.filter(r=>r.produto===p.id&&r.mes===mesSel).reduce((s,r)=>s+r.unidades,0);
      const vdTot  = receitas.filter(r=>r.produto===p.id).reduce((s,r)=>s+r.unidades,0);
      return {...p,recMes,recTot,vdMes,vdTot};
    }).sort((a,b)=>b.recTot-a.recTot)
  ,[produtos,receitas,mesSel]);

  function salvar(data) {
    if (!data.nome.trim()) return;
    if (form?.id){setProdutos(ps=>ps.map(p=>p.id===form.id?{...data,id:form.id}:p));showToast("Atualizado!");}
    else{setProdutos(ps=>[...ps,{...data,id:uid()}]);showToast("Produto cadastrado!");}
    setForm(null);
  }

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <div style={{fontSize:10,color:C.muted,letterSpacing:1}}>CATÁLOGO DE PRODUTOS</div>
        <Btn v="primary" onClick={()=>setForm({})}>+ Novo Produto</Btn>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:12}}>
        {stats.map(p=>{
          const tipo = TIPOS_PRODUTO.find(t=>t.id===p.tipo);
          return (
            <div key={p.id} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:5,padding:16,opacity:p.ativo?1:.5}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
                <div>
                  <div style={{fontSize:13,fontWeight:700}}>{p.nome}</div>
                  <div style={{fontSize:11,color:C.muted,marginTop:2}}>{tipo?.label} · {fmtR(p.preco)}</div>
                </div>
                <span style={{background:p.ativo?C.greenBg:C.dim,color:p.ativo?C.green:C.muted,
                              fontSize:10,padding:"2px 7px",borderRadius:2,fontWeight:600}}>
                  {p.ativo?"ATIVO":"INATIVO"}
                </span>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
                <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:3,padding:"8px 10px"}}>
                  <div style={{fontSize:10,color:C.muted}}>MÊS ATUAL</div>
                  <div style={{fontSize:15,fontWeight:700,color:C.green,marginTop:2}}>{fmtRk(p.recMes)}</div>
                  <div style={{fontSize:11,color:C.muted,marginTop:1}}>{p.vdMes} vendas</div>
                </div>
                <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:3,padding:"8px 10px"}}>
                  <div style={{fontSize:10,color:C.muted}}>TOTAL ACUMULADO</div>
                  <div style={{fontSize:15,fontWeight:700,color:C.accent,marginTop:2}}>{fmtRk(p.recTot)}</div>
                  <div style={{fontSize:11,color:C.muted,marginTop:1}}>{p.vdTot} vendas</div>
                </div>
              </div>
              <div style={{display:"flex",gap:6}}>
                <Btn onClick={()=>setForm({...p})} sx={{flex:1,fontSize:11}}>✎ Editar</Btn>
                <Btn v={p.ativo?"ghost":"green"} sx={{flex:1,fontSize:11}}
                    onClick={()=>{setProdutos(ps=>ps.map(x=>x.id===p.id?{...x,ativo:!x.ativo}:x));showToast(p.ativo?"Desativado.":"Ativado!","yellow");}}>
                  {p.ativo?"Desativar":"Ativar"}
                </Btn>
                <Btn v="red" onClick={()=>setDel(p.id)} sx={{padding:"5px 9px",fontSize:11}}>✕</Btn>
              </div>
            </div>
          );
        })}
      </div>
      {form!==null && <ModalProduto initial={form?.id?form:null} onSave={salvar} onClose={()=>setForm(null)}/>}
      {del && <ConfirmDel onCancel={()=>setDel(null)} onConfirm={()=>{setProdutos(ps=>ps.filter(p=>p.id!==del));setDel(null);showToast("Removido.","yellow");}}/>}
    </div>
  );
}

// ─── TAB FECHAMENTO ───────────────────────────────────────────────────────────
function TabFechamento({receitas,anuncios,despesas,fechamentos,setFechamentos,mesSel,showToast}) {
  const c    = calcMes(receitas,anuncios,despesas,mesSel);
  const fech = fechamentos[mesSel]||{status:"aberto",obs:""};
  const [obs,setObs] = useState(fech.obs||"");
  const fechado = fech.status==="fechado";

  function fechar() {
    const dataFechamento = new Date().toLocaleDateString("pt-BR");
    setFechamentos(f=>({...f,[mesSel]:{status:"fechado",obs,dataFechamento}}));
    showToast(`${mesLbl(mesSel)} fechado com sucesso!`);
  }
  function reabrir() {
    setFechamentos(f=>({...f,[mesSel]:{...f[mesSel],status:"aberto"}}));
    showToast(`${mesLbl(mesSel)} reaberto.`,"yellow");
  }
  function salvarObs() {
    setFechamentos(f=>({...f,[mesSel]:{...f[mesSel],obs}}));
    showToast("Observações salvas!");
  }

  const historico = useMemo(()=>
    ultMeses(6,mesSel).map(m=>{
      const mc = calcMes(receitas,anuncios,despesas,m);
      return {mes:m,label:mesLbl(m),...mc,status:fechamentos[m]?.status||"aberto"};
    }).reverse()
  ,[receitas,anuncios,despesas,fechamentos,mesSel]);

  const DRE_ROWS = [
    {label:"(+) RECEITA BRUTA",           val:c.recBruta,   bold:true,  cor:C.green,                        indent:0},
    {label:"(-) Taxas de Plataforma",     val:-c.taxasPlat, bold:false, cor:C.red,                          indent:1},
    {label:"(=) RECEITA LÍQUIDA",         val:c.recLiq,     bold:true,  cor:C.teal,                         indent:0, sep:true},
    {label:"(-) Investimento em Anúncios",val:-c.totalAds,  bold:false, cor:C.orange,                       indent:1},
    {label:"(=) LUCRO OPERACIONAL BRUTO", val:c.lucroBruto, bold:true,  cor:c.lucroBruto>=0?C.accent:C.red, indent:0, sep:true},
    {label:"(-) Despesas Operacionais",   val:-c.totalDesp, bold:false, cor:C.yellow,                       indent:1},
    {label:"(=) RESULTADO LÍQUIDO",       val:c.resultado,  bold:true,  cor:c.resultado>=0?C.green:C.red,   indent:0, sep:true, highlight:true},
  ];

  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"1.2fr 1fr",gap:16,marginBottom:16}}>
        <div style={{background:C.card,border:`1px solid ${fechado?C.green:C.border}`,borderRadius:5,overflow:"hidden"}}>
          <div style={{padding:"13px 18px",background:C.surface,borderBottom:`1px solid ${C.border}`,
                       display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div>
              <div style={{fontSize:13,fontWeight:700}}>DRE — Demonstrativo de Resultado</div>
              <div style={{fontSize:11,color:C.muted,marginTop:2}}>{mesLbl(mesSel).toUpperCase()}</div>
            </div>
            <span style={{background:fechado?C.greenBg:C.yellowBg,color:fechado?C.green:C.yellow,
                          border:`1px solid ${(fechado?C.green:C.yellow)}33`,
                          fontSize:11,padding:"3px 10px",borderRadius:3,fontWeight:700}}>
              {fechado?"✓ FECHADO":"● ABERTO"}
            </span>
          </div>
          <div style={{padding:"12px 18px"}}>
            {DRE_ROWS.map((row,i)=>(
              <div key={i} style={{
                background:row.highlight?(row.val>=0?C.greenBg:C.redBg):"transparent",
                border:row.highlight?`1px solid ${(row.val>=0?C.green:C.red)}22`:"none",
                borderRadius:row.highlight?4:0,
                display:"flex",justifyContent:"space-between",alignItems:"center",
                padding:row.highlight?"10px 12px":"6px 0 6px "+(row.indent*16)+"px",
                marginBottom:row.sep?8:0,
                borderBottom:row.sep?`1px solid ${C.dim}`:"none",
              }}>
                <span style={{fontSize:row.bold?13:12,fontWeight:row.bold?700:400,color:row.bold?C.text:C.muted}}>{row.label}</span>
                <span style={{fontSize:row.bold?15:13,fontWeight:row.bold?700:400,color:row.cor}}>
                  {row.val>=0?fmtR(row.val):"- "+fmtR(Math.abs(row.val))}
                </span>
              </div>
            ))}
            <div style={{marginTop:12,padding:"8px 12px",background:C.surface,borderRadius:4,
                         display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,fontSize:11}}>
              <div style={{textAlign:"center"}}>
                <div style={{color:C.muted,marginBottom:2}}>ROAS</div>
                <div style={{fontWeight:700,fontSize:16,color:c.roas>=3?C.green:c.roas>=2?C.yellow:c.totalAds>0?C.red:C.muted}}>
                  {c.roas>0?c.roas.toFixed(2)+"x":"—"}
                </div>
              </div>
              <div style={{textAlign:"center"}}>
                <div style={{color:C.muted,marginBottom:2}}>MARGEM LÍQ.</div>
                <div style={{fontWeight:700,fontSize:16,color:c.margem>=30?C.green:c.margem>=15?C.yellow:c.recBruta>0?C.red:C.muted}}>
                  {c.recBruta>0?c.margem.toFixed(1)+"%":"—"}
                </div>
              </div>
              <div style={{textAlign:"center"}}>
                <div style={{color:C.muted,marginBottom:2}}>TOTAL VENDAS</div>
                <div style={{fontWeight:700,fontSize:16,color:C.blue}}>{c.totalVendas}</div>
              </div>
            </div>
          </div>
          <div style={{padding:"14px 18px",borderTop:`1px solid ${C.border}`,background:C.surface}}>
            <Lbl>OBSERVAÇÕES DO FECHAMENTO</Lbl>
            <FTxt rows={2} value={obs} onChange={e=>setObs(e.target.value)} sx={{marginBottom:10}}
                  placeholder="Anotações sobre o mês, destaques, pendências..."/>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              {fechado
                ? <><Btn v="ghost" onClick={salvarObs}>Salvar obs.</Btn><Btn v="yellow" onClick={reabrir}>Reabrir Mês</Btn></>
                : <><Btn v="ghost" onClick={salvarObs}>Salvar obs.</Btn><Btn v="green" onClick={fechar}>✓ Fechar Mês</Btn></>
              }
            </div>
          </div>
        </div>

        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:5,overflow:"hidden"}}>
          <div style={{padding:"13px 18px",background:C.surface,borderBottom:`1px solid ${C.border}`,fontSize:10,color:C.muted,letterSpacing:1}}>
            HISTÓRICO DE FECHAMENTOS
          </div>
          {historico.map((h,i)=>(
            <div key={h.mes} style={{padding:"12px 18px",borderBottom:i<historico.length-1?`1px solid ${C.border}`:"none",
                                     background:h.mes===mesSel?C.accentBg:"transparent"}}
              onMouseEnter={e=>h.mes!==mesSel&&(e.currentTarget.style.background=C.surface)}
              onMouseLeave={e=>h.mes!==mesSel&&(e.currentTarget.style.background="transparent")}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                <div style={{fontWeight:700,fontSize:12,color:h.mes===mesSel?C.accent:C.text}}>{h.label}</div>
                <span style={{background:h.status==="fechado"?C.greenBg:C.yellowBg,
                              color:h.status==="fechado"?C.green:C.yellow,
                              fontSize:9,padding:"1px 6px",borderRadius:2,fontWeight:700}}>
                  {h.status==="fechado"?"FECHADO":"ABERTO"}
                </span>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:4,fontSize:11}}>
                <div><span style={{color:C.muted}}>Receita: </span><span style={{color:C.green,fontWeight:600}}>{fmtRk(h.recBruta)}</span></div>
                <div><span style={{color:C.muted}}>Anúncios: </span><span style={{color:C.orange,fontWeight:600}}>{fmtRk(h.totalAds)}</span></div>
                <div><span style={{color:C.muted}}>Result.: </span><span style={{fontWeight:600,color:h.resultado>=0?C.accent:C.red}}>{fmtRk(h.resultado)}</span></div>
              </div>
              {h.roas>0&&<div style={{fontSize:10,color:C.muted,marginTop:4}}>ROAS {h.roas.toFixed(2)}x · Margem {h.recBruta>0?h.margem.toFixed(1):0}%</div>}
            </div>
          ))}
        </div>
      </div>

      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:5,overflow:"hidden"}}>
        <div style={{padding:"13px 18px",background:C.surface,borderBottom:`1px solid ${C.border}`,fontSize:10,color:C.muted,letterSpacing:1}}>
          COMPARATIVO DOS ÚLTIMOS 6 MESES
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr 1fr 1fr 1fr",
                     padding:"8px 14px",background:C.surface,borderBottom:`1px solid ${C.border}`}}>
          {["MÊS","REC. BRUTA","ANÚNCIOS","DESPESAS","RESULTADO","ROAS","MARGEM"].map(h=>(
            <div key={h} style={{fontSize:10,color:C.muted,letterSpacing:1}}>{h}</div>
          ))}
        </div>
        {[...historico].reverse().map((h,i,arr)=>(
          <div key={h.mes}
            style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr 1fr 1fr 1fr",
                    padding:"9px 14px",borderBottom:i<arr.length-1?`1px solid ${C.border}`:"none",
                    fontSize:12,background:h.mes===mesSel?C.accentBg:"transparent",alignItems:"center"}}
            onMouseEnter={e=>h.mes!==mesSel&&(e.currentTarget.style.background=C.surface)}
            onMouseLeave={e=>h.mes!==mesSel&&(e.currentTarget.style.background="transparent")}>
            <div style={{fontWeight:700,color:h.mes===mesSel?C.accent:C.text}}>
              {h.label}{h.status==="fechado"&&<span style={{marginLeft:5,fontSize:9,color:C.green}}>✓</span>}
            </div>
            <div style={{color:C.green,fontWeight:600}}>{fmtRk(h.recBruta)}</div>
            <div style={{color:C.orange}}>{fmtRk(h.totalAds)}</div>
            <div style={{color:C.yellow}}>{fmtRk(h.totalDesp)}</div>
            <div style={{fontWeight:700,color:h.resultado>=0?C.accent:C.red}}>{fmtRk(h.resultado)}</div>
            <div style={{color:h.roas>=3?C.green:h.roas>=2?C.yellow:h.roas>0?C.red:C.muted}}>
              {h.roas>0?h.roas.toFixed(2)+"x":"—"}
            </div>
            <div style={{color:h.margem>=30?C.green:h.margem>=15?C.yellow:h.recBruta>0?C.red:C.muted}}>
              {h.recBruta>0?h.margem.toFixed(1)+"%":"—"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── APP PRINCIPAL ────────────────────────────────────────────────────────────
export default function App() {
  const [loaded,     setLoaded]     = useState(false);
  const [dbError,    setDbError]    = useState(null);
  const [saving,     setSaving]     = useState(false);
  const [receitas,   setReceitas]   = useState([]);
  const [anuncios,   setAnuncios]   = useState([]);
  const [despesas,   setDespesas]   = useState([]);
  const [produtos,   setProdutos]   = useState([]);
  const [fechamentos,setFechamentos]= useState({});
  const [mesSel,     setMesSel]     = useState(mesAtu);
  const [aba,        setAba]        = useState("dashboard");
  const [toast,      setToast]      = useState(null);

  // ── Carga inicial ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!SB_ON) {
      // Sem Supabase: usa localStorage + dados demo
      setReceitas(loadLS("fd_receitas", DEMO_REC));
      setAnuncios(loadLS("fd_anuncios", DEMO_ADS));
      setDespesas(loadLS("fd_despesas", DEMO_DESP));
      setProdutos(loadLS("fd_produtos", DEMO_PRODS));
      setFechamentos(loadLS("fd_fechamentos", {}));
      setLoaded(true);
      return;
    }
    async function carregar() {
      try {
        const [recs, ads, desps, prods, fechs] = await Promise.all([
          sbGet("fd_receitas"),
          sbGet("fd_anuncios"),
          sbGet("fd_despesas"),
          sbGet("fd_produtos"),
          sbGet("fd_fechamentos"),
        ]);
        setReceitas(recs.map(recFromDB));
        setAnuncios(ads.map(adFromDB));
        setDespesas(desps.map(despFromDB));
        setProdutos(prods.map(prodFromDB));
        setFechamentos(fechsFromDB(fechs));
        setDbError(null);
      } catch(e) {
        console.error(e);
        setDbError(String(e.message||e));
      } finally {
        setLoaded(true);
      }
    }
    carregar();
  }, []);

  // ── Wrappers de sync para arrays ──────────────────────────────────────────
  function mkSync(setter, toDBFn, table, lsKey) {
    return fn => {
      setter(prev => {
        const next = typeof fn === "function" ? fn(prev) : fn;
        if (!SB_ON) { saveLS(lsKey, next); return next; }
        const prevMap = new Map(prev.map(x=>[x.id, x]));
        const nextMap = new Map(next.map(x=>[x.id, x]));
        const ops = [];
        for (const [id] of prevMap) {
          if (!nextMap.has(id)) ops.push(sbDelete(table, id));
        }
        for (const [id, item] of nextMap) {
          if (!prevMap.has(id) || JSON.stringify(prevMap.get(id)) !== JSON.stringify(item)) {
            ops.push(sbUpsert(table, [toDBFn(item)]));
          }
        }
        if (ops.length) {
          setSaving(true);
          Promise.all(ops.map(p => p.catch(console.error))).finally(() => setSaving(false));
        }
        return next;
      });
    };
  }

  const setReceitasSync   = mkSync(setReceitas,  recToDB,  "fd_receitas",  "fd_receitas");
  const setAnunciosSync   = mkSync(setAnuncios,  adToDB,   "fd_anuncios",  "fd_anuncios");
  const setDespesasSync   = mkSync(setDespesas,  despToDB, "fd_despesas",  "fd_despesas");
  const setProdutosSync   = mkSync(setProdutos,  prodToDB, "fd_produtos",  "fd_produtos");

  // ── Wrapper para fechamentos (objeto, não array) ───────────────────────────
  function setFechamentosSync(fn) {
    setFechamentos(prev => {
      const next = typeof fn === "function" ? fn(prev) : fn;
      if (!SB_ON) { saveLS("fd_fechamentos", next); return next; }
      const ops = [];
      for (const [mes, data] of Object.entries(next)) {
        if (JSON.stringify(prev[mes]) !== JSON.stringify(data)) {
          ops.push(sbUpsert("fd_fechamentos", [fechToDB(mes, data)]));
        }
      }
      if (ops.length) {
        setSaving(true);
        Promise.all(ops.map(p => p.catch(console.error))).finally(() => setSaving(false));
      }
      return next;
    });
  }

  function showToast(msg, tipo) {
    setToast({msg, t:tipo||"green"});
    setTimeout(() => setToast(null), 2800);
  }

  // ── Hooks devem ser chamados antes de qualquer return condicional ──────────
  const mesesDisp = useMemo(() => {
    const todos = new Set([
      mesAtu(),
      ...receitas.map(r => r.mes),
      ...anuncios.map(a => a.mes),
      ...despesas.map(d => d.mes),
    ]);
    return [...todos].sort().reverse().slice(0, 18);
  }, [receitas, anuncios, despesas]);

  // ── Telas de carregamento / setup ─────────────────────────────────────────
  if (!SB_ON) {
    if (!loaded) return <TelaSetup/>;
  } else {
    if (!loaded) return <TelaCarregando erro={dbError}/>;
    if (dbError)  return <TelaCarregando erro={dbError}/>;
  }

  const c      = calcMes(receitas, anuncios, despesas, mesSel);
  const fechado= fechamentos[mesSel]?.status === "fechado";

  const TABS = [
    {id:"dashboard", label:"📊 Dashboard"},
    {id:"receitas",  label:"💰 Receitas"},
    {id:"anuncios",  label:"📢 Anúncios"},
    {id:"despesas",  label:"💸 Despesas"},
    {id:"produtos",  label:"📦 Produtos"},
    {id:"fechamento",label:"📋 Fechamento"},
  ];

  return (
    <div style={{fontFamily:"'IBM Plex Mono','Courier New',monospace",background:C.bg,minHeight:"100vh",color:C.text}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:5px;height:5px;}
        ::-webkit-scrollbar-track{background:${C.bg};}
        ::-webkit-scrollbar-thumb{background:${C.faint};border-radius:3px;}
        select option{background:${C.card};}
        input[type=month]::-webkit-calendar-picker-indicator{filter:invert(.5);}
        @keyframes pulse{0%,100%{opacity:1;}50%{opacity:.3;}}
      `}</style>

      {/* HEADER */}
      <div style={{background:C.surface,borderBottom:`1px solid ${C.border}`,padding:"11px 24px",
                   display:"flex",alignItems:"center",justifyContent:"space-between",
                   position:"sticky",top:0,zIndex:100}}>
        <div style={{display:"flex",alignItems:"center",gap:14}}>
          <div style={{background:C.accent,color:"#fff",fontWeight:700,fontSize:14,
                       padding:"6px 14px",letterSpacing:2,borderRadius:3}}>FECHO MENSAL</div>
          <div>
            <div style={{fontSize:12,fontWeight:600}}>Gestão de Produtos Digitais</div>
            <div style={{display:"flex",gap:8,alignItems:"center",marginTop:2}}>
              {SB_ON
                ? saving
                  ? <span style={{fontSize:10,color:C.teal}}>☁ sincronizando...</span>
                  : <span style={{fontSize:10,color:C.green}}>✓ sincronizado · Supabase</span>
                : <span style={{fontSize:10,color:C.yellow}}>⚠ modo local (sem Supabase)</span>
              }
            </div>
          </div>
        </div>

        {/* Seletor de mês */}
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <div style={{fontSize:10,color:C.muted,letterSpacing:1}}>MÊS</div>
          <FSel value={mesSel} onChange={e=>setMesSel(e.target.value)} sx={{width:150,fontWeight:700,fontSize:13}}>
            {mesesDisp.map(m=>(
              <option key={m} value={m}>
                {mesLbl(m)}{fechamentos[m]?.status==="fechado"?" ✓":""}
              </option>
            ))}
          </FSel>
          {fechado && (
            <span style={{background:C.greenBg,color:C.green,border:`1px solid ${C.green}33`,
                          fontSize:10,padding:"3px 8px",borderRadius:3,fontWeight:700}}>FECHADO</span>
          )}
        </div>

        {/* Resumo financeiro */}
        <div style={{display:"flex",gap:16,alignItems:"center",fontSize:12}}>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:10,color:C.muted}}>RECEITA</div>
            <div style={{fontWeight:700,color:C.green}}>{fmtRk(c.recBruta)}</div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:10,color:C.muted}}>ROAS</div>
            <div style={{fontWeight:700,color:c.roas>=3?C.green:c.roas>=2?C.yellow:c.totalAds>0?C.red:C.muted}}>
              {c.roas>0?c.roas.toFixed(2)+"x":"—"}
            </div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:10,color:C.muted}}>RESULTADO</div>
            <div style={{fontWeight:700,color:c.resultado>=0?C.accent:C.red}}>{fmtRk(c.resultado)}</div>
          </div>
        </div>
      </div>

      {/* TABS */}
      <div style={{background:C.surface,borderBottom:`1px solid ${C.border}`,
                   padding:"0 24px",display:"flex",gap:2,overflowX:"auto"}}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setAba(t.id)} style={{
            background:"none",border:"none",
            borderBottom:`2px solid ${aba===t.id?C.accent:"transparent"}`,
            color:aba===t.id?C.text:C.muted,
            padding:"11px 14px",cursor:"pointer",fontFamily:"inherit",
            fontSize:12,fontWeight:aba===t.id?600:400,whiteSpace:"nowrap",
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* CONTEÚDO */}
      <div style={{padding:"20px 24px",maxWidth:1400,margin:"0 auto"}}>
        {aba==="dashboard"  && <TabDashboard  receitas={receitas} anuncios={anuncios} despesas={despesas} produtos={produtos} fechamentos={fechamentos} mesSel={mesSel}/>}
        {aba==="receitas"   && <TabReceitas   receitas={receitas} setReceitas={setReceitasSync} produtos={produtos} mesSel={mesSel} showToast={showToast}/>}
        {aba==="anuncios"   && <TabAnuncios   anuncios={anuncios} setAnuncios={setAnunciosSync} receitas={receitas} mesSel={mesSel} showToast={showToast}/>}
        {aba==="despesas"   && <TabDespesas   despesas={despesas} setDespesas={setDespesasSync} mesSel={mesSel} showToast={showToast}/>}
        {aba==="produtos"   && <TabProdutos   produtos={produtos} setProdutos={setProdutosSync} receitas={receitas} mesSel={mesSel} showToast={showToast}/>}
        {aba==="fechamento" && <TabFechamento receitas={receitas} anuncios={anuncios} despesas={despesas} fechamentos={fechamentos} setFechamentos={setFechamentosSync} mesSel={mesSel} showToast={showToast}/>}
      </div>

      <Toast toast={toast}/>
    </div>
  );
}
