-- =====================================================================
-- LIMPA AQUI — Marketplace, Etapa 8: planos e assinaturas dos prestadores
--  * plans / plan_features: planos editáveis pelo admin (preço, período, recursos liberados,
--    limite de pedidos de balcão por mês, limite de funcionários, destaque na busca). Nada fixo no código.
--  * Plano padrão "Grátis" libera todos os recursos que existem hoje: ninguém perde acesso.
--  * subscriptions: plano de cada lavanderia; vencido além da tolerância (platform_settings),
--    vale o plano padrão automaticamente (sem rotina agendada).
--  * subscription_invoices: mensalidade paga por Pix na SyncPay (mesma integração da Etapa 5b).
--  * search_providers: prestador em plano com destaque aparece primeiro e com selo.
-- =====================================================================

alter table public.platform_settings
  add column if not exists subscription_grace_days integer not null default 5 check (subscription_grace_days between 0 and 60);

-- ---------------------------------------------------------------------
-- Planos
-- ---------------------------------------------------------------------
create table if not exists public.plans (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique check (code ~ '^[a-z][a-z0-9_]{1,29}$'),
  name             text not null check (char_length(name) between 2 and 40),
  description      text check (description is null or char_length(description) <= 300),
  price            numeric(10, 2) not null default 0 check (price between 0 and 100000),
  period_days      integer not null default 30 check (period_days between 1 and 366),
  max_orders_month integer check (max_orders_month is null or max_orders_month > 0),
  max_staff        integer check (max_staff is null or max_staff >= 0),
  featured         boolean not null default false,
  is_default       boolean not null default false,
  public           boolean not null default true,
  active           boolean not null default true,
  sort             integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (not is_default or (price = 0 and active))
);
create unique index if not exists plans_one_default on public.plans (is_default) where is_default;

create trigger plans_updated_at
  before update on public.plans
  for each row execute function public.set_updated_at();

create table if not exists public.plan_features (
  plan_id      uuid not null references public.plans (id) on delete cascade,
  feature_code text not null references public.features (code) on delete cascade,
  primary key (plan_id, feature_code)
);

-- Plano padrão: tudo o que existe hoje
insert into public.plans (code, name, description, price, period_days, is_default, sort)
values ('gratis', 'Grátis', 'Todos os recursos de gestão e o marketplace, sem mensalidade.', 0, 30, true, 0)
on conflict (code) do nothing;
insert into public.plan_features (plan_id, feature_code)
select p.id, f.code from public.plans p cross join public.features f where p.code = 'gratis'
on conflict do nothing;

alter table public.plans enable row level security;
alter table public.plan_features enable row level security;
create policy plans_select on public.plans for select to anon, authenticated using ((active and public) or public.has_role('admin'));
create policy plan_features_select on public.plan_features for select to anon, authenticated
  using (exists (select 1 from public.plans p where p.id = plan_id and ((p.active and p.public) or public.has_role('admin'))));
revoke all on public.plans, public.plan_features from anon, authenticated;
grant select on public.plans, public.plan_features to anon, authenticated;

-- ---------------------------------------------------------------------
-- Assinaturas e mensalidades
-- ---------------------------------------------------------------------
create table if not exists public.subscriptions (
  business_id        uuid primary key references public.businesses (id) on delete cascade,
  plan_id            uuid not null references public.plans (id),
  status             text not null default 'ativa' check (status in ('ativa', 'cancelada')),
  current_period_end timestamptz,
  source             text not null default 'pagamento' check (source in ('pagamento', 'admin', 'gratis')),
  updated_at         timestamptz not null default now(),
  updated_by         uuid references auth.users (id) on delete set null
);

create table if not exists public.subscription_invoices (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  plan_id      uuid not null references public.plans (id),
  amount       numeric(10, 2) not null check (amount > 0),
  status       text not null default 'aberta' check (status in ('aberta', 'paga', 'cancelada', 'estornada')),
  period_start timestamptz,
  period_end   timestamptz,
  paid_at      timestamptz,
  created_by   uuid references auth.users (id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now()
);
create index if not exists subscription_invoices_business_idx on public.subscription_invoices (business_id, created_at desc);

alter table public.payment_transactions
  add column if not exists invoice_id uuid references public.subscription_invoices (id) on delete set null;
alter table public.payment_transactions drop constraint if exists payment_transactions_one_target;
alter table public.payment_transactions add constraint payment_transactions_one_target check (order_id is null or invoice_id is null);
create index if not exists payment_transactions_invoice_idx on public.payment_transactions (invoice_id) where invoice_id is not null;
grant select (invoice_id) on public.payment_transactions to authenticated;

alter table public.subscriptions enable row level security;
alter table public.subscription_invoices enable row level security;
create policy subscriptions_select on public.subscriptions for select to authenticated
  using (public.has_role('admin') or public.is_business_member(business_id));
create policy subscription_invoices_select on public.subscription_invoices for select to authenticated
  using (public.has_role('admin') or public.is_business_owner(business_id));
revoke all on public.subscriptions, public.subscription_invoices from anon, authenticated;
grant select on public.subscriptions, public.subscription_invoices to authenticated;

-- Plano que vale agora: assinatura ativa e dentro do prazo (+ tolerância); senão, o padrão
create or replace function public.business_plan_id(p_business_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.plan_id from public.subscriptions s
      where s.business_id = p_business_id and s.status = 'ativa'
        and (s.current_period_end is null
             or s.current_period_end + make_interval(days => (select ps.subscription_grace_days from public.platform_settings ps where ps.id)) > now())),
    (select p.id from public.plans p where p.is_default));
