-- =====================================================================
-- LIMPA AQUI — Admin: listas, cupons e trilha de auditoria (PRD seção 11)
--  * audit_logs: toda alteração feita por um administrador nas tabelas de configuração e operação
--    fica registrada (quem, quando, o quê, antes → depois), por gatilho. Só leitura; ninguém apaga.
--  * Listas do admin com busca e paginação: usuários, pedidos e anúncios; encerrar anúncio (moderação)
--  * Cupons de desconto pagos pela plataforma, só para pedidos pagos pelo app:
--      - o cliente paga menos; o repasse da lavanderia NÃO muda (a plataforma absorve o desconto)
--      - o desconto entra no valor do Pix (app_order_amount) e só pode ser aplicado antes de gerar o Pix
--      - limites: validade, valor mínimo, teto do desconto, usos totais, usos por pessoa, só 1º pedido
-- =====================================================================

-- ---------------------------------------------------------------------
-- Trilha de auditoria
-- ---------------------------------------------------------------------
create table if not exists public.audit_logs (
  id          bigint generated always as identity primary key,
  actor_id    uuid references auth.users (id) on delete set null,
  action      text not null check (action in ('insert', 'update', 'delete')),
  target_type text not null,
  target_id   text,
  changes     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists audit_logs_created_idx on public.audit_logs (created_at desc);
create index if not exists audit_logs_target_idx on public.audit_logs (target_type, target_id);
alter table public.audit_logs enable row level security;
revoke all on public.audit_logs from anon, authenticated;

create or replace function public.audit_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'A trilha de auditoria não pode ser alterada.' using errcode = '42501';
end;
$$;
drop trigger if exists audit_logs_immutable on public.audit_logs;
create trigger audit_logs_immutable before update or delete on public.audit_logs
  for each row execute function public.audit_immutable();

create or replace function public.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  r jsonb := coalesce(n, o);
  v_changes jsonb;
begin
  if auth.uid() is null or not public.has_role('admin') then
    return null;
  end if;
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(k, jsonb_build_array(o -> k, n -> k)) into v_changes
    from jsonb_object_keys(n) k
    where k not in ('updated_at') and (o -> k) is distinct from (n -> k);
    if v_changes is null then
      return null;
    end if;
  else
    v_changes := r;
  end if;
  insert into public.audit_logs (actor_id, action, target_type, target_id, changes)
  values (auth.uid(), lower(tg_op), tg_table_name,
          coalesce(r ->> 'id', r ->> 'code', r ->> 'user_id') || coalesce(':' || (r ->> 'role'), ''),
          v_changes);
  return null;
exception when others then
  return null; -- a auditoria nunca impede a operação
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['municipalities', 'user_roles', 'service_categories', 'banners', 'commission_rules', 'delivery_zones',
                           'platform_settings', 'payouts', 'order_disputes', 'plans', 'plan_features', 'subscriptions', 'couriers',
                           'listings', 'chat_reports', 'platform_commissions']
  loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
      execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row()', t || '_audit', t);
    end if;
  end loop;
end $$;

create or replace function public.admin_audit_logs(p_target_type text default null, p_limit integer default 100, p_offset integer default 0)
returns table (id bigint, actor_name text, action text, target_type text, target_id text, changes jsonb, created_at timestamptz, total_count bigint)
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
  select a.id, coalesce(nullif(trim(p.full_name), ''), u.email::text, 'Admin'), a.action, a.target_type, a.target_id, a.changes, a.created_at,
         count(*) over ()
  from public.audit_logs a
  left join public.profiles p on p.id = a.actor_id
  left join auth.users u on u.id = a.actor_id
  where p_target_type is null or a.target_type = p_target_type
  order by a.created_at desc, a.id desc
  limit least(greatest(coalesce(p_limit, 100), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- ---------------------------------------------------------------------
-- Listas do admin
-- ---------------------------------------------------------------------
create or replace function public.admin_users(p_q text default null, p_role public.user_role default null, p_limit integer default 50, p_offset integer default 0)
returns table (id uuid, full_name text, email text, phone text, roles jsonb, businesses text[], orders_as_client bigint,
               created_at timestamptz, last_sign_in_at timestamptz, total_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := nullif(trim(coalesce(p_q, '')), '');
begin
  if not public.has_role('admin') then
    raise exception 'Somente a administração da plataforma pode fazer isso.' using errcode = '42501';
  end if;
  return query
  select u.id, p.full_name, u.email::text, p.phone,
         coalesce((select jsonb_agg(jsonb_build_object('role', r.role, 'status', r.status) order by r.role) from public.user_roles r where r.user_id = u.id), '[]'::jsonb),
         coalesce((select array_agg(b.name order by b.name) from public.business_members m join public.businesses b on b.id = m.business_id where m.user_id = u.id), '{}'),
         (select count(*) from public.orders o where o.client_user_id = u.id),
         u.created_at, u.last_sign_in_at, count(*) over ()
  from auth.users u
  left join public.profiles p on p.id = u.id
  where (v_q is null or p.full_name ilike '%' || v_q || '%' or u.email ilike '%' || v_q || '%'
         or regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') like '%' || nullif(regexp_replace(v_q, '\D', '', 'g'), '') || '%')
    and (p_role is null or exists (select 1 from public.user_roles r where r.user_id = u.id and r.role = p_role))
  order by u.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100) offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

create or replace function public.admin_orders(p_q text default null, p_status public.order_status default null, p_origin public.order_origin default null,
                                               p_limit integer default 50, p_offset integer default 0)
returns table (id uuid, number integer, business_name text, client_name text, status public.order_status, origin public.order_origin,
               payment_mode public.payment_mode, logistics_mode public.logistics_mode, paid boolean, amount numeric, discount numeric,
               dispute_open boolean, client_confirmed_at timestamptz, created_at timestamptz, total_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := nullif(trim(coalesce(p_q, '')), '');
begin
  if not public.has_role('admin') then
    raise exception 'Somente a administração da plataforma pode fazer isso.' using errcode = '42501';
  end if;
  return query
  select o.id, o.number, b.name, coalesce(nullif(trim(p.full_name), ''), c.name), o.status, o.origin, o.payment_mode, o.logistics_mode, o.paid,
         public.app_order_amount(o), o.discount_amount, public.order_has_open_dispute(o.id), o.client_confirmed_at, o.created_at,
         count(*) over ()
  from public.orders o
  join public.businesses b on b.id = o.business_id
  left join public.customers c on c.id = o.customer_id
  left join public.profiles p on p.id = o.client_user_id
  where (v_q is null or b.name ilike '%' || v_q || '%' or p.full_name ilike '%' || v_q || '%' or c.name ilike '%' || v_q || '%'
         or o.number::text = v_q)
    and (p_status is null or o.status = p_status)
    and (p_origin is null or o.origin = p_origin)
  order by o.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100) offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

create or replace function public.admin_listings(p_q text default null, p_status text default null, p_limit integer default 50, p_offset integer default 0)
returns table (id uuid, title text, category_name text, municipality_name text, neighborhood text, client_name text, status text,
               expired boolean, proposals bigint, created_at timestamptz, expires_at timestamptz, total_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := nullif(trim(coalesce(p_q, '')), '');
begin
  if not public.has_role('admin') then
    raise exception 'Somente a administração da plataforma pode fazer isso.' using errcode = '42501';
  end if;
  return query
  select l.id, l.title, sc.name, m.name, l.neighborhood, coalesce(nullif(trim(p.full_name), ''), 'Cliente'), l.status::text,
         (l.status = 'aberto' and l.expires_at < now()), (select count(*) from public.proposals x where x.listing_id = l.id),
         l.created_at, l.expires_at, count(*) over ()
  from public.listings l
  left join public.service_categories sc on sc.code = l.category_code
  left join public.municipalities m on m.id = l.municipality_id
  left join public.profiles p on p.id = l.user_id
  where (v_q is null or l.title ilike '%' || v_q || '%' or l.description ilike '%' || v_q || '%' or p.full_name ilike '%' || v_q || '%')
    and (p_status is null or l.status::text = p_status)
  order by l.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100) offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- Moderação: o admin encerra um anúncio (com motivo para o cliente)
create or replace function public.admin_close_listing(p_listing_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.listings;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not public.has_role('admin') then
    raise exception 'Somente a administração da plataforma pode fazer isso.' using errcode = '42501';
  end if;
  if v_reason is null or char_length(v_reason) > 300 then
    raise exception 'Explique o motivo para o cliente (até 300 caracteres).' using errcode = '22023';
  end if;
  update public.listings set status = 'cancelado' where id = p_listing_id and status = 'aberto' returning * into l;
  if l.id is null then
    raise exception 'Anúncio não encontrado ou já encerrado.' using errcode = 'P0001';
  end if;
  update public.proposals set status = 'recusada' where listing_id = l.id and status = 'enviada';
  begin
    perform public.notify(l.user_id, 'anuncio_encerrado', 'Seu anúncio foi encerrado pela administração',
                          left('"' || l.title || '": ' || v_reason, 300), '/cliente/anuncios/' || l.id);
  exception when others then null;
  end;
end;
$$;

-- ---------------------------------------------------------------------
-- Cupons
-- ---------------------------------------------------------------------
create table if not exists public.coupons (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique check (code ~ '^[A-Z0-9]{3,20}$'),
  description       text check (description is null or char_length(description) <= 120),
  kind              text not null check (kind in ('percentual', 'valor')),
  value             numeric(10, 2) not null check (value > 0),
  max_discount      numeric(10, 2) check (max_discount is null or max_discount > 0),
  min_order         numeric(10, 2) not null default 0 check (min_order >= 0),
  valid_from        timestamptz not null default now(),
  valid_until       timestamptz,
  max_uses          integer check (max_uses is null or max_uses > 0),
  max_uses_per_user integer not null default 1 check (max_uses_per_user between 1 and 100),
  first_order_only  boolean not null default false,
  active            boolean not null default true,
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (kind <> 'percentual' or value <= 100),
  check (valid_until is null or valid_until > valid_from)
);
alter table public.coupons enable row level security;
revoke all on public.coupons from anon, authenticated;
drop trigger if exists coupons_audit on public.coupons;
create trigger coupons_audit after insert or update or delete on public.coupons for each row execute function public.audit_row();

create table if not exists public.coupon_redemptions (
  id              uuid primary key default gen_random_uuid(),
  coupon_id       uuid not null references public.coupons (id) on delete restrict,
  order_id        uuid not null unique references public.orders (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  discount_amount numeric(10, 2) not null check (discount_amount > 0),
  created_at      timestamptz not null default now()
);
create index if not exists coupon_redemptions_coupon_idx on public.coupon_redemptions (coupon_id);
create index if not exists coupon_redemptions_user_idx on public.coupon_redemptions (user_id);
alter table public.coupon_redemptions enable row level security;
revoke all on public.coupon_redemptions from anon, authenticated;

alter table public.orders add column if not exists discount_amount numeric(10, 2) not null default 0 check (discount_amount >= 0);
alter table public.orders add column if not exists coupon_id uuid references public.coupons (id) on delete set null;

-- Valor cobrado do cliente pelo app: serviços + entregas − desconto do cupom
create or replace function public.app_order_amount(o public.orders)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select round(coalesce(o.total, 0) + coalesce(o.delivery_fee_total, 0) - coalesce(o.discount_amount, 0), 2);
$$;

-- Pode mexer no cupom deste pedido? (cliente dono, pelo app, não pago e sem Pix gerado há pouco)
create or replace function public.coupon_order_guard(p_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
begin
  select * into o from public.orders where id = p_order_id for update;
  if o.id is null or o.client_user_id is distinct from auth.uid() then
    raise exception 'Pedido não encontrado.' using errcode = '42501';
  end if;
  if o.payment_mode is distinct from 'app' then
    raise exception 'Cupons valem para pedidos pagos pelo app.' using errcode = '22023';
  end if;
  if o.paid or o.status = 'cancelado' then
    raise exception 'Este pedido não aceita mais cupom.' using errcode = '22023';
  end if;
  if exists (select 1 from public.payment_transactions t where t.order_id = o.id and t.status = 'pending' and t.created_at > now() - interval '30 minutes') then
    raise exception 'Já existe um Pix gerado para este pedido. Pague esse Pix ou aguarde 30 minutos para usar um cupom.' using errcode = '22023';
  end if;
  return o;
end;
$$;

create or replace function public.apply_coupon(p_order_id uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  c public.coupons;
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
  v_min numeric;
  v_full numeric;
  v_disc numeric;
begin
  o := public.coupon_order_guard(p_order_id);
  select * into c from public.coupons where code = v_code;
  if c.id is null or not c.active or now() < c.valid_from or (c.valid_until is not null and now() > c.valid_until) then
    raise exception 'Cupom inválido ou fora da validade.' using errcode = '22023';
  end if;
  if o.total < c.min_order then
    raise exception 'Este cupom vale para pedidos a partir de R$ %.', to_char(c.min_order, 'FM999G990D00') using errcode = '22023';
  end if;
  if c.max_uses is not null and (select count(*) from public.coupon_redemptions r join public.orders x on x.id = r.order_id
                                  where r.coupon_id = c.id and x.status <> 'cancelado' and r.order_id <> o.id) >= c.max_uses then
    raise exception 'Este cupom esgotou.' using errcode = '22023';
  end if;
  if (select count(*) from public.coupon_redemptions r join public.orders x on x.id = r.order_id
      where r.coupon_id = c.id and r.user_id = auth.uid() and x.status <> 'cancelado' and r.order_id <> o.id) >= c.max_uses_per_user then
    raise exception 'Você já usou este cupom.' using errcode = '22023';
  end if;
  if c.first_order_only and exists (select 1 from public.orders x where x.client_user_id = auth.uid() and x.id <> o.id and x.paid) then
    raise exception 'Este cupom vale só para o primeiro pedido.' using errcode = '22023';
  end if;

  v_full := round(coalesce(o.total, 0) + coalesce(o.delivery_fee_total, 0), 2);
  v_disc := case when c.kind = 'percentual' then round(o.total * c.value / 100, 2) else c.value end;
  if c.max_discount is not null then v_disc := least(v_disc, c.max_discount); end if;
  select s.app_payment_min_amount into v_min from public.platform_settings s where s.id;
  v_disc := least(v_disc, v_full - greatest(coalesce(v_min, 0), 0.01));
  if v_disc <= 0 then
    raise exception 'O valor deste pedido não permite desconto.' using errcode = '22023';
  end if;

  update public.orders set discount_amount = v_disc, coupon_id = c.id where id = o.id;
  insert into public.coupon_redemptions (coupon_id, order_id, user_id, discount_amount)
  values (c.id, o.id, auth.uid(), v_disc)
  on conflict (order_id) do update set coupon_id = excluded.coupon_id, discount_amount = excluded.discount_amount, created_at = now();
  perform public.ledger_add('cupom_aplicado', o.id, o.business_id, 'app', v_disc, jsonb_build_object('code', c.code));
  return jsonb_build_object('code', c.code, 'discount', v_disc, 'amount', v_full - v_disc);
end;
$$;

create or replace function public.remove_coupon(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
begin
  o := public.coupon_order_guard(p_order_id);
  if o.coupon_id is null then
    return;
  end if;
  update public.orders set discount_amount = 0, coupon_id = null where id = o.id;
  delete from public.coupon_redemptions where order_id = o.id;
  perform public.ledger_add('cupom_removido', o.id, o.business_id, 'app', o.discount_amount, '{}'::jsonb);
end;
$$;

-- Cupom e valor final do pedido (cliente do pedido)
create or replace function public.order_coupon(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('code', c.code, 'description', c.description, 'discount', o.discount_amount,
                            'full_amount', round(coalesce(o.total, 0) + coalesce(o.delivery_fee_total, 0), 2),
                            'amount', public.app_order_amount(o))
  from public.orders o left join public.coupons c on c.id = o.coupon_id
  where o.id = p_order_id and o.client_user_id = auth.uid();
$$;

-- Admin: cupons com uso e desconto concedido
create or replace function public.admin_coupons()
returns table (id uuid, code text, description text, kind text, value numeric, max_discount numeric, min_order numeric,
               valid_from timestamptz, valid_until timestamptz, max_uses integer, max_uses_per_user integer, first_order_only boolean,
               active boolean, uses bigint, paid_uses bigint, discount_paid numeric, created_at timestamptz)
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
  select c.id, c.code, c.description, c.kind, c.value, c.max_discount, c.min_order, c.valid_from, c.valid_until, c.max_uses,
         c.max_uses_per_user, c.first_order_only, c.active,
         (select count(*) from public.coupon_redemptions r join public.orders o on o.id = r.order_id where r.coupon_id = c.id and o.status <> 'cancelado'),
         (select count(*) from public.coupon_redemptions r join public.orders o on o.id = r.order_id where r.coupon_id = c.id and o.paid),
         coalesce((select sum(r.discount_amount) from public.coupon_redemptions r join public.orders o on o.id = r.order_id where r.coupon_id = c.id and o.paid), 0),
         c.created_at
  from public.coupons c
  order by c.active desc, c.created_at desc;
end;
$$;

create or replace function public.admin_upsert_coupon(
  p_id uuid, p_code text, p_description text, p_kind text, p_value numeric, p_max_discount numeric, p_min_order numeric,
  p_valid_until timestamptz, p_max_uses integer, p_max_uses_per_user integer, p_first_order_only boolean, p_active boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
begin
  if not public.has_role('admin') then
    raise exception 'Somente a administração da plataforma pode fazer isso.' using errcode = '42501';
  end if;
  if v_code !~ '^[A-Z0-9]{3,20}$' then
    raise exception 'O código precisa ter de 3 a 20 letras ou números, sem espaços.' using errcode = '22023';
  end if;
  if p_kind not in ('percentual', 'valor') or p_value is null or p_value <= 0 or (p_kind = 'percentual' and p_value > 100) then
    raise exception 'Desconto inválido (percentual até 100%% ou valor maior que zero).' using errcode = '22023';
  end if;
  if p_valid_until is not null and p_valid_until <= now() and p_id is null then
    raise exception 'A validade precisa ser no futuro.' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.coupons (code, description, kind, value, max_discount, min_order, valid_until, max_uses, max_uses_per_user, first_order_only, active, created_by)
    values (v_code, nullif(trim(coalesce(p_description, '')), ''), p_kind, round(p_value, 2), round(p_max_discount, 2), round(coalesce(p_min_order, 0), 2),
            p_valid_until, p_max_uses, coalesce(p_max_uses_per_user, 1), coalesce(p_first_order_only, false), coalesce(p_active, true), auth.uid())
    returning id into v_id;
  else
    update public.coupons
       set code = v_code, description = nullif(trim(coalesce(p_description, '')), ''), kind = p_kind, value = round(p_value, 2),
           max_discount = round(p_max_discount, 2), min_order = round(coalesce(p_min_order, 0), 2), valid_until = p_valid_until,
           max_uses = p_max_uses, max_uses_per_user = coalesce(p_max_uses_per_user, 1), first_order_only = coalesce(p_first_order_only, false),
           active = coalesce(p_active, true), updated_at = now()
     where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'Cupom não encontrado.' using errcode = 'P0001';
    end if;
  end if;
  return v_id;
exception when unique_violation then
  raise exception 'Já existe um cupom com este código.' using errcode = '22023';
end;
$$;

-- order_stage_info passa a trazer o desconto (o cartão do pedido mostra o valor certo)
drop function if exists public.order_stage_info(uuid[]);
create function public.order_stage_info(p_order_ids uuid[])
returns table (order_id uuid, client_confirmed_at timestamptz, delivered_at timestamptz, auto_concluded boolean,
               can_confirm boolean, can_dispute boolean, dispute jsonb, discount_amount numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
  select o.id, o.client_confirmed_at, o.delivered_at,
         (o.client_confirmed_at is null and o.status = 'entregue' and o.delivered_at < now() - interval '7 days'
          and not public.order_has_open_dispute(o.id)),
         (o.client_user_id = auth.uid() and o.status = 'entregue' and o.client_confirmed_at is null
          and not public.order_has_open_dispute(o.id)),
         (o.status not in ('orcamento', 'cancelado') and o.client_confirmed_at is null
          and not public.order_has_open_dispute(o.id)
          and (o.status <> 'entregue' or o.delivered_at >= now() - interval '7 days')
          and (o.client_user_id = auth.uid() or public.is_business_owner(o.business_id))
          and (select count(*) from public.order_disputes x where x.order_id = o.id) < 3),
         (select jsonb_build_object('id', d.id, 'status', d.status, 'reason', d.reason, 'description', d.description,
                                    'opened_by_role', d.opened_by_role, 'created_at', d.created_at,
                                    'response', d.response, 'responded_at', d.responded_at,
                                    'resolution', d.resolution, 'resolution_note', d.resolution_note, 'resolved_at', d.resolved_at,
                                    'can_respond', d.status = 'aberta'
                                       and ((d.opened_by_role = 'cliente' and public.is_business_owner(o.business_id))
                                         or (d.opened_by_role = 'prestador' and o.client_user_id = auth.uid())))
          from public.order_disputes d where d.order_id = o.id order by d.created_at desc limit 1),
         o.discount_amount
  from public.orders o
  where o.id = any (coalesce(p_order_ids, '{}'))
    and (o.client_user_id = auth.uid() or public.is_business_member(o.business_id));
end;
$$;

-- ---------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------
revoke all on function public.audit_immutable() from public, anon, authenticated;
revoke all on function public.audit_row() from public, anon, authenticated;
revoke all on function public.coupon_order_guard(uuid) from public, anon, authenticated;
revoke all on function public.app_order_amount(public.orders) from public, anon, authenticated;
revoke all on function public.admin_audit_logs(text, integer, integer) from public, anon;
revoke all on function public.admin_users(text, public.user_role, integer, integer) from public, anon;
revoke all on function public.admin_orders(text, public.order_status, public.order_origin, integer, integer) from public, anon;
revoke all on function public.admin_listings(text, text, integer, integer) from public, anon;
revoke all on function public.admin_close_listing(uuid, text) from public, anon;
revoke all on function public.apply_coupon(uuid, text) from public, anon;
revoke all on function public.remove_coupon(uuid) from public, anon;
revoke all on function public.order_coupon(uuid) from public, anon;
revoke all on function public.admin_coupons() from public, anon;
revoke all on function public.admin_upsert_coupon(uuid, text, text, text, numeric, numeric, numeric, timestamptz, integer, integer, boolean, boolean) from public, anon;
revoke all on function public.order_stage_info(uuid[]) from public, anon;
grant execute on function public.admin_audit_logs(text, integer, integer) to authenticated;
grant execute on function public.admin_users(text, public.user_role, integer, integer) to authenticated;
grant execute on function public.admin_orders(text, public.order_status, public.order_origin, integer, integer) to authenticated;
grant execute on function public.admin_listings(text, text, integer, integer) to authenticated;
grant execute on function public.admin_close_listing(uuid, text) to authenticated;
grant execute on function public.apply_coupon(uuid, text) to authenticated;
grant execute on function public.remove_coupon(uuid) to authenticated;
grant execute on function public.order_coupon(uuid) to authenticated;
grant execute on function public.admin_coupons() to authenticated;
grant execute on function public.admin_upsert_coupon(uuid, text, text, text, numeric, numeric, numeric, timestamptz, integer, integer, boolean, boolean) to authenticated;
grant execute on function public.order_stage_info(uuid[]) to authenticated;
