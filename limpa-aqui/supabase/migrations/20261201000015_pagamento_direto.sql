-- =====================================================================
-- LIMPA AQUI — Marketplace, Etapa 5a: pagamento direto com registro
--  * commission_rules: regras de comissão editáveis pelo admin (nada fixo no código); sem regra = sem comissão
--  * platform_commissions: comissão de cada pedido do marketplace, pela regra vigente na data do pedido
--  * external_payment_confirmations: o prestador confirma que recebeu o pagamento direto (comprovante opcional)
--  * financial_ledger: livro-razão só de inclusão (ninguém altera nem apaga)
--  * pedidos do marketplace: "pago" só muda pela confirmação (nunca pelo interruptor)
-- =====================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'commission_status') then
    create type public.commission_status as enum ('prevista', 'a_cobrar', 'paga', 'cancelada');
  end if;
  if not exists (select 1 from pg_type where typname = 'direct_payment_method') then
    create type public.direct_payment_method as enum ('pix', 'dinheiro', 'cartao', 'outro');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Livro-razão (só inclusão)
-- ---------------------------------------------------------------------
create table if not exists public.financial_ledger (
  id           bigserial primary key,
  event        text not null check (event ~ '^[a-z_]{3,40}$'),
  order_id     uuid references public.orders (id) on delete set null,
  business_id  uuid references public.businesses (id) on delete set null,
  payment_mode public.payment_mode,
  amount       numeric(12, 2) not null default 0,
  details      jsonb not null default '{}'::jsonb,
  actor        uuid default auth.uid(),
  created_at   timestamptz not null default now()
);

create index if not exists financial_ledger_business_idx on public.financial_ledger (business_id, created_at desc);
create index if not exists financial_ledger_order_idx on public.financial_ledger (order_id);

create or replace function public.ledger_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- só a limpeza de vínculo (on delete set null) é aceita; o lançamento em si nunca muda
  if tg_op = 'UPDATE' and new.event = old.event and new.amount = old.amount and new.details = old.details
     and new.created_at = old.created_at and new.payment_mode is not distinct from old.payment_mode
     and (new.order_id is null or new.order_id = old.order_id) and (new.business_id is null or new.business_id = old.business_id) then
    return new;
  end if;
  raise exception 'O livro-razão não pode ser alterado nem apagado.' using errcode = '42501';
end;
$$;

create trigger financial_ledger_immutable
  before update or delete on public.financial_ledger
  for each row execute function public.ledger_immutable();