$$;

create or replace function public.plan_allows(p_business_id uuid, p_feature text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.plan_features pf where pf.plan_id = public.business_plan_id(p_business_id) and pf.feature_code = p_feature);
$$;

-- Pedidos de balcão no mês (fuso da lavanderia)
create or replace function public.orders_this_month(p_business_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from public.orders o
   where o.business_id = p_business_id and o.origin = 'balcao'
     and o.created_at >= (date_trunc('month', now() at time zone coalesce(
           (select s.timezone from public.business_settings s where s.business_id = p_business_id), 'America/Sao_Paulo'))
           at time zone coalesce((select s.timezone from public.business_settings s where s.business_id = p_business_id), 'America/Sao_Paulo'));
$$;

-- Limite de pedidos de balcão por mês (pedidos do marketplace nunca são barrados)
create or replace function public.enforce_plan_order_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max integer;
begin
  if new.origin is distinct from 'balcao' then
    return new;
  end if;
  select p.max_orders_month into v_max from public.plans p where p.id = public.business_plan_id(new.business_id);
  if v_max is not null and public.orders_this_month(new.business_id) >= v_max then
    raise exception 'Seu plano permite % pedidos de balcão por mês. Veja os planos em "Meu plano".', v_max using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger orders_plan_limit
  before insert on public.orders
  for each row execute function public.enforce_plan_order_limit();

-- Limite de funcionários
create or replace function public.enforce_plan_staff_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max integer;
begin
  if new.role <> 'staff' then
    return new;
  end if;
  select p.max_staff into v_max from public.plans p where p.id = public.business_plan_id(new.business_id);
  if v_max is not null and (select count(*) from public.business_members m where m.business_id = new.business_id and m.role = 'staff') >= v_max then
    raise exception 'O plano desta lavanderia permite % funcionário(s). O dono pode mudar de plano em "Meu plano".', v_max using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger business_members_plan_limit
  before insert on public.business_members
  for each row execute function public.enforce_plan_staff_limit();

-- ---------------------------------------------------------------------
-- Prestador: meu plano, catálogo, escolher, pagar
-- ---------------------------------------------------------------------
create or replace function public.public_plans()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'code', p.code, 'name', p.name, 'description', p.description, 'price', p.price,
           'period_days', p.period_days, 'max_orders_month', p.max_orders_month, 'max_staff', p.max_staff,
           'featured', p.featured, 'is_default', p.is_default,
           'features', coalesce((select jsonb_agg(f.code order by f.sort) from public.plan_features pf
                                 join public.features f on f.code = pf.feature_code where pf.plan_id = p.id), '[]'::jsonb))
         order by p.sort, p.price), '[]'::jsonb)
  from public.plans p
  where p.active and p.public;
$$;

