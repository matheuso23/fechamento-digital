-- ================================================================
-- FECHO MENSAL — Setup do Banco de Dados Supabase
-- Execute este SQL no SQL Editor do seu projeto Supabase
-- (Menu lateral > SQL Editor > New query)
-- ================================================================

-- Receitas por plataforma
create table if not exists fd_receitas (
  id text primary key,
  mes text not null,
  plataforma text not null default 'outros',
  produto text default '',
  valor numeric(12,2) not null default 0,
  unidades integer not null default 1,
  obs text default ''
);

-- Investimentos em anúncios
create table if not exists fd_anuncios (
  id text primary key,
  mes text not null,
  plataforma text not null default 'meta',
  campanha text not null default '',
  investimento numeric(12,2) not null default 0,
  obs text default ''
);

-- Despesas operacionais
create table if not exists fd_despesas (
  id text primary key,
  mes text not null,
  cat text not null default 'outros_d',
  descricao text not null default '',
  valor numeric(12,2) not null default 0,
  recorrente boolean not null default false,
  obs text default ''
);

-- Catálogo de produtos
create table if not exists fd_produtos (
  id text primary key,
  nome text not null,
  tipo text not null default 'curso',
  preco numeric(12,2) not null default 0,
  ativo boolean not null default true
);

-- Fechamentos mensais
create table if not exists fd_fechamentos (
  mes text primary key,
  status text not null default 'aberto',
  obs text default '',
  data_fechamento text
);

-- ── Políticas de acesso (RLS) ─────────────────────────────────────────────────
alter table fd_receitas    enable row level security;
alter table fd_anuncios    enable row level security;
alter table fd_despesas    enable row level security;
alter table fd_produtos    enable row level security;
alter table fd_fechamentos enable row level security;

create policy "acesso_total" on fd_receitas    for all using (true) with check (true);
create policy "acesso_total" on fd_anuncios    for all using (true) with check (true);
create policy "acesso_total" on fd_despesas    for all using (true) with check (true);
create policy "acesso_total" on fd_produtos    for all using (true) with check (true);
create policy "acesso_total" on fd_fechamentos for all using (true) with check (true);