create or replace function public.ledger_add(p_event text, p_order uuid, p_business uuid, p_mode public.payment_mode,
                                             p_amount numeric, p_details jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.financial_ledger (event, order_id, business_id, payment_mode, amount, details)
  values (p_event, p_order, p_business, p_mode, coalesce(p_amount, 0), coalesce(p_details, '{}'::jsonb));
$$;

alter table public.financial_ledger enable row level security;
create policy financial_ledger_select on public.financial_ledger for select to authenticated
  using (public.has_role('admin') or (business_id is not null and public.is_business_owner(business_id)));
revoke all on public.financial_ledger from anon, authenticated;
grant select on public.financial_ledger to authenticated;

-- ---------------------------------------------------------------------
-- Regras de comissão (admin)
-- ---------------------------------------------------------------------
create table if not exists public.commission_rules (
  id              uuid primary key default gen_random_uuid(),
  payment_mode    public.payment_mode not null,
  category_code   text references public.service_categories (code),
  municipality_id integer references public.municipalities (id),
  percent         numeric(5, 2) not null default 0 check (percent between 0 and 50),
  fixed_amount    numeric(10, 2) not null default 0 check (fixed_amount between 0 and 1000),
  valid_from      timestamptz not null default now(),
  valid_to        timestamptz,
  notes           text check (notes is null or char_length(notes) <= 200),
  created_by      uuid references auth.users (id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  check (valid_to is null or valid_to > valid_from),
  check (percent > 0 or fixed_amount > 0)
);

alter table public.commission_rules enable row level security;
create policy commission_rules_select_admin on public.commission_rules for select to authenticated using (public.has_role('admin'));
revoke all on public.commission_rules from anon, authenticated;
grant select on public.commission_rules to authenticated;

-- ---------------------------------------------------------------------
-- Comissões por pedido
-- ---------------------------------------------------------------------
create table if not exists public.platform_commissions (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null unique references public.orders (id) on delete cascade,
  business_id       uuid not null references public.businesses (id) on delete cascade,
  rule_id           uuid references public.commission_rules (id) on delete set null,
  payment_mode      public.payment_mode not null,
  base_amount       numeric(12, 2) not null,
  percent           numeric(5, 2) not null,
  fixed_amount      numeric(10, 2) not null,
  commission_amount numeric(12, 2) not null check (commission_amount >= 0),
  status            public.commission_status not null default 'prevista',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists platform_commissions_business_idx on public.platform_commissions (business_id, status);

create trigger platform_commissions_updated_at
  before update on public.platform_commissions
  for each row execute function public.set_updated_at();

alter table public.platform_commissions enable row level security;
create policy platform_commissions_select on public.platform_commissions for select to authenticated
  using (public.has_role('admin') or public.is_business_owner(business_id));
revoke all on public.platform_commissions from anon, authenticated;
grant select on public.platform_commissions to authenticated;

-- Regra vigente para um pedido: a mais específica (categoria + município > categoria > município > geral), na data do pedido
create or replace function public.commission_rule_for(p_order_id uuid)
returns public.commission_rules
language sql
stable
security definer
set search_path = ''
as $$
  with o as (
    select o.id, o.created_at, o.payment_mode, c.municipality_id,
           coalesce((select l.category_code from public.listings l where l.id = o.listing_id),
                    (select s.category_code from public.order_items i join public.services s on s.id = i.service_id
                     where i.order_id = o.id and s.category_code is not null order by i.position limit 1)) as category_code
    from public.orders o join public.customers c on c.id = o.customer_id
    where o.id = p_order_id
  )
  select r.*
  from public.commission_rules r, o
  where r.payment_mode = o.payment_mode
    and r.valid_from <= o.created_at and (r.valid_to is null or r.valid_to > o.created_at)
    and (r.category_code is null or r.category_code = o.category_code)
    and (r.municipality_id is null or r.municipality_id = o.municipality_id)
  order by (r.category_code is not null)::int + (r.municipality_id is not null)::int desc, r.valid_from desc
  limit 1;
$$;

-- Pedido do marketplace com valor definido: registra no livro e prevê a comissão (uma vez)
create or replace function public.marketplace_order_finance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.commission_rules;
  v_amount numeric;
begin
  if new.origin <> 'marketplace' or new.payment_mode is null then
    return new;
  end if;

  -- valor definido (a função de contratação grava o total depois dos itens)
  if tg_op = 'UPDATE' and old.total is distinct from new.total and new.total > 0
     and not exists (select 1 from public.financial_ledger f where f.order_id = new.id and f.event = 'pedido_marketplace') then
    perform public.ledger_add('pedido_marketplace', new.id, new.business_id, new.payment_mode, new.total,
                              jsonb_build_object('number', new.number, 'logistics_mode', new.logistics_mode));
    r := public.commission_rule_for(new.id);
    if r.id is not null then
      v_amount := round(new.total * r.percent / 100 + r.fixed_amount, 2);
      insert into public.platform_commissions (order_id, business_id, rule_id, payment_mode, base_amount, percent, fixed_amount, commission_amount)
      values (new.id, new.business_id, r.id, new.payment_mode, new.total, r.percent, r.fixed_amount, v_amount)
      on conflict (order_id) do nothing;
      perform public.ledger_add('comissao_prevista', new.id, new.business_id, new.payment_mode, v_amount,
                                jsonb_build_object('rule_id', r.id, 'percent', r.percent, 'fixed', r.fixed_amount));
    end if;
  end if;

  -- pedido cancelado: comissão que ainda não foi paga é cancelada
  if tg_op = 'UPDATE' and new.status = 'cancelado' and old.status <> 'cancelado' then
    perform public.ledger_add('pedido_cancelado', new.id, new.business_id, new.payment_mode, new.total, '{}'::jsonb);
    update public.platform_commissions set status = 'cancelada'
     where order_id = new.id and status in ('prevista', 'a_cobrar');
    if found then
      perform public.ledger_add('comissao_cancelada', new.id, new.business_id, new.payment_mode,
                                (select commission_amount from public.platform_commissions where order_id = new.id), '{}'::jsonb);
    end if;
  end if;
  return new;
end;
$$;

create trigger orders_marketplace_finance
  after update on public.orders
  for each row execute function public.marketplace_order_finance();

-- "Pago" de pedido do marketplace só muda pela confirmação de pagamento
create or replace function public.protect_marketplace_paid()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('limpaaqui.internal', true) = 'on' then
    return new;
  end if;
  if old.origin = 'marketplace' and new.paid is distinct from old.paid then
    raise exception 'Em pedidos do Limpa Aqui, use "Confirmar recebimento" para registrar o pagamento.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger orders_protect_marketplace_paid
  before update of paid on public.orders
  for each row execute function public.protect_marketplace_paid();

-- ---------------------------------------------------------------------
-- Confirmação de pagamento direto (prestador)
-- ---------------------------------------------------------------------
create table if not exists public.external_payment_confirmations (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null unique references public.orders (id) on delete cascade,
  business_id   uuid not null references public.businesses (id) on delete cascade,
  payer_user_id uuid references auth.users (id) on delete set null,
  amount        numeric(12, 2) not null check (amount > 0 and amount <= 99999999),
  method        public.direct_payment_method not null,
  evidence_path text check (evidence_path is null or char_length(evidence_path) <= 300),
  confirmed_by  uuid references auth.users (id) on delete set null,
  confirmed_at  timestamptz not null default now()
);

alter table public.external_payment_confirmations enable row level security;
create policy external_payments_select on public.external_payment_confirmations for select to authenticated
  using (public.has_role('admin') or public.is_business_member(business_id) or payer_user_id = auth.uid());
revoke all on public.external_payment_confirmations from anon, authenticated;
grant select on public.external_payment_confirmations to authenticated;

create or replace function public.confirm_direct_payment(
  p_order_id uuid, p_amount numeric, p_method public.direct_payment_method, p_evidence_path text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
begin
  select * into o from public.orders where id = p_order_id for update;
  if o.id is null or not public.is_business_member(o.business_id) then
    raise exception 'Pedido não encontrado.' using errcode = 'P0001';
  end if;
  if o.origin <> 'marketplace' or o.payment_mode is distinct from 'direto' then
    raise exception 'Este pedido não é de pagamento direto pelo Limpa Aqui.' using errcode = 'P0001';
  end if;
  if o.status in ('cancelado', 'orcamento') then
    raise exception 'Pedido cancelado não recebe pagamento.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.external_payment_confirmations e where e.order_id = o.id) then
    raise exception 'O recebimento deste pedido já foi confirmado.' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 99999999 then
    raise exception 'Informe o valor recebido.' using errcode = '22023';
  end if;
  if p_evidence_path is not null and public.business_of_path(p_evidence_path) is distinct from o.business_id then
    raise exception 'Comprovante inválido.' using errcode = '22023';
  end if;

  insert into public.external_payment_confirmations (order_id, business_id, payer_user_id, amount, method, evidence_path, confirmed_by)
  values (o.id, o.business_id, o.client_user_id, round(p_amount, 2), p_method, p_evidence_path, auth.uid());

  perform set_config('limpaaqui.internal', 'on', true);
  update public.orders set paid = true where id = o.id;
  perform set_config('limpaaqui.internal', 'off', true);

  perform public.ledger_add('pagamento_direto_confirmado', o.id, o.business_id, 'direto', round(p_amount, 2),
                            jsonb_build_object('method', p_method, 'evidence', p_evidence_path is not null));

  -- comissão passa a ser cobrável, sobre o valor efetivamente recebido
  update public.platform_commissions c
     set status = 'a_cobrar', base_amount = round(p_amount, 2),
         commission_amount = round(round(p_amount, 2) * c.percent / 100 + c.fixed_amount, 2)
   where c.order_id = o.id and c.status = 'prevista';
  if found then
    perform public.ledger_add('comissao_a_cobrar', o.id, o.business_id, 'direto',
                              (select commission_amount from public.platform_commissions where order_id = o.id), '{}'::jsonb);
  end if;
end;
$$;

-- O que o prestador vê sobre o dinheiro de um pedido
create or replace function public.order_finance(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o public.orders;
begin
  select * into o from public.orders where id = p_order_id;
  if o.id is null or not public.is_business_member(o.business_id) then
    raise exception 'Pedido não encontrado.' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'confirmation', (select jsonb_build_object('amount', e.amount, 'method', e.method, 'confirmed_at', e.confirmed_at,
                                               'has_evidence', e.evidence_path is not null)
                     from public.external_payment_confirmations e where e.order_id = o.id),
    'commission', case when public.is_business_owner(o.business_id) then
                    (select jsonb_build_object('amount', c.commission_amount, 'percent', c.percent, 'fixed', c.fixed_amount, 'status', c.status)
                     from public.platform_commissions c where c.order_id = o.id) end
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Administração financeira
-- ---------------------------------------------------------------------
create or replace function public.admin_create_commission_rule(
  p_payment_mode public.payment_mode, p_percent numeric, p_fixed numeric default 0,
  p_category text default null, p_municipality_id integer default null, p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.has_role('admin') then
    raise exception 'Somente a administração da plataforma pode fazer isso.' using errcode = '42501';
  end if;
  if coalesce(p_percent, 0) < 0 or coalesce(p_percent, 0) > 50 or coalesce(p_fixed, 0) < 0 or coalesce(p_fixed, 0) > 1000 then
    raise exception 'Percentual entre 0 e 50 e valor fixo entre 0 e 1000.' using errcode = '22023';
  end if;
  -- a nova regra substitui a que valia para o mesmo recorte (a antiga fica no histórico)
  update public.commission_rules set valid_to = now()
   where payment_mode = p_payment_mode and category_code is not distinct from p_category
     and municipality_id is not distinct from p_municipality_id and valid_to is null;
  insert into public.commission_rules (payment_mode, category_code, municipality_id, percent, fixed_amount, notes)
  values (p_payment_mode, p_category, p_municipality_id, coalesce(p_percent, 0), coalesce(p_fixed, 0), nullif(trim(coalesce(p_notes, '')), ''))
  returning id into v_id;
  perform public.ledger_add('regra_comissao_criada', null, null, p_payment_mode, 0,
                            jsonb_build_object('rule_id', v_id, 'percent', p_percent, 'fixed', p_fixed, 'category', p_category, 'municipality', p_municipality_id));
  return v_id;
end;
$$;

create or replace function public.admin_end_commission_rule(p_rule_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_role('admin') then
    raise exception 'Somente a administração da plataforma pode fazer isso.' using errcode = '42501';
  end if;
  update public.commission_rules set valid_to = now() where id = p_rule_id and valid_to is null;
  if not found then
    raise exception 'Regra não encontrada ou já encerrada.' using errcode = 'P0001';
  end if;
  perform public.ledger_add('regra_comissao_encerrada', null, null, null, 0, jsonb_build_object('rule_id', p_rule_id));
end;
$$;

create or replace function public.admin_set_commission_status(p_commission_id uuid, p_status public.commission_status)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.platform_commissions;
begin
  if not public.has_role('admin') then
    raise exception 'Somente a administração da plataforma pode fazer isso.' using errcode = '42501';
  end if;
  select * into c from public.platform_commissions where id = p_commission_id for update;
  if c.id is null then
    raise exception 'Comissão não encontrada.' using errcode = 'P0001';
  end if;
  if not ((c.status = 'a_cobrar' and p_status in ('paga', 'cancelada')) or (c.status = 'prevista' and p_status = 'cancelada')) then
    raise exception 'Mudança de situação não permitida.' using errcode = 'P0001';
  end if;
  update public.platform_commissions set status = p_status where id = c.id;
  perform public.ledger_add('comissao_' || p_status::text, c.order_id, c.business_id, c.payment_mode, c.commission_amount, '{}'::jsonb);
end;
$$;

-- Resumo financeiro separado por modalidade (o externo é só "declarado": nunca passa pela plataforma)
create or replace function public.admin_finance_summary()
returns table (payment_mode public.payment_mode, orders bigint, orders_total numeric, confirmed_orders bigint, confirmed_total numeric,
               commission_expected numeric, commission_to_collect numeric, commission_paid numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_role('admin') then
    raise exception 'Somente a administração da plataforma pode fazer isso.' using errcode = '42501';
  end if;
  return query
  select m.mode,
         (select count(*) from public.orders o where o.origin = 'marketplace' and o.payment_mode = m.mode and o.status <> 'cancelado'),
         coalesce((select sum(o.total) from public.orders o where o.origin = 'marketplace' and o.payment_mode = m.mode and o.status <> 'cancelado'), 0),
         (select count(*) from public.external_payment_confirmations e join public.orders o on o.id = e.order_id where o.payment_mode = m.mode),
         coalesce((select sum(e.amount) from public.external_payment_confirmations e join public.orders o on o.id = e.order_id where o.payment_mode = m.mode), 0),
         coalesce((select sum(c.commission_amount) from public.platform_commissions c where c.payment_mode = m.mode and c.status = 'prevista'), 0),
         coalesce((select sum(c.commission_amount) from public.platform_commissions c where c.payment_mode = m.mode and c.status = 'a_cobrar'), 0),
         coalesce((select sum(c.commission_amount) from public.platform_commissions c where c.payment_mode = m.mode and c.status = 'paga'), 0)
  from (values ('direto'::public.payment_mode), ('app'::public.payment_mode)) as m (mode);
end;
$$;

create or replace function public.admin_list_commissions(p_status public.commission_status default null)
returns table (id uuid, order_id uuid, order_number integer, business_name text, payment_mode public.payment_mode,
               base_amount numeric, percent numeric, fixed_amount numeric, commission_amount numeric,
               status public.commission_status, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_role('admin') then
    raise exception 'Somente a administração da plataforma pode fazer isso.' using errcode = '42501';
  end if;
  return query
  select c.id, c.order_id, o.number, b.name, c.payment_mode, c.base_amount, c.percent, c.fixed_amount, c.commission_amount, c.status, c.created_at
  from public.platform_commissions c
  join public.orders o on o.id = c.order_id
  join public.businesses b on b.id = c.business_id
  where p_status is null or c.status = p_status
  order by c.created_at desc
  limit 300;
end;
$$;

-- ---------------------------------------------------------------------
-- Comprovantes (bucket privado): membros da lavanderia e admin
-- ---------------------------------------------------------------------
do $outer$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'Storage não disponível neste banco; bucket de comprovantes não criado.';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('payment-evidence', 'payment-evidence', false, 3145728, array['image/jpeg', 'image/webp'])
  on conflict (id) do update
    set public = false, file_size_limit = 3145728, allowed_mime_types = array['image/jpeg', 'image/webp'];

  execute 'drop policy if exists payment_evidence_read on storage.objects';
  execute 'drop policy if exists payment_evidence_write on storage.objects';
  execute $p$
    create policy payment_evidence_read on storage.objects for select to authenticated
      using (bucket_id = 'payment-evidence'
             and (public.is_business_member(public.business_of_path(name)) or public.has_role('admin')))
  $p$;
  execute $p$
    create policy payment_evidence_write on storage.objects for insert to authenticated
      with check (bucket_id = 'payment-evidence' and public.is_business_member(public.business_of_path(name)))
  $p$;
end
$outer$;

revoke all on function public.ledger_add(text, uuid, uuid, public.payment_mode, numeric, jsonb) from public, anon, authenticated;
revoke all on function public.ledger_immutable() from public, anon, authenticated;
revoke all on function public.commission_rule_for(uuid) from public, anon, authenticated;
revoke all on function public.marketplace_order_finance() from public, anon, authenticated;
revoke all on function public.confirm_direct_payment(uuid, numeric, public.direct_payment_method, text) from public, anon;
revoke all on function public.order_finance(uuid) from public, anon;
revoke all on function public.admin_create_commission_rule(public.payment_mode, numeric, numeric, text, integer, text) from public, anon;
revoke all on function public.admin_end_commission_rule(uuid) from public, anon;
revoke all on function public.admin_set_commission_status(uuid, public.commission_status) from public, anon;
revoke all on function public.admin_finance_summary() from public, anon;
revoke all on function public.admin_list_commissions(public.commission_status) from public, anon;
grant execute on function public.confirm_direct_payment(uuid, numeric, public.direct_payment_method, text) to authenticated;
grant execute on function public.order_finance(uuid) to authenticated;
grant execute on function public.admin_create_commission_rule(public.payment_mode, numeric, numeric, text, integer, text) to authenticated;
grant execute on function public.admin_end_commission_rule(uuid) to authenticated;
grant execute on function public.admin_set_commission_status(uuid, public.commission_status) to authenticated;
grant execute on function public.admin_finance_summary() to authenticated;
grant execute on function public.admin_list_commissions(public.commission_status) to authenticated;