create or replace function public.my_plan(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_plan public.plans;
  s public.subscriptions;
  v_grace integer;
  v_owner boolean;
begin
  if not public.is_business_member(p_business_id) then
    raise exception 'Lavanderia não encontrada.' using errcode = '42501';
  end if;
  v_owner := public.is_business_owner(p_business_id);
  select * into v_plan from public.plans where id = public.business_plan_id(p_business_id);
  select * into s from public.subscriptions where business_id = p_business_id;
  select ps.subscription_grace_days into v_grace from public.platform_settings ps where ps.id;
  return jsonb_build_object(
    'plan', jsonb_build_object('id', v_plan.id, 'code', v_plan.code, 'name', v_plan.name, 'price', v_plan.price,
                               'period_days', v_plan.period_days, 'max_orders_month', v_plan.max_orders_month,
                               'max_staff', v_plan.max_staff, 'featured', v_plan.featured, 'is_default', v_plan.is_default),
    'features', coalesce((select jsonb_agg(pf.feature_code) from public.plan_features pf where pf.plan_id = v_plan.id), '[]'::jsonb),
    'subscription', case when s.business_id is not null then jsonb_build_object(
                      'plan_id', s.plan_id, 'plan_name', (select p.name from public.plans p where p.id = s.plan_id),
                      'status', s.status, 'current_period_end', s.current_period_end, 'source', s.source,
                      'expired', s.current_period_end is not null and s.current_period_end <= now(),
                      'grace_until', case when s.current_period_end is not null then s.current_period_end + make_interval(days => v_grace) end) end,
    'usage', jsonb_build_object('orders_month', public.orders_this_month(p_business_id),
                                'staff', (select count(*) from public.business_members m where m.business_id = p_business_id and m.role = 'staff')),
    'open_invoice', case when v_owner then
                      (select jsonb_build_object('id', i.id, 'amount', i.amount, 'plan_id', i.plan_id,
                                                 'plan_name', (select p.name from public.plans p where p.id = i.plan_id), 'created_at', i.created_at)
                       from public.subscription_invoices i where i.business_id = p_business_id and i.status = 'aberta'
                       order by i.created_at desc limit 1) end,
    'can_pay', public.app_payment_available()
  );
end;
$$;

create or replace function public.choose_plan(p_business_id uuid, p_plan_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.plans;
  v_staff integer;
  v_inv uuid;
begin
  if not public.is_business_owner(p_business_id) then
    raise exception 'Somente o dono da lavanderia pode mudar o plano.' using errcode = '42501';
  end if;
  select * into p from public.plans where id = p_plan_id;
  if p.id is null or not (p.active and (p.public or p.is_default)) then
    raise exception 'Plano não disponível.' using errcode = 'P0001';
  end if;
  select count(*) into v_staff from public.business_members m where m.business_id = p_business_id and m.role = 'staff';
  if p.max_staff is not null and v_staff > p.max_staff then
    raise exception 'O plano % permite % funcionário(s) e a sua equipe tem %. Remova funcionários antes de mudar.', p.name, p.max_staff, v_staff
      using errcode = 'P0001';
  end if;
  update public.subscription_invoices set status = 'cancelada' where business_id = p_business_id and status = 'aberta';

  if p.price = 0 then
    insert into public.subscriptions (business_id, plan_id, status, current_period_end, source, updated_by)
    values (p_business_id, p.id, 'ativa', null, 'gratis', auth.uid())
    on conflict (business_id) do update set plan_id = excluded.plan_id, status = 'ativa', current_period_end = null,
                                            source = 'gratis', updated_at = now(), updated_by = auth.uid();
    perform public.ledger_add('plano_alterado', null, p_business_id, null, 0, jsonb_build_object('plan', p.code));
    return jsonb_build_object('activated', true);
  end if;

  if not public.app_payment_available() then
    raise exception 'A cobrança de planos pelo app ainda não está disponível. Tente mais tarde.' using errcode = 'P0001';
  end if;
  insert into public.subscription_invoices (business_id, plan_id, amount) values (p_business_id, p.id, p.price)
  returning id into v_inv;
  return jsonb_build_object('activated', false, 'invoice_id', v_inv, 'amount', p.price);
end;
$$;

create or replace function public.cancel_invoice(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.subscription_invoices;
begin
  select * into i from public.subscription_invoices where id = p_invoice_id for update;
  if i.id is null or not public.is_business_owner(i.business_id) then
    raise exception 'Mensalidade não encontrada.' using errcode = 'P0001';
  end if;
  if i.status <> 'aberta' then
    raise exception 'Esta mensalidade não está mais em aberto.' using errcode = 'P0001';
  end if;
  update public.subscription_invoices set status = 'cancelada' where id = i.id;
end;
$$;

-- Dados para gerar o Pix da mensalidade (a função do servidor chama com o login do dono)
create or replace function public.subscription_checkout(p_invoice_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.subscription_invoices;
  b public.businesses;
  v_prof public.profiles;
  v_email text;
  t public.payment_transactions;
begin
  select * into i from public.subscription_invoices where id = p_invoice_id;
  if i.id is null or not public.is_business_owner(i.business_id) then
    raise exception 'Mensalidade não encontrada.' using errcode = 'P0001';
  end if;
  if i.status <> 'aberta' then
    raise exception 'Esta mensalidade não está mais em aberto.' using errcode = 'P0001';
  end if;
  if not public.app_payment_available() then
    raise exception 'O pagamento pelo app está temporariamente indisponível. Tente mais tarde.' using errcode = 'P0001';
  end if;
  select * into b from public.businesses where id = i.business_id;
  select * into v_prof from public.profiles where id = auth.uid();
  select u.email into v_email from auth.users u where u.id = auth.uid();
  select * into t from public.payment_transactions x
   where x.invoice_id = i.id and x.status = 'pending' and x.amount = i.amount and x.created_at > now() - interval '20 minutes'
   order by x.created_at desc limit 1;
  return jsonb_build_object(
    'invoice_id', i.id, 'user_id', auth.uid(), 'amount', i.amount,
    'description', left('Limpa Aqui - plano ' || (select p.name from public.plans p where p.id = i.plan_id) || ' - ' || b.name, 120),
    'name', coalesce(nullif(trim(v_prof.full_name), ''), b.name), 'email', v_email,
    'phone', coalesce(v_prof.phone, b.whatsapp),
    'pending', case when t.id is not null then
                 jsonb_build_object('id', t.id, 'identifier', t.identifier, 'pix_code', t.pix_code, 'amount', t.amount, 'created_at', t.created_at)
               end
  );
end;
$$;

create or replace function public.subscription_register(p_invoice_id uuid, p_user_id uuid, p_identifier text, p_pix_code text, p_amount numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.subscription_invoices;
  v_id uuid;
begin
  select * into i from public.subscription_invoices where id = p_invoice_id;
  if i.id is null or i.status <> 'aberta'
     or not exists (select 1 from public.business_members m where m.business_id = i.business_id and m.user_id = p_user_id and m.role = 'owner') then
    raise exception 'Mensalidade não encontrada.' using errcode = 'P0001';
  end if;
  if round(p_amount, 2) <> i.amount then
    raise exception 'Valor diferente da mensalidade.' using errcode = 'P0001';
  end if;
  insert into public.payment_transactions (invoice_id, business_id, payer_user_id, identifier, pix_code, amount)
  values (i.id, i.business_id, p_user_id, p_identifier, p_pix_code, i.amount)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'identifier', p_identifier, 'pix_code', p_pix_code, 'amount', i.amount, 'created_at', now());
end;
$$;

create or replace function public.subscription_status_check(p_invoice_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.subscription_invoices;
  t public.payment_transactions;
begin
  select * into i from public.subscription_invoices where id = p_invoice_id;
  if i.id is null or not public.is_business_owner(i.business_id) then
    raise exception 'Mensalidade não encontrada.' using errcode = 'P0001';
  end if;
  select * into t from public.payment_transactions x where x.invoice_id = i.id order by x.created_at desc limit 1 for update;
  if t.id is null or i.status <> 'aberta' or t.status <> 'pending' or t.status_checks >= 5 or t.created_at > now() - interval '1 minute' then
    return jsonb_build_object('paid', i.status = 'paga', 'status', t.status, 'query', false);
  end if;
  update public.payment_transactions set status_checks = status_checks + 1 where id = t.id;
  return jsonb_build_object('paid', false, 'status', t.status, 'query', true, 'identifier', t.identifier);
end;
$$;

-- Resultado do gateway para uma mensalidade (chamado por app_payment_apply)
create or replace function public.subscription_payment_applied(p_tx uuid, p_prev text, p_status text, p_net numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.payment_transactions;
  i public.subscription_invoices;
  p public.plans;
  s public.subscriptions;
  v_start timestamptz;
  v_end timestamptz;
begin
  select * into t from public.payment_transactions where id = p_tx;
  select * into i from public.subscription_invoices where id = t.invoice_id for update;
  select * into p from public.plans where id = i.plan_id;

  if p_status = 'completed' and p_prev not in ('refunding', 'med') then
    perform public.ledger_add('assinatura_recebida', null, i.business_id, 'app', t.amount,
                              jsonb_build_object('invoice_id', i.id, 'plan', p.code, 'identifier', t.identifier));
    if p_net is not null and p_net < t.amount then
      perform public.ledger_add('taxa_gateway', null, i.business_id, 'app', round(t.amount - p_net, 2), jsonb_build_object('identifier', t.identifier));
    end if;
    if i.status <> 'aberta' then
      update public.payment_transactions set needs_refund = true where id = t.id;
      perform public.ledger_add('pagamento_app_a_devolver', null, i.business_id, 'app', t.amount,
                                jsonb_build_object('identifier', t.identifier, 'reason', 'mensalidade_' || i.status));
      return;
    end if;
    select * into s from public.subscriptions where business_id = i.business_id for update;
    -- renovação do mesmo plano soma ao período que ainda falta; troca de plano começa agora
    v_start := case when s.plan_id = p.id and s.status = 'ativa' and s.current_period_end > now() then s.current_period_end else now() end;
    v_end := v_start + make_interval(days => p.period_days);
    update public.payment_transactions set applied = true where id = t.id;
    update public.subscription_invoices set status = 'paga', paid_at = now(), period_start = v_start, period_end = v_end where id = i.id;
    insert into public.subscriptions (business_id, plan_id, status, current_period_end, source)
    values (i.business_id, p.id, 'ativa', v_end, 'pagamento')
    on conflict (business_id) do update set plan_id = excluded.plan_id, status = 'ativa', current_period_end = excluded.current_period_end,
                                            source = 'pagamento', updated_at = now(), updated_by = null;
  elsif p_status = 'completed' then
    perform public.ledger_add('pagamento_app_liberado', null, i.business_id, 'app', t.amount, jsonb_build_object('identifier', t.identifier));
  elsif p_status in ('refunding', 'med') then
    perform public.ledger_add(case when p_status = 'med' then 'pagamento_app_contestado' else 'pagamento_app_em_estorno' end,
                              null, i.business_id, 'app', t.amount, jsonb_build_object('identifier', t.identifier, 'invoice_id', i.id));
  elsif p_status in ('refunded', 'chargeback') then
    update public.payment_transactions set needs_refund = false where id = t.id;
    perform public.ledger_add('assinatura_estornada', null, i.business_id, 'app', t.amount, jsonb_build_object('invoice_id', i.id));
    if t.applied then
      update public.subscription_invoices set status = 'estornada' where id = i.id;
      -- o período pago por esta mensalidade deixa de valer
      update public.subscriptions set status = 'cancelada', updated_at = now()
       where business_id = i.business_id and plan_id = i.plan_id and current_period_end = i.period_end;
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Administração de planos
-- ---------------------------------------------------------------------
create or replace function public.admin_upsert_plan(
  p_plan_id uuid, p_code text, p_name text, p_description text, p_price numeric, p_period_days integer,
  p_max_orders_month integer, p_max_staff integer, p_featured boolean, p_public boolean, p_active boolean,
  p_sort integer, p_features text[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_plan_id;
  v_old public.plans;
begin
  if not public.has_role('admin') then
    raise exception 'Somente a administração da plataforma pode fazer isso.' using errcode = '42501';
  end if;
  if p_name is null or char_length(trim(p_name)) < 2 or coalesce(p_price, -1) < 0 or coalesce(p_period_days, 0) < 1 then
    raise exception 'Informe nome, preço (zero ou mais) e período em dias.' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(coalesce(p_features, '{}')) x where not exists (select 1 from public.features f where f.code = x)) then
    raise exception 'Recurso desconhecido na lista.' using errcode = '22023';
  end if;
  if v_id is null then
    insert into public.plans (code, name, description, price, period_days, max_orders_month, max_staff, featured, public, active, sort)
    values (lower(trim(p_code)), trim(p_name), nullif(trim(coalesce(p_description, '')), ''), round(p_price, 2), p_period_days,
            p_max_orders_month, p_max_staff, coalesce(p_featured, false), coalesce(p_public, true), coalesce(p_active, true), coalesce(p_sort, 0))
    returning id into v_id;
  else
    select * into v_old from public.plans where id = v_id for update;
    if v_old.id is null then
      raise exception 'Plano não encontrado.' using errcode = 'P0001';
    end if;
    if v_old.is_default and (round(p_price, 2) <> 0 or not coalesce(p_active, true)) then
      raise exception 'O plano padrão é sempre gratuito e ativo.' using errcode = 'P0001';
    end if;
    update public.plans
       set name = trim(p_name), description = nullif(trim(coalesce(p_description, '')), ''), price = round(p_price, 2),
           period_days = p_period_days, max_orders_month = p_max_orders_month, max_staff = p_max_staff,
           featured = coalesce(p_featured, false), public = coalesce(p_public, true), active = coalesce(p_active, true),
           sort = coalesce(p_sort, 0)
     where id = v_id;
    delete from public.plan_features where plan_id = v_id;
  end if;
  insert into public.plan_features (plan_id, feature_code) select v_id, x from unnest(coalesce(p_features, '{}')) x on conflict do nothing;
  perform public.ledger_add('plano_salvo', null, null, null, coalesce(p_price, 0),
                            jsonb_build_object('plan_id', v_id, 'name', p_name, 'features', p_features));
  return v_id;
end;
$$;

create or replace function public.admin_plans()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_role('admin') then
    raise exception 'Somente a administração da plataforma pode fazer isso.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', p.id, 'code', p.code, 'name', p.name, 'description', p.description, 'price', p.price,
             'period_days', p.period_days, 'max_orders_month', p.max_orders_month, 'max_staff', p.max_staff,
             'featured', p.featured, 'is_default', p.is_default, 'public', p.public, 'active', p.active, 'sort', p.sort,
             'features', coalesce((select jsonb_agg(pf.feature_code) from public.plan_features pf where pf.plan_id = p.id), '[]'::jsonb),
             'subscribers', (select count(*) from public.businesses b where public.business_plan_id(b.id) = p.id))
           order by p.sort, p.price)
    from public.plans p), '[]'::jsonb);
end;
$$;

create or replace function public.admin_subscriptions()
returns table (business_id uuid, business_name text, plan_id uuid, plan_name text, effective_plan_name text,
               status text, current_period_end timestamptz, source text, last_paid_at timestamptz, open_invoice numeric)
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
  select b.id, b.name, s.plan_id, sp.name, ep.name, s.status, s.current_period_end, s.source,
         (select max(i.paid_at) from public.subscription_invoices i where i.business_id = b.id and i.status = 'paga'),
         (select i.amount from public.subscription_invoices i where i.business_id = b.id and i.status = 'aberta' order by i.created_at desc limit 1)
  from public.businesses b
  left join public.subscriptions s on s.business_id = b.id
  left join public.plans sp on sp.id = s.plan_id
  left join public.plans ep on ep.id = public.business_plan_id(b.id)
  order by (s.business_id is null), s.current_period_end nulls last, b.name
  limit 1000;
end;
$$;

-- Plano de cortesia / ajuste manual (até uma data, ou sem fim)
create or replace function public.admin_grant_plan(p_business_id uuid, p_plan_id uuid, p_until date default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_role('admin') then
    raise exception 'Somente a administração da plataforma pode fazer isso.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.businesses where id = p_business_id) or not exists (select 1 from public.plans where id = p_plan_id) then
    raise exception 'Lavanderia ou plano não encontrado.' using errcode = 'P0001';
  end if;
  if p_until is not null and p_until < current_date then
    raise exception 'A data final já passou.' using errcode = '22023';
  end if;
  insert into public.subscriptions (business_id, plan_id, status, current_period_end, source, updated_by)
  values (p_business_id, p_plan_id, 'ativa', (p_until + 1)::timestamp at time zone 'America/Sao_Paulo', 'admin', auth.uid())
  on conflict (business_id) do update set plan_id = excluded.plan_id, status = 'ativa', current_period_end = excluded.current_period_end,
                                          source = 'admin', updated_at = now(), updated_by = auth.uid();
  perform public.ledger_add('assinatura_cortesia', null, p_business_id, null, 0, jsonb_build_object('plan_id', p_plan_id, 'until', p_until));
end;
$$;

create or replace function public.admin_set_subscription_settings(p_grace_days integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_role('admin') then
    raise exception 'Somente a administração da plataforma pode fazer isso.' using errcode = '42501';
  end if;
  if p_grace_days is null or p_grace_days < 0 or p_grace_days > 60 then
    raise exception 'Tolerância entre 0 e 60 dias.' using errcode = '22023';
  end if;
  update public.platform_settings set subscription_grace_days = p_grace_days, updated_at = now(), updated_by = auth.uid() where id;
end;
$$;

create or replace function public.admin_subscription_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_role('admin') then
    raise exception 'Somente a administração da plataforma pode fazer isso.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'grace_days', (select ps.subscription_grace_days from public.platform_settings ps where ps.id),
    'paying', (select count(*) from public.subscriptions s join public.plans p on p.id = s.plan_id
                where s.source = 'pagamento' and p.price > 0 and public.business_plan_id(s.business_id) = s.plan_id),
    'mrr', coalesce((select sum(round(p.price * 30.0 / p.period_days, 2)) from public.subscriptions s join public.plans p on p.id = s.plan_id
                      where s.source = 'pagamento' and p.price > 0 and public.business_plan_id(s.business_id) = s.plan_id), 0),
    'in_grace', (select count(*) from public.subscriptions s where s.status = 'ativa' and s.current_period_end <= now()
                   and public.business_plan_id(s.business_id) = s.plan_id),
    'expired', (select count(*) from public.subscriptions s where s.current_period_end is not null
                  and public.business_plan_id(s.business_id) <> s.plan_id),
    'received_30d', coalesce((select sum(i.amount) from public.subscription_invoices i where i.status = 'paga' and i.paid_at > now() - interval '30 days'), 0),
    'open_invoices', (select count(*) from public.subscription_invoices i where i.status = 'aberta')
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Busca: prestador em plano com destaque vem primeiro, com selo
-- ---------------------------------------------------------------------
drop function if exists public.search_providers(integer, text, double precision, double precision);
create function public.search_providers(
  p_municipality_id integer,
  p_category text default null,
  p_lat double precision default null,
  p_lng double precision default null
)
returns table (
  id uuid, name text, slug text, provider_type public.provider_type, logo_path text, public_description text,
  neighborhood text, municipality_name text, categories text[], min_price numeric, services_count bigint,
  offers_pickup boolean, accepts_direct_payment boolean, accepts_app_payment boolean, distance_km numeric, featured boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select x.* from (
    select b.id, b.name as name, b.slug, b.provider_type, b.logo_path, b.public_description,
           b.neighborhood, hm.name as municipality_name,
           coalesce((select array_agg(c.name order by c.sort)
                     from public.business_categories bc join public.service_categories c on c.code = bc.category_code
                     where bc.business_id = b.id and bc.active), '{}') as categories,
           (select min(s.price) from public.services s where s.business_id = b.id and s.active and s.price > 0) as min_price,
           (select count(*) from public.services s where s.business_id = b.id and s.active) as services_count,
           b.offers_pickup, b.accepts_direct_payment, b.accepts_app_payment,
           round(public.distance_km(p_lat, p_lng, b.lat, b.lng)::numeric, 1) as distance_km,
           coalesce((select p.featured from public.plans p where p.id = public.business_plan_id(b.id)), false) as featured
    from public.businesses b
    join public.municipalities m on m.id = p_municipality_id and m.status = 'ativo'
    left join public.municipalities hm on hm.id = b.municipality_id
    where public.provider_listable(b)
      and public.provider_serves(b.id, b.municipality_id, p_municipality_id)
      and (p_category is null
           or exists (select 1 from public.business_categories bc where bc.business_id = b.id and bc.active and bc.category_code = p_category)
           or exists (select 1 from public.services s where s.business_id = b.id and s.active and s.category_code = p_category))
  ) x
  order by x.featured desc, x.distance_km nulls last, x.name
  limit 100;
$$;

-- ---------------------------------------------------------------------
-- Gateway: mesma função da Etapa 5b, agora também para mensalidades
-- ---------------------------------------------------------------------
create or replace function public.app_payment_apply(
  p_identifier text, p_status text, p_event_id text default null, p_amount numeric default null,
  p_net_amount numeric default null, p_end_to_end text default null, p_paid_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.payment_transactions;
  o public.orders;
  c public.platform_commissions;
  v_prev text;
  v_expected numeric;
  v_commission numeric := 0;
begin
  if p_status not in ('pending', 'completed', 'failed', 'refused', 'three_ds_failed', 'refunding', 'refunded', 'chargeback', 'med') then
    return jsonb_build_object('result', 'ignored', 'reason', 'unknown_status');
  end if;
  if p_event_id is not null then
    insert into public.payment_webhook_events (event_id, identifier, status) values (p_event_id, p_identifier, p_status)
    on conflict (event_id) do nothing;
    if not found then
      return jsonb_build_object('result', 'duplicate');
    end if;
  end if;

  select * into t from public.payment_transactions where identifier = p_identifier for update;
  if t.id is null then
    return jsonb_build_object('result', 'ignored', 'reason', 'unknown_transaction');
  end if;
  v_prev := t.status;
  if p_status = v_prev
     or not (v_prev in ('pending', 'failed', 'refused', 'three_ds_failed')
             or (v_prev = 'completed' and p_status in ('refunding', 'refunded', 'chargeback', 'med'))
             or (v_prev = 'refunding' and p_status in ('refunded', 'completed', 'med'))
             or (v_prev = 'med' and p_status in ('completed', 'refunded', 'chargeback'))) then
    return jsonb_build_object('result', 'ignored', 'reason', 'transition', 'status', v_prev);
  end if;
  if v_prev in ('failed', 'refused', 'three_ds_failed') and p_status <> 'completed' then
    return jsonb_build_object('result', 'ignored', 'reason', 'transition', 'status', v_prev);
  end if;

  update public.payment_transactions
     set status = p_status,
         net_amount = coalesce(round(p_net_amount, 2), net_amount),
         end_to_end_id = coalesce(left(p_end_to_end, 80), end_to_end_id),
         paid_at = case when p_status = 'completed' then coalesce(paid_at, p_paid_at, now()) else paid_at end,
         refunded_at = case when p_status in ('refunded', 'chargeback') then now() else refunded_at end
   where id = t.id;

  -- mensalidade de plano: tratada à parte
  if t.invoice_id is not null then
    perform public.subscription_payment_applied(t.id, v_prev, p_status, p_net_amount);
    return jsonb_build_object('result', 'applied', 'from', v_prev, 'to', p_status, 'kind', 'assinatura');
  end if;

  select * into o from public.orders where id = t.order_id for update;
  perform set_config('limpaaqui.internal', 'on', true);

  -- ---------------- pago ----------------
  if p_status = 'completed' then
    if v_prev in ('refunding', 'med') then
      -- contestação/estorno não foi adiante: repasses voltam a valer
      update public.payouts set status = 'pendente' where transaction_id = t.id and status = 'bloqueado';
      perform public.ledger_add('pagamento_app_liberado', t.order_id, t.business_id, 'app', t.amount, jsonb_build_object('identifier', t.identifier));
    else
      perform public.ledger_add('pagamento_app_recebido', t.order_id, t.business_id, 'app', t.amount,
                                jsonb_build_object('identifier', t.identifier, 'net_amount', p_net_amount));
      if p_net_amount is not null and p_net_amount < t.amount then
        perform public.ledger_add('taxa_gateway', t.order_id, t.business_id, 'app', round(t.amount - p_net_amount, 2),
                                  jsonb_build_object('identifier', t.identifier));
      end if;
      v_expected := case when o.id is not null then public.app_order_amount(o) end;
      if o.id is null or o.status = 'cancelado' or o.paid or (p_amount is not null and round(p_amount, 2) <> t.amount)
         or t.amount <> v_expected then
        update public.payment_transactions set needs_refund = true where id = t.id;
        perform public.ledger_add('pagamento_app_a_devolver', t.order_id, t.business_id, 'app', t.amount,
                                  jsonb_build_object('identifier', t.identifier,
                                                     'reason', case when o.id is null then 'sem_pedido' when o.status = 'cancelado' then 'pedido_cancelado'
                                                                    when o.paid then 'duplicidade' else 'valor_divergente' end));
      else
        update public.payment_transactions set applied = true where id = t.id;
        update public.orders set paid = true where id = o.id;
        -- comissão do app fica retida pela plataforma
        update public.platform_commissions set status = 'paga' where order_id = o.id and status in ('prevista', 'a_cobrar')
        returning * into c;
        if c.id is not null then
          v_commission := c.commission_amount;
          perform public.ledger_add('comissao_retida', o.id, o.business_id, 'app', c.commission_amount, '{}'::jsonb);
        end if;
        insert into public.payouts (payee_type, business_id, order_id, transaction_id, amount)
        values ('prestador', o.business_id, o.id, t.id, greatest(round(o.total - v_commission, 2), 0));
        perform public.ledger_add('repasse_previsto', o.id, o.business_id, 'app', greatest(round(o.total - v_commission, 2), 0),
                                  jsonb_build_object('payee', 'prestador'));
        -- com entregador: a coleta só é chamada depois do pagamento
        if o.logistics_mode = 'entregador'
           and not exists (select 1 from public.deliveries d where d.order_id = o.id and d.leg = 'pickup' and d.status <> 'cancelada') then
          perform public.create_delivery_leg(o.id, 'pickup');
        end if;
      end if;
    end if;

  -- ---------------- suspenso (estorno em andamento ou MED) ----------------
  elsif p_status in ('refunding', 'med') then
    update public.payouts set status = 'bloqueado' where transaction_id = t.id and status = 'pendente';
    perform public.ledger_add(case when p_status = 'med' then 'pagamento_app_contestado' else 'pagamento_app_em_estorno' end,
                              t.order_id, t.business_id, 'app', t.amount, jsonb_build_object('identifier', t.identifier));

  -- ---------------- devolvido ao cliente ----------------
  elsif p_status in ('refunded', 'chargeback') then
    update public.payment_transactions set needs_refund = false where id = t.id;
    perform public.ledger_add(case when p_status = 'chargeback' then 'pagamento_app_chargeback' else 'pagamento_app_estornado' end,
                              t.order_id, t.business_id, 'app', t.amount, jsonb_build_object('identifier', t.identifier));
    if t.applied and o.id is not null then
      update public.payouts set status = 'cancelado' where transaction_id = t.id and status in ('pendente', 'bloqueado');
      update public.payouts set status = 'cancelado'
       where order_id = o.id and payee_type = 'entregador' and status in ('pendente', 'bloqueado');
      if exists (select 1 from public.payouts p where p.order_id = o.id and p.status = 'pago') then
        perform public.ledger_add('repasse_a_recuperar', o.id, o.business_id, 'app',
                                  (select sum(p.amount) from public.payouts p where p.order_id = o.id and p.status = 'pago'), '{}'::jsonb);
      end if;
      update public.platform_commissions set status = 'cancelada' where order_id = o.id and status <> 'cancelada';
      update public.orders set paid = false, status = case when status = 'entregue' then status else 'cancelado' end where id = o.id;
    end if;

  -- ---------------- não pago (expirou, recusado) ----------------
  else
    null; -- o cliente pode gerar um novo Pix
  end if;

  perform set_config('limpaaqui.internal', 'off', true);
  return jsonb_build_object('result', 'applied', 'from', v_prev, 'to', p_status);
end;
$$;

-- ---------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------
revoke all on function public.search_providers(integer, text, double precision, double precision) from public;
grant execute on function public.search_providers(integer, text, double precision, double precision) to anon, authenticated;
revoke all on function public.public_plans() from public;
grant execute on function public.public_plans() to anon, authenticated;

revoke all on function public.business_plan_id(uuid) from public, anon, authenticated;
revoke all on function public.plan_allows(uuid, text) from public, anon;
grant execute on function public.plan_allows(uuid, text) to authenticated;
revoke all on function public.orders_this_month(uuid) from public, anon, authenticated;
revoke all on function public.enforce_plan_order_limit() from public, anon, authenticated;
revoke all on function public.enforce_plan_staff_limit() from public, anon, authenticated;
revoke all on function public.subscription_payment_applied(uuid, text, text, numeric) from public, anon, authenticated;

revoke all on function public.my_plan(uuid) from public, anon;
revoke all on function public.choose_plan(uuid, uuid) from public, anon;
revoke all on function public.cancel_invoice(uuid) from public, anon;
revoke all on function public.subscription_checkout(uuid) from public, anon;
revoke all on function public.subscription_status_check(uuid) from public, anon;
revoke all on function public.admin_upsert_plan(uuid, text, text, text, numeric, integer, integer, integer, boolean, boolean, boolean, integer, text[]) from public, anon;
revoke all on function public.admin_plans() from public, anon;
revoke all on function public.admin_subscriptions() from public, anon;
revoke all on function public.admin_grant_plan(uuid, uuid, date) from public, anon;
revoke all on function public.admin_set_subscription_settings(integer) from public, anon;
revoke all on function public.admin_subscription_overview() from public, anon;
grant execute on function public.my_plan(uuid) to authenticated;
grant execute on function public.choose_plan(uuid, uuid) to authenticated;
grant execute on function public.cancel_invoice(uuid) to authenticated;
grant execute on function public.subscription_checkout(uuid) to authenticated;
grant execute on function public.subscription_status_check(uuid) to authenticated;
grant execute on function public.admin_upsert_plan(uuid, text, text, text, numeric, integer, integer, integer, boolean, boolean, boolean, integer, text[]) to authenticated;
grant execute on function public.admin_plans() to authenticated;
grant execute on function public.admin_subscriptions() to authenticated;
grant execute on function public.admin_grant_plan(uuid, uuid, date) to authenticated;
grant execute on function public.admin_set_subscription_settings(integer) to authenticated;
grant execute on function public.admin_subscription_overview() to authenticated;

revoke all on function public.subscription_register(uuid, uuid, text, text, numeric) from public, anon, authenticated;
grant execute on function public.subscription_register(uuid, uuid, text, text, numeric) to service_role;
revoke all on function public.app_payment_apply(text, text, text, numeric, numeric, text, timestamptz) from public, anon, authenticated;
grant execute on function public.app_payment_apply(text, text, text, numeric, numeric, text, timestamptz) to service_role;
