-- =====================================================================
-- LIMPA AQUI — Marketplace, Etapa 5b: pagamento pelo app (Pix via SyncPay)
--  * platform_settings: o admin liga/desliga o pagamento pelo app e define o valor mínimo (nada fixo no código)
--  * payout_accounts: chave Pix de quem recebe repasses (lavanderia ou entregador)
--  * payment_transactions: cobranças Pix no gateway; o status só muda pelo gateway (webhook ou consulta)
--    O CPF de quem paga vai direto ao gateway e NUNCA é gravado aqui.
--  * payment_webhook_events: deduplicação dos avisos do gateway
--  * payouts: repasses que a plataforma deve a prestadores e entregadores (o admin paga e marca como pago)
--  * Regras: pedido pelo app só anda depois de pago; a coleta só é chamada depois do pagamento;
--    estorno/contestação suspendem ou cancelam os repasses; pagamento em duplicidade ou de pedido
--    cancelado vira "a devolver" para o admin.
-- As funções que recebem o resultado do gateway só podem ser chamadas pelo servidor (service_role).
-- =====================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'payout_status') then
    create type public.payout_status as enum ('pendente', 'bloqueado', 'pago', 'cancelado');
  end if;
  if not exists (select 1 from pg_type where typname = 'pix_key_type') then
    create type public.pix_key_type as enum ('cpf', 'cnpj', 'email', 'telefone', 'aleatoria');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Configuração da plataforma (uma linha só)
-- ---------------------------------------------------------------------
create table if not exists public.platform_settings (
  id                     boolean primary key default true check (id),
  app_payment_enabled    boolean not null default false,
  app_payment_min_amount numeric(10, 2) not null default 1 check (app_payment_min_amount between 0 and 10000),
  updated_at             timestamptz not null default now(),
  updated_by             uuid references auth.users (id) on delete set null
);
insert into public.platform_settings (id) values (true) on conflict (id) do nothing;

alter table public.platform_settings enable row level security;
create policy platform_settings_select_admin on public.platform_settings for select to authenticated using (public.has_role('admin'));
revoke all on public.platform_settings from anon, authenticated;
grant select on public.platform_settings to authenticated;

create or replace function public.app_payment_available()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.app_payment_enabled from public.platform_settings s where s.id), false);
$$;

create or replace function public.admin_set_app_payment(p_enabled boolean, p_min_amount numeric default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_role('admin') then
    raise exception 'Somente a administração da plataforma pode fazer isso.' using errcode = '42501';
  end if;
  if p_enabled is null or (p_min_amount is not null and (p_min_amount < 0 or p_min_amount > 10000)) then
    raise exception 'Valor mínimo entre R$ 0 e R$ 10.000.' using errcode = '22023';
  end if;
  update public.platform_settings
     set app_payment_enabled = p_enabled,
         app_payment_min_amount = coalesce(round(p_min_amount, 2), app_payment_min_amount),
         updated_at = now(), updated_by = auth.uid()
   where id;
  perform public.ledger_add(case when p_enabled then 'pagamento_app_ligado' else 'pagamento_app_desligado' end,
                            null, null, 'app', 0, jsonb_build_object('min_amount', p_min_amount));
end;
$$;

create or replace function public.admin_platform_settings()
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
  return (select jsonb_build_object('app_payment_enabled', s.app_payment_enabled, 'app_payment_min_amount', s.app_payment_min_amount,
                                    'updated_at', s.updated_at)
          from public.platform_settings s where s.id);
end;
$$;

-- ---------------------------------------------------------------------
-- Chave Pix para repasses (lavanderia: só o dono; entregador: a própria conta)
-- ---------------------------------------------------------------------
create table if not exists public.payout_accounts (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid unique references public.businesses (id) on delete cascade,
  user_id      uuid unique references auth.users (id) on delete cascade,
  pix_key_type public.pix_key_type not null,
  pix_key      text not null check (char_length(pix_key) between 3 and 140),
  holder_name  text not null check (char_length(holder_name) between 3 and 120),
  updated_at   timestamptz not null default now(),
  check ((business_id is null) <> (user_id is null))
);

alter table public.payout_accounts enable row level security;
create policy payout_accounts_select on public.payout_accounts for select to authenticated
  using (public.has_role('admin') or user_id = auth.uid() or (business_id is not null and public.is_business_owner(business_id)));
revoke all on public.payout_accounts from anon, authenticated;
grant select on public.payout_accounts to authenticated;

create or replace function public.save_payout_account(p_business_id uuid, p_key_type public.pix_key_type, p_key text, p_holder text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := trim(coalesce(p_key, ''));
  v_digits text := regexp_replace(coalesce(p_key, ''), '\D', '', 'g');
  v_holder text := trim(coalesce(p_holder, ''));
begin
  if auth.uid() is null then
    raise exception 'Faça login para continuar.' using errcode = '28000';
  end if;
  if p_business_id is not null and not public.is_business_owner(p_business_id) then
    raise exception 'Somente o dono da lavanderia pode cadastrar a chave Pix de repasse.' using errcode = '42501';
  end if;
  if p_business_id is null and not public.has_role('entregador') then
    raise exception 'Cadastre-se como entregador para informar uma chave Pix.' using errcode = '42501';
  end if;
  if char_length(v_holder) < 3 or char_length(v_holder) > 120 then
    raise exception 'Informe o nome do titular da chave.' using errcode = '22023';
  end if;
  v_key := case p_key_type
             when 'cpf' then case when char_length(v_digits) = 11 then v_digits end
             when 'cnpj' then case when char_length(v_digits) = 14 then v_digits end
             when 'telefone' then case when char_length(v_digits) between 10 and 13 then v_digits end
             when 'email' then case when lower(v_key) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(v_key) <= 140 then lower(v_key) end
             when 'aleatoria' then case when lower(v_key) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then lower(v_key) end
           end;
  if v_key is null then
    raise exception 'Chave Pix inválida para o tipo escolhido.' using errcode = '22023';
  end if;
  if p_business_id is not null then
    insert into public.payout_accounts (business_id, pix_key_type, pix_key, holder_name)
    values (p_business_id, p_key_type, v_key, v_holder)
    on conflict (business_id) do update set pix_key_type = excluded.pix_key_type, pix_key = excluded.pix_key,
                                            holder_name = excluded.holder_name, updated_at = now();
  else
    insert into public.payout_accounts (user_id, pix_key_type, pix_key, holder_name)
    values (auth.uid(), p_key_type, v_key, v_holder)
    on conflict (user_id) do update set pix_key_type = excluded.pix_key_type, pix_key = excluded.pix_key,
                                        holder_name = excluded.holder_name, updated_at = now();
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Prestador liga/desliga "Pagamento pelo app"
-- ---------------------------------------------------------------------
create or replace function public.protect_business_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('limpaaqui.internal', true) = 'on' then
    return new;
  end if;
  if new.slug is distinct from old.slug then
    raise exception 'O endereço público não pode ser alterado nesta versão.' using errcode = 'P0001';
  end if;
  if new.next_order_number is distinct from old.next_order_number then
    raise exception 'Numeração de pedidos é controlada pelo sistema.' using errcode = 'P0001';
  end if;
  if new.created_by is distinct from old.created_by or new.id is distinct from old.id then
    raise exception 'Campo protegido.' using errcode = 'P0001';
  end if;
  if new.marketplace_visible is distinct from old.marketplace_visible then
    raise exception 'Use a opção "Aparecer na busca" nas Configurações.' using errcode = 'P0001';
  end if;
  if new.accepts_app_payment is distinct from old.accepts_app_payment then
    raise exception 'Use a opção "Pagamento pelo app" nas Configurações.' using errcode = 'P0001';
  end if;
  if new.marketplace_visible and not new.accepts_direct_payment and not new.accepts_app_payment then
    raise exception 'Mantenha pelo menos uma forma de pagamento enquanto aparece na busca.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create or replace function public.set_app_payment(p_business_id uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.businesses;
begin
  select * into b from public.businesses where id = p_business_id;
  if b.id is null or not public.is_business_owner(b.id) then
    raise exception 'Somente o dono da lavanderia pode mudar as formas de pagamento.' using errcode = '42501';
  end if;
  if p_enabled then
    if not public.app_payment_available() then
      raise exception 'O pagamento pelo app ainda não foi liberado pela plataforma.' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.payout_accounts a where a.business_id = b.id) then
      raise exception 'Cadastre a chave Pix para receber os repasses antes de ligar o pagamento pelo app.' using errcode = 'P0001';
    end if;
  elsif b.marketplace_visible and not b.accepts_direct_payment then
    raise exception 'Mantenha pelo menos uma forma de pagamento enquanto aparece na busca.' using errcode = 'P0001';
  end if;
  perform set_config('limpaaqui.internal', 'on', true);
  update public.businesses set accepts_app_payment = coalesce(p_enabled, false) where id = b.id;
  perform set_config('limpaaqui.internal', 'off', true);
end;
$$;

-- ---------------------------------------------------------------------
-- Cobranças no gateway
-- ---------------------------------------------------------------------
create table if not exists public.payment_transactions (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid references public.orders (id) on delete set null,
  business_id        uuid references public.businesses (id) on delete set null,
  payer_user_id      uuid references auth.users (id) on delete set null,
  gateway            text not null default 'syncpay' check (gateway in ('syncpay')),
  identifier         text not null unique check (char_length(identifier) between 8 and 80),
  pix_code           text check (pix_code is null or char_length(pix_code) <= 1000),
  amount             numeric(12, 2) not null check (amount > 0),
  net_amount         numeric(12, 2),
  status             text not null default 'pending'
                     check (status in ('pending', 'completed', 'failed', 'refused', 'three_ds_failed', 'refunding', 'refunded', 'chargeback', 'med')),
  applied            boolean not null default false,  -- foi este pagamento que quitou o pedido
  needs_refund       boolean not null default false,  -- pago em duplicidade, pedido cancelado ou valor divergente
  refund_code        text,
  refund_requested_at timestamptz,
  status_checks      integer not null default 0 check (status_checks between 0 and 5),
  end_to_end_id      text,
  paid_at            timestamptz,
  refunded_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists payment_transactions_order_idx on public.payment_transactions (order_id, created_at desc);
create index if not exists payment_transactions_attention_idx on public.payment_transactions (needs_refund) where needs_refund;

create trigger payment_transactions_updated_at
  before update on public.payment_transactions
  for each row execute function public.set_updated_at();

alter table public.payment_transactions enable row level security;
create policy payment_transactions_select on public.payment_transactions for select to authenticated
  using (public.has_role('admin') or payer_user_id = auth.uid() or (business_id is not null and public.is_business_owner(business_id)));
revoke all on public.payment_transactions from anon, authenticated;
grant select (id, order_id, business_id, gateway, amount, net_amount, status, applied, needs_refund, paid_at, refunded_at, created_at, updated_at)
  on public.payment_transactions to authenticated;

create table if not exists public.payment_webhook_events (
  event_id    text primary key check (char_length(event_id) between 1 and 120),
  identifier  text not null,
  status      text not null,
  received_at timestamptz not null default now()
);
alter table public.payment_webhook_events enable row level security;
revoke all on public.payment_webhook_events from anon, authenticated;

-- ---------------------------------------------------------------------
-- Repasses (o que a plataforma deve pagar a prestadores e entregadores)
-- ---------------------------------------------------------------------
create table if not exists public.payouts (
  id             uuid primary key default gen_random_uuid(),
  payee_type     text not null check (payee_type in ('prestador', 'entregador')),
  business_id    uuid references public.businesses (id) on delete set null,
  courier_id     uuid references auth.users (id) on delete set null,
  order_id       uuid references public.orders (id) on delete set null,
  delivery_id    uuid references public.deliveries (id) on delete set null,
  transaction_id uuid references public.payment_transactions (id) on delete set null,
  amount         numeric(12, 2) not null check (amount >= 0),
  status         public.payout_status not null default 'pendente',
  reference      text check (reference is null or char_length(reference) <= 120),
  paid_at        timestamptz,
  paid_by        uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check ((payee_type = 'prestador') = (delivery_id is null))
);

create unique index if not exists payouts_one_per_order on public.payouts (order_id) where payee_type = 'prestador' and status <> 'cancelado';
create unique index if not exists payouts_one_per_delivery on public.payouts (delivery_id) where status <> 'cancelado';
create index if not exists payouts_status_idx on public.payouts (status, created_at);

create trigger payouts_updated_at
  before update on public.payouts
  for each row execute function public.set_updated_at();

alter table public.payouts enable row level security;
create policy payouts_select on public.payouts for select to authenticated
  using (public.has_role('admin') or courier_id = auth.uid() or (business_id is not null and payee_type = 'prestador' and public.is_business_owner(business_id)));
revoke all on public.payouts from anon, authenticated;
grant select on public.payouts to authenticated;

-- ---------------------------------------------------------------------
-- Pedido pelo app: não anda nem muda de valor sem o pagamento
-- ---------------------------------------------------------------------
create or replace function public.protect_app_payment_order()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('limpaaqui.internal', true) = 'on' or old.payment_mode is distinct from 'app' then
    return new;
  end if;
  if new.status is distinct from old.status and new.status <> 'cancelado' and not old.paid then
    raise exception 'Aguardando o pagamento do cliente pelo app. O pedido só pode andar depois de pago.' using errcode = 'P0001';
  end if;
  if new.total is distinct from old.total or new.delivery_fee_total is distinct from old.delivery_fee_total then
    raise exception 'Em pedidos pagos pelo app o valor não pode ser alterado.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger orders_protect_app_payment
  before update of status, total, delivery_fee_total on public.orders
  for each row execute function public.protect_app_payment_order();

-- Valor cobrado do cliente: serviços + taxas de entrega
create or replace function public.app_order_amount(o public.orders)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select round(coalesce(o.total, 0) + coalesce(o.delivery_fee_total, 0), 2);
$$;

-- ---------------------------------------------------------------------
-- Cliente: dados para gerar o Pix (chamado pela função do servidor com o login do cliente)
-- ---------------------------------------------------------------------
create or replace function public.app_payment_checkout(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  b public.businesses;
  v_amount numeric;
  v_min numeric;
  v_email text;
  v_prof public.profiles;
  t public.payment_transactions;
begin
  select * into o from public.orders where id = p_order_id;
  if o.id is null or o.client_user_id is distinct from auth.uid() then
    raise exception 'Pedido não encontrado.' using errcode = 'P0001';
  end if;
  if o.payment_mode is distinct from 'app' then
    raise exception 'Este pedido é pago direto ao prestador.' using errcode = 'P0001';
  end if;
  if o.paid then
    raise exception 'Este pedido já está pago.' using errcode = 'P0001';
  end if;
  if o.status = 'cancelado' then
    raise exception 'Este pedido foi cancelado.' using errcode = 'P0001';
  end if;
  if not public.app_payment_available() then
    raise exception 'O pagamento pelo app está temporariamente indisponível. Tente mais tarde.' using errcode = 'P0001';
  end if;
  v_amount := public.app_order_amount(o);
  select s.app_payment_min_amount into v_min from public.platform_settings s where s.id;
  if v_amount < coalesce(v_min, 0) or v_amount <= 0 then
    raise exception 'Valor abaixo do mínimo para pagamento pelo app.' using errcode = 'P0001';
  end if;
  select * into b from public.businesses where id = o.business_id;
  select u.email into v_email from auth.users u where u.id = auth.uid();
  select * into v_prof from public.profiles where id = auth.uid();

  -- reaproveita o Pix pendente recente com o mesmo valor (evita cobrança em duplicidade)
  select * into t from public.payment_transactions x
   where x.order_id = o.id and x.status = 'pending' and x.amount = v_amount and x.created_at > now() - interval '20 minutes'
   order by x.created_at desc limit 1;

  return jsonb_build_object(
    'order_id', o.id, 'user_id', auth.uid(), 'number', o.number, 'amount', v_amount, 'business_name', b.name,
    'description', left('Limpa Aqui - pedido ' || o.number || ' - ' || b.name, 120),
    'name', coalesce(nullif(trim(v_prof.full_name), ''), 'Cliente Limpa Aqui'),
    'email', v_email, 'phone', v_prof.phone,
    'pending', case when t.id is not null then
                 jsonb_build_object('id', t.id, 'identifier', t.identifier, 'pix_code', t.pix_code, 'amount', t.amount, 'created_at', t.created_at)
               end
  );
end;
$$;

-- Servidor: grava a cobrança criada no gateway
create or replace function public.app_payment_register(p_order_id uuid, p_user_id uuid, p_identifier text, p_pix_code text, p_amount numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  v_id uuid;
begin
  select * into o from public.orders where id = p_order_id;
  if o.id is null or o.client_user_id is distinct from p_user_id or o.payment_mode is distinct from 'app' then
    raise exception 'Pedido não encontrado.' using errcode = 'P0001';
  end if;
  if round(p_amount, 2) <> public.app_order_amount(o) then
    raise exception 'Valor diferente do pedido.' using errcode = 'P0001';
  end if;
  insert into public.payment_transactions (order_id, business_id, payer_user_id, identifier, pix_code, amount)
  values (o.id, o.business_id, p_user_id, p_identifier, p_pix_code, round(p_amount, 2))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'identifier', p_identifier, 'pix_code', p_pix_code, 'amount', round(p_amount, 2), 'created_at', now());
end;
$$;

-- Cliente: "Já paguei" — libera uma consulta ao gateway (no máximo 5 por cobrança, a partir de 1 minuto)
create or replace function public.app_payment_status_check(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  t public.payment_transactions;
begin
  select * into o from public.orders where id = p_order_id;
  if o.id is null or o.client_user_id is distinct from auth.uid() then
    raise exception 'Pedido não encontrado.' using errcode = 'P0001';
  end if;
  select * into t from public.payment_transactions x where x.order_id = o.id order by x.created_at desc limit 1 for update;
  if t.id is null then
    return jsonb_build_object('paid', o.paid, 'status', null, 'query', false);
  end if;
  if o.paid or t.status <> 'pending' or t.status_checks >= 5 or t.created_at > now() - interval '1 minute' then
    return jsonb_build_object('paid', o.paid, 'status', t.status, 'query', false);
  end if;
  update public.payment_transactions set status_checks = status_checks + 1 where id = t.id;
  return jsonb_build_object('paid', o.paid, 'status', t.status, 'query', true, 'identifier', t.identifier);
end;
$$;

-- Servidor: aviso de pagamento sem assinatura → só consulta o gateway se ainda houver consultas
create or replace function public.app_payment_claim_check(p_identifier text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.payment_transactions set status_checks = status_checks + 1
   where identifier = p_identifier and status in ('pending', 'completed', 'refunding', 'med') and status_checks < 5;
  return found;
end;
$$;

-- Cliente: cancelar pedido pelo app que ainda não foi pago
create or replace function public.cancel_unpaid_app_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
begin
  select * into o from public.orders where id = p_order_id for update;
  if o.id is null or o.client_user_id is distinct from auth.uid() then
    raise exception 'Pedido não encontrado.' using errcode = 'P0001';
  end if;
  if o.payment_mode is distinct from 'app' or o.paid or o.status = 'cancelado' then
    raise exception 'Só dá para cancelar aqui um pedido pelo app que ainda não foi pago.' using errcode = 'P0001';
  end if;
  perform set_config('limpaaqui.internal', 'on', true);
  update public.orders set status = 'cancelado' where id = o.id;
  perform set_config('limpaaqui.internal', 'off', true);
end;
$$;

-- ---------------------------------------------------------------------
-- Servidor: aplica o status informado pelo gateway (webhook assinado ou consulta)
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

-- Pedido pago pelo app cancelado depois: o dinheiro precisa voltar ao cliente
create or replace function public.app_payment_on_cancel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.payment_mode is distinct from 'app' or new.status <> 'cancelado' or old.status = 'cancelado' then
    return new;
  end if;
  update public.payment_transactions set needs_refund = true
   where order_id = new.id and applied and status = 'completed' and not needs_refund;
  if found then
    perform public.ledger_add('pagamento_app_a_devolver', new.id, new.business_id, 'app', public.app_order_amount(new),
                              jsonb_build_object('reason', 'pedido_cancelado'));
    update public.payouts set status = 'cancelado' where order_id = new.id and status in ('pendente', 'bloqueado');
    if exists (select 1 from public.payouts p where p.order_id = new.id and p.status = 'pago') then
      perform public.ledger_add('repasse_a_recuperar', new.id, new.business_id, 'app',
                                (select sum(p.amount) from public.payouts p where p.order_id = new.id and p.status = 'pago'), '{}'::jsonb);
    end if;
    update public.platform_commissions set status = 'cancelada' where order_id = new.id and status <> 'cancelada';
  end if;
  return new;
end;
$$;

create trigger orders_app_payment_on_cancel
  after update of status on public.orders
  for each row execute function public.app_payment_on_cancel();

-- Corrida concluída de pedido pago pelo app: repasse ao entregador
create or replace function public.app_payment_courier_payout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
begin
  if new.status <> 'entregue' or old.status = 'entregue' or new.courier_id is null then
    return new;
  end if;
  select * into o from public.orders where id = new.order_id;
  if o.payment_mode is distinct from 'app' or not o.paid then
    return new;
  end if;
  insert into public.payouts (payee_type, courier_id, order_id, delivery_id, transaction_id, amount, business_id)
  values ('entregador', new.courier_id, o.id, new.id,
          (select t.id from public.payment_transactions t where t.order_id = o.id and t.applied limit 1),
          new.courier_earnings, o.business_id)
  on conflict do nothing;
  perform public.ledger_add('repasse_previsto', o.id, o.business_id, 'app', new.courier_earnings,
                            jsonb_build_object('payee', 'entregador', 'delivery_id', new.id));
  return new;
end;
$$;

create trigger deliveries_app_payout
  after update of status on public.deliveries
  for each row execute function public.app_payment_courier_payout();

-- ---------------------------------------------------------------------
-- Estorno pedido pelo admin (a função do servidor chama o gateway)
-- ---------------------------------------------------------------------
create or replace function public.app_payment_refund_prepare(p_transaction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.payment_transactions;
begin
  if not public.has_role('admin') then
    raise exception 'Somente a administração da plataforma pode fazer isso.' using errcode = '42501';
  end if;
  select * into t from public.payment_transactions where id = p_transaction_id;
  if t.id is null then
    raise exception 'Cobrança não encontrada.' using errcode = 'P0001';
  end if;
  if t.status <> 'completed' then
    raise exception 'Só dá para estornar uma cobrança paga.' using errcode = 'P0001';
  end if;
  if t.refund_requested_at is not null then
    raise exception 'O estorno desta cobrança já foi pedido.' using errcode = 'P0001';
  end if;
  return jsonb_build_object('identifier', t.identifier, 'amount', t.amount, 'admin_id', auth.uid());
end;
$$;

create or replace function public.app_payment_refund_mark(p_transaction_id uuid, p_code text, p_reason text, p_admin uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.payment_transactions;
begin
  update public.payment_transactions set refund_code = left(p_code, 60), refund_requested_at = now()
   where id = p_transaction_id
  returning * into t;
  if t.id is null then
    raise exception 'Cobrança não encontrada.' using errcode = 'P0001';
  end if;
  insert into public.financial_ledger (event, order_id, business_id, payment_mode, amount, details, actor)
  values ('estorno_solicitado', t.order_id, t.business_id, 'app', t.amount,
          jsonb_build_object('identifier', t.identifier, 'code', p_code, 'reason', p_reason), p_admin);
end;
$$;

-- ---------------------------------------------------------------------
-- Consultas
-- ---------------------------------------------------------------------
-- Prestador: o dinheiro de um pedido (agora com o pagamento pelo app e o repasse)
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
                     from public.platform_commissions c where c.order_id = o.id) end,
    'app_payment', case when o.payment_mode = 'app' then
                     coalesce((select jsonb_build_object('status', t.status, 'amount', t.amount, 'paid_at', t.paid_at)
                               from public.payment_transactions t where t.order_id = o.id and t.applied limit 1),
                              jsonb_build_object('status', 'aguardando', 'amount', public.app_order_amount(o))) end,
    'payout', case when public.is_business_owner(o.business_id) then
                (select jsonb_build_object('amount', p.amount, 'status', p.status, 'paid_at', p.paid_at)
                 from public.payouts p where p.order_id = o.id and p.payee_type = 'prestador'
                 order by (p.status <> 'cancelado') desc, p.created_at desc limit 1) end
  );
end;
$$;

-- Repasses de quem está logado (entregador) ou da lavanderia (dono)
create or replace function public.my_payouts(p_business_id uuid default null)
returns table (id uuid, payee_type text, order_number integer, amount numeric, status public.payout_status,
               reference text, paid_at timestamptz, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_business_id is not null and not public.is_business_owner(p_business_id) then
    raise exception 'Somente o dono da lavanderia vê os repasses.' using errcode = '42501';
  end if;
  return query
  select p.id, p.payee_type, o.number, p.amount, p.status, p.reference, p.paid_at, p.created_at
  from public.payouts p left join public.orders o on o.id = p.order_id
  where (p_business_id is null and p.courier_id = auth.uid() and p.payee_type = 'entregador')
     or (p_business_id is not null and p.business_id = p_business_id and p.payee_type = 'prestador')
  order by p.created_at desc
  limit 200;
end;
$$;

-- Admin: repasses
create or replace function public.admin_list_payouts(p_status public.payout_status default null)
returns table (id uuid, payee_type text, payee_name text, pix_key_type public.pix_key_type, pix_key text, holder_name text,
               order_number integer, business_name text, amount numeric, status public.payout_status, reference text,
               paid_at timestamptz, created_at timestamptz)
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
  select p.id, p.payee_type,
         case when p.payee_type = 'prestador' then b.name else pr.full_name end,
         a.pix_key_type, a.pix_key, a.holder_name,
         o.number, b.name, p.amount, p.status, p.reference, p.paid_at, p.created_at
  from public.payouts p
  left join public.businesses b on b.id = p.business_id
  left join public.profiles pr on pr.id = p.courier_id
  left join public.orders o on o.id = p.order_id
  left join public.payout_accounts a on (p.payee_type = 'prestador' and a.business_id = p.business_id)
                                     or (p.payee_type = 'entregador' and a.user_id = p.courier_id)
  where p_status is null or p.status = p_status
  order by p.created_at desc
  limit 500;
end;
$$;

create or replace function public.admin_set_payout_status(p_payout_id uuid, p_status public.payout_status, p_reference text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.payouts;
begin
  if not public.has_role('admin') then
    raise exception 'Somente a administração da plataforma pode fazer isso.' using errcode = '42501';
  end if;
  select * into p from public.payouts where id = p_payout_id for update;
  if p.id is null then
    raise exception 'Repasse não encontrado.' using errcode = 'P0001';
  end if;
  if not ((p.status = 'pendente' and p_status in ('pago', 'bloqueado', 'cancelado'))
          or (p.status = 'bloqueado' and p_status in ('pendente', 'cancelado'))) then
    raise exception 'Mudança de situação não permitida.' using errcode = 'P0001';
  end if;
  if p_reference is not null and char_length(p_reference) > 120 then
    raise exception 'Referência muito longa (máximo de 120 caracteres).' using errcode = '22023';
  end if;
  update public.payouts
     set status = p_status,
         reference = coalesce(nullif(trim(coalesce(p_reference, '')), ''), reference),
         paid_at = case when p_status = 'pago' then now() else paid_at end,
         paid_by = case when p_status = 'pago' then auth.uid() else paid_by end
   where id = p.id;
  perform public.ledger_add('repasse_' || p_status::text, p.order_id, p.business_id, 'app', p.amount,
                            jsonb_build_object('payout_id', p.id, 'payee', p.payee_type));
end;
$$;

-- Admin: cobranças do app (as que precisam de devolução primeiro)
create or replace function public.admin_app_transactions(p_only_attention boolean default false)
returns table (id uuid, order_number integer, business_name text, payer_name text, amount numeric, net_amount numeric,
               status text, applied boolean, needs_refund boolean, refund_requested_at timestamptz, paid_at timestamptz, created_at timestamptz)
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
  select t.id, o.number, b.name, pr.full_name, t.amount, t.net_amount, t.status, t.applied, t.needs_refund,
         t.refund_requested_at, t.paid_at, t.created_at
  from public.payment_transactions t
  left join public.orders o on o.id = t.order_id
  left join public.businesses b on b.id = t.business_id
  left join public.profiles pr on pr.id = t.payer_user_id
  where not p_only_attention or t.needs_refund or t.status in ('refunding', 'med', 'chargeback')
  order by t.needs_refund desc, t.created_at desc
  limit 500;
end;
$$;

-- Resumo por modalidade: no app, "confirmado" é o que o gateway confirmou
drop function if exists public.admin_finance_summary();
create function public.admin_finance_summary()
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
         case when m.mode = 'direto'
              then (select count(*) from public.external_payment_confirmations e join public.orders o on o.id = e.order_id where o.payment_mode = 'direto')
              else (select count(*) from public.payment_transactions t where t.applied and t.status = 'completed' and not t.needs_refund) end,
         case when m.mode = 'direto'
              then coalesce((select sum(e.amount) from public.external_payment_confirmations e join public.orders o on o.id = e.order_id where o.payment_mode = 'direto'), 0)
              else coalesce((select sum(t.amount) from public.payment_transactions t where t.applied and t.status = 'completed' and not t.needs_refund), 0) end,
         coalesce((select sum(c.commission_amount) from public.platform_commissions c where c.payment_mode = m.mode and c.status = 'prevista'), 0),
         coalesce((select sum(c.commission_amount) from public.platform_commissions c where c.payment_mode = m.mode and c.status = 'a_cobrar'), 0),
         coalesce((select sum(c.commission_amount) from public.platform_commissions c where c.payment_mode = m.mode and c.status = 'paga'), 0)
  from (values ('direto'::public.payment_mode), ('app'::public.payment_mode)) as m (mode);
end;
$$;

-- Painel: pagos por modalidade (app = gateway) e o bloco do dinheiro que passa pela plataforma
create or replace function public.admin_dashboard(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t0 timestamptz;
  t1 timestamptz;
  v jsonb;
begin
  if not public.has_role('admin') then
    raise exception 'Somente a administração da plataforma pode fazer isso.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 731 then
    raise exception 'Período inválido (até 2 anos).' using errcode = '22023';
  end if;
  t0 := (p_from::timestamp at time zone 'America/Sao_Paulo');
  t1 := ((p_to + 1)::timestamp at time zone 'America/Sao_Paulo');

  with o as (
    select * from public.orders where origin = 'marketplace' and created_at >= t0 and created_at < t1
  ),
  paid as (
    select e.order_id, e.amount from public.external_payment_confirmations e
    union all
    select t.order_id, t.amount from public.payment_transactions t where t.applied and t.status = 'completed' and not t.needs_refund
  ),
  tx as (
    select * from public.payment_transactions where created_at >= t0 and created_at < t1
  )
  select jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'by_mode', (
      select jsonb_agg(jsonb_build_object(
        'mode', m.mode,
        'orders', (select count(*) from o where o.payment_mode = m.mode and o.status <> 'cancelado'),
        'canceled', (select count(*) from o where o.payment_mode = m.mode and o.status = 'cancelado'),
        'orders_total', coalesce((select sum(o.total) from o where o.payment_mode = m.mode and o.status <> 'cancelado'), 0),
        'paid_orders', (select count(*) from paid p join o on o.id = p.order_id where o.payment_mode = m.mode),
        'paid_total', coalesce((select sum(p.amount) from paid p join o on o.id = p.order_id where o.payment_mode = m.mode), 0)
      ) order by m.mode)
      from (values ('direto'::public.payment_mode), ('app'::public.payment_mode)) m (mode)
    ),
    'app_payments', jsonb_build_object(
      'enabled', public.app_payment_available(),
      'received', coalesce((select sum(t.amount) from tx t where t.paid_at is not null and t.status in ('completed', 'refunding', 'med')), 0),
      'gateway_fees', coalesce((select sum(t.amount - t.net_amount) from tx t where t.paid_at is not null and t.net_amount is not null), 0),
      'refunded', coalesce((select sum(t.amount) from tx t where t.status in ('refunded', 'chargeback')), 0),
      'to_refund', (select count(*) from public.payment_transactions t where t.needs_refund),
      'to_refund_amount', coalesce((select sum(t.amount) from public.payment_transactions t where t.needs_refund), 0),
      'disputed', (select count(*) from public.payment_transactions t where t.status in ('med', 'refunding')),
      'payouts_pending', coalesce((select sum(p.amount) from public.payouts p where p.status = 'pendente'), 0),
      'payouts_blocked', coalesce((select sum(p.amount) from public.payouts p where p.status = 'bloqueado'), 0),
      'payouts_paid', coalesce((select sum(p.amount) from public.payouts p where p.status = 'pago' and p.paid_at >= t0 and p.paid_at < t1), 0)
    ),
    'commissions', jsonb_build_object(
      'generated', coalesce((select sum(c.commission_amount) from public.platform_commissions c join o on o.id = c.order_id where c.status <> 'cancelada'), 0),
      'expected', coalesce((select sum(c.commission_amount) from public.platform_commissions c join o on o.id = c.order_id where c.status = 'prevista'), 0),
      'to_collect', coalesce((select sum(c.commission_amount) from public.platform_commissions c join o on o.id = c.order_id where c.status = 'a_cobrar'), 0),
      'paid', coalesce((select sum(c.commission_amount) from public.platform_commissions c join o on o.id = c.order_id where c.status = 'paga'), 0),
      'to_collect_all_time', coalesce((select sum(c.commission_amount) from public.platform_commissions c where c.status = 'a_cobrar'), 0)
    ),
    'logistics', jsonb_build_object(
      'orders_with_courier', (select count(*) from o where o.logistics_mode = 'entregador' and o.status <> 'cancelado'),
      'orders_by_provider', (select count(*) from o where o.logistics_mode = 'prestador' and o.status <> 'cancelado'),
      'orders_without', (select count(*) from o where o.logistics_mode = 'sem_logistica' and o.status <> 'cancelado'),
      'rides_done', (select count(*) from public.deliveries d where d.status = 'entregue' and d.completed_at >= t0 and d.completed_at < t1),
      'rides_fees', coalesce((select sum(d.delivery_fee) from public.deliveries d where d.status = 'entregue' and d.completed_at >= t0 and d.completed_at < t1), 0),
      'courier_earnings', coalesce((select sum(d.courier_earnings) from public.deliveries d where d.status = 'entregue' and d.completed_at >= t0 and d.completed_at < t1), 0),
      'rides_waiting', (select count(*) from public.deliveries d where d.status = 'disponivel'),
      'rides_ongoing', (select count(*) from public.deliveries d where d.status in ('aceita', 'coletada')),
      'couriers_approved', (select count(*) from public.user_roles r where r.role = 'entregador' and r.status = 'ativo'),
      'couriers_pending', (select count(*) from public.user_roles r where r.role = 'entregador' and r.status = 'pendente')
    ),
    'coverage', jsonb_build_object(
      'registered', (select count(*) from public.municipalities),
      'active', (select count(*) from public.municipalities m where m.status = 'ativo'),
      'suspended', (select count(*) from public.municipalities m where m.status = 'suspenso'),
      'with_providers', (select count(*) from public.marketplace_municipalities()),
      'with_logistics', (select count(*) from public.municipalities m where public.municipality_has_logistics(m.id)),
      'active_without_logistics', (select count(*) from public.municipalities m where m.status = 'ativo' and not public.municipality_has_logistics(m.id))
    ),
    'marketplace', jsonb_build_object(
      'clients', (select count(*) from public.user_roles r where r.role = 'anunciante' and r.status = 'ativo'),
      'providers', (select count(*) from public.businesses b where b.marketplace_visible),
      'providers_autonomo', (select count(*) from public.businesses b where b.marketplace_visible and b.provider_type = 'autonomo'),
      'providers_empresa', (select count(*) from public.businesses b where b.marketplace_visible and b.provider_type = 'empresa'),
      'listings', (select count(*) from public.listings l where l.created_at >= t0 and l.created_at < t1),
      'listings_hired', (select count(*) from public.listings l where l.created_at >= t0 and l.created_at < t1 and l.status = 'contratado'),
      'proposals', (select count(*) from public.proposals p where p.created_at >= t0 and p.created_at < t1),
      'orders_from_listing', (select count(*) from o where o.listing_id is not null or o.proposal_id is not null),
      'orders_from_profile', (select count(*) from o where o.listing_id is null and o.proposal_id is null)
    )
  ) into v;
  return v;
end;
$$;

-- Conciliação: + cobranças a devolver e repasses pendentes por recebedor
create or replace function public.admin_reconciliation()
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
    'unconfirmed_direct', coalesce((
      select jsonb_agg(x order by x.created_at) from (
        select o.id, o.number, b.name as business_name, o.total, o.status, o.created_at,
               (current_date - (o.created_at at time zone 'America/Sao_Paulo')::date) as days
        from public.orders o join public.businesses b on b.id = o.business_id
        where o.origin = 'marketplace' and o.payment_mode = 'direto' and o.status not in ('cancelado', 'orcamento')
          and not exists (select 1 from public.external_payment_confirmations e where e.order_id = o.id)
          and (o.status in ('pronto', 'entregue') or o.created_at < now() - interval '7 days')
        limit 200
      ) x), '[]'::jsonb),
    'commissions_by_business', coalesce((
      select jsonb_agg(x order by x.amount desc) from (
        select b.id as business_id, b.name as business_name, count(*) as commissions, sum(c.commission_amount) as amount,
               min(c.created_at) as oldest
        from public.platform_commissions c join public.businesses b on b.id = c.business_id
        where c.status = 'a_cobrar'
        group by b.id, b.name
      ) x), '[]'::jsonb),
    'app_to_refund', coalesce((
      select jsonb_agg(x order by x.created_at) from (
        select t.id, o.number, b.name as business_name, t.amount, t.status, t.created_at, t.refund_requested_at
        from public.payment_transactions t
        left join public.orders o on o.id = t.order_id
        left join public.businesses b on b.id = t.business_id
        where t.needs_refund
        limit 200
      ) x), '[]'::jsonb),
    'payouts_by_payee', coalesce((
      select jsonb_agg(x order by x.amount desc) from (
        select p.payee_type, coalesce(b.name, pr.full_name) as payee_name, count(*) as payouts, sum(p.amount) as amount,
               min(p.created_at) as oldest, bool_or(a.id is null) as missing_pix_key
        from public.payouts p
        left join public.businesses b on p.payee_type = 'prestador' and b.id = p.business_id
        left join public.profiles pr on p.payee_type = 'entregador' and pr.id = p.courier_id
        left join public.payout_accounts a on (p.payee_type = 'prestador' and a.business_id = p.business_id)
                                           or (p.payee_type = 'entregador' and a.user_id = p.courier_id)
        where p.status = 'pendente'
        group by p.payee_type, coalesce(b.name, pr.full_name)
      ) x), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Contratação: agora aceita "app" (quando a plataforma e o prestador aceitam)
-- ---------------------------------------------------------------------
create or replace function public.marketplace_place_order(
  p_business_id uuid, p_address_id uuid, p_items jsonb, p_custom_name text, p_custom_price numeric,
  p_due_days integer, p_payment public.payment_mode, p_logistics public.logistics_mode, p_pickup_ok boolean,
  p_notes text, p_listing_id uuid, p_proposal_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user     uuid := auth.uid();
  b          public.businesses;
  v_addr     public.user_addresses;
  v_prof     public.profiles;
  v_customer uuid;
  v_number   integer;
  v_order    uuid;
  v_tz       text;
  v_default  integer;
  v_res      record;
  v_total    numeric;
  v_days     integer;
  v_quote    record;
  v_fee      numeric;
  v_min      numeric;
begin
  if v_user is null then
    raise exception 'Faça login para continuar.' using errcode = '28000';
  end if;
  select * into b from public.businesses where id = p_business_id;
  if b.id is null or not public.provider_listable(b) then
    raise exception 'Este prestador não está recebendo pedidos pelo Limpa Aqui no momento.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.business_members bm where bm.business_id = b.id and bm.user_id = v_user) then
    raise exception 'Você não pode contratar a sua própria lavanderia.' using errcode = 'P0001';
  end if;

  select * into v_addr from public.user_addresses where id = p_address_id and user_id = v_user;
  if v_addr.id is null then
    raise exception 'Escolha um dos seus endereços.' using errcode = 'P0001';
  end if;
  if v_addr.municipality_id is null
     or not exists (select 1 from public.municipalities m where m.id = v_addr.municipality_id and m.status = 'ativo')
     or not public.provider_serves(b.id, b.municipality_id, v_addr.municipality_id) then
    raise exception 'Este prestador não atende o município desse endereço.' using errcode = 'P0001';
  end if;

  select * into v_prof from public.profiles where id = v_user;
  if v_prof.phone is null then
    raise exception 'Informe seu WhatsApp na sua área de cliente para o prestador falar com você.' using errcode = 'P0001';
  end if;

  if p_payment is null
     or (p_payment = 'direto' and not b.accepts_direct_payment)
     or (p_payment = 'app' and not b.accepts_app_payment) then
    raise exception 'Este prestador não aceita essa forma de pagamento.' using errcode = 'P0001';
  end if;
  if p_payment = 'app' and not public.app_payment_available() then
    raise exception 'O pagamento pelo app está temporariamente indisponível. Escolha pagar direto ao prestador.' using errcode = 'P0001';
  end if;
  if p_logistics is null or (p_logistics = 'prestador' and not p_pickup_ok) then
    raise exception 'Este prestador não faz coleta e entrega.' using errcode = 'P0001';
  end if;
  if p_logistics = 'entregador' then
    select * into v_quote from public.delivery_quote_core(b, v_addr);
    if not v_quote.available then
      raise exception '%', v_quote.reason using errcode = 'P0001';
    end if;
    v_fee := v_quote.fee;
  end if;
  if p_notes is not null and char_length(p_notes) > 500 then
    raise exception 'Observações muito longas (máximo de 500 caracteres).' using errcode = '22023';
  end if;

  select id into v_customer from public.customers where business_id = b.id and user_id = v_user;
  if v_customer is null then
    select id into v_customer from public.customers where business_id = b.id and whatsapp = v_prof.phone and user_id is null;
  end if;
  if v_customer is null then
    insert into public.customers (business_id, name, whatsapp, user_id)
    values (b.id, coalesce(v_prof.full_name, 'Cliente Limpa Aqui'),
            case when exists (select 1 from public.customers c where c.business_id = b.id and c.whatsapp = v_prof.phone)
                 then null else v_prof.phone end,
            v_user)
    returning id into v_customer;
  end if;
  update public.customers
     set user_id = v_user, street = v_addr.street, street_number = v_addr.street_number, complement = v_addr.complement,
         neighborhood = v_addr.neighborhood, city = v_addr.city, state = v_addr.state, postal_code = v_addr.postal_code,
         lat = v_addr.lat, lng = v_addr.lng, place_id = v_addr.place_id
   where id = v_customer;

  select s.timezone, s.default_due_days into v_tz, v_default from public.business_settings s where s.business_id = b.id;

  perform set_config('limpaaqui.internal', 'on', true);
  update public.businesses set next_order_number = next_order_number + 1 where id = b.id
  returning next_order_number - 1 into v_number;
  perform set_config('limpaaqui.internal', 'off', true);

  insert into public.orders (business_id, number, customer_id, due_date, notes, created_by, delivery_type, status,
                             origin, client_user_id, payment_mode, logistics_mode, listing_id, proposal_id,
                             delivery_fee_leg, delivery_fee_total)
  values (b.id, v_number, v_customer, current_date, nullif(trim(coalesce(p_notes, '')), ''), v_user,
          case when p_logistics in ('prestador', 'entregador') then 'entrega' else 'retirada' end::public.delivery_type, 'recebido',
          'marketplace', v_user, p_payment, p_logistics, p_listing_id, p_proposal_id,
          v_fee,
          coalesce(v_fee * 2, 0))
  returning id into v_order;

  if p_items is not null then
    if exists (select 1 from jsonb_array_elements(p_items) it
               join public.services s on s.id = nullif(it ->> 'service_id', '')::uuid and s.business_id = b.id
               where s.pricing_unit = 'orcamento') then
      raise exception 'Serviços sob orçamento são contratados por anúncio: publique o que precisa e receba a proposta.' using errcode = 'P0001';
    end if;
    select * into v_res from public.insert_order_items(
      b.id, v_order,
      (select jsonb_agg(it - 'unit_price') from jsonb_array_elements(p_items) it), v_default);
    v_total := v_res.total;
    v_days := v_res.max_days;
  else
    insert into public.order_items (business_id, order_id, service_name, quantity, unit_price, position)
    values (b.id, v_order, left(p_custom_name, 80), 1, p_custom_price, 0);
    v_total := p_custom_price;
    v_days := p_due_days;
  end if;

  if p_payment = 'app' then
    select s.app_payment_min_amount into v_min from public.platform_settings s where s.id;
    if round(coalesce(v_total, 0) + coalesce(v_fee * 2, 0), 2) < coalesce(v_min, 0) then
      raise exception 'O valor mínimo para pagar pelo app é R$ %.', to_char(v_min, 'FM999990D00') using errcode = 'P0001';
    end if;
  end if;

  -- o valor é definido aqui (antes do pagamento); a trava do app só vale depois de criado
  perform set_config('limpaaqui.internal', 'on', true);
  update public.orders
     set total = v_total,
         due_date = (now() at time zone coalesce(v_tz, 'America/Sao_Paulo'))::date + coalesce(v_days, v_default, 3)
   where id = v_order;
  perform set_config('limpaaqui.internal', 'off', true);

  -- pelo app, a coleta só é chamada quando o pagamento for confirmado
  if p_logistics = 'entregador' and p_payment <> 'app' then
    perform public.create_delivery_leg(v_order, 'pickup');
  end if;
  return v_order;
end;
$$;

-- ---------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------
revoke all on function public.app_payment_available() from public;
grant execute on function public.app_payment_available() to anon, authenticated;

revoke all on function public.admin_set_app_payment(boolean, numeric) from public, anon;
revoke all on function public.admin_platform_settings() from public, anon;
revoke all on function public.save_payout_account(uuid, public.pix_key_type, text, text) from public, anon;
revoke all on function public.set_app_payment(uuid, boolean) from public, anon;
revoke all on function public.app_payment_checkout(uuid) from public, anon;
revoke all on function public.app_payment_status_check(uuid) from public, anon;
revoke all on function public.cancel_unpaid_app_order(uuid) from public, anon;
revoke all on function public.app_payment_refund_prepare(uuid) from public, anon;
revoke all on function public.order_finance(uuid) from public, anon;
revoke all on function public.my_payouts(uuid) from public, anon;
revoke all on function public.admin_list_payouts(public.payout_status) from public, anon;
revoke all on function public.admin_set_payout_status(uuid, public.payout_status, text) from public, anon;
revoke all on function public.admin_app_transactions(boolean) from public, anon;
revoke all on function public.admin_finance_summary() from public, anon;
revoke all on function public.admin_dashboard(date, date) from public, anon;
revoke all on function public.admin_reconciliation() from public, anon;
grant execute on function public.admin_set_app_payment(boolean, numeric) to authenticated;
grant execute on function public.admin_platform_settings() to authenticated;
grant execute on function public.save_payout_account(uuid, public.pix_key_type, text, text) to authenticated;
grant execute on function public.set_app_payment(uuid, boolean) to authenticated;
grant execute on function public.app_payment_checkout(uuid) to authenticated;
grant execute on function public.app_payment_status_check(uuid) to authenticated;
grant execute on function public.cancel_unpaid_app_order(uuid) to authenticated;
grant execute on function public.app_payment_refund_prepare(uuid) to authenticated;
grant execute on function public.order_finance(uuid) to authenticated;
grant execute on function public.my_payouts(uuid) to authenticated;
grant execute on function public.admin_list_payouts(public.payout_status) to authenticated;
grant execute on function public.admin_set_payout_status(uuid, public.payout_status, text) to authenticated;
grant execute on function public.admin_app_transactions(boolean) to authenticated;
grant execute on function public.admin_finance_summary() to authenticated;
grant execute on function public.admin_dashboard(date, date) to authenticated;
grant execute on function public.admin_reconciliation() to authenticated;

-- Só o servidor (service_role) aplica resultados do gateway
revoke all on function public.app_payment_register(uuid, uuid, text, text, numeric) from public, anon, authenticated;
revoke all on function public.app_payment_apply(text, text, text, numeric, numeric, text, timestamptz) from public, anon, authenticated;
revoke all on function public.app_payment_claim_check(text) from public, anon, authenticated;
revoke all on function public.app_payment_refund_mark(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.app_payment_register(uuid, uuid, text, text, numeric) to service_role;
grant execute on function public.app_payment_apply(text, text, text, numeric, numeric, text, timestamptz) to service_role;
grant execute on function public.app_payment_claim_check(text) to service_role;
grant execute on function public.app_payment_refund_mark(uuid, text, text, uuid) to service_role;

revoke all on function public.app_order_amount(public.orders) from public, anon, authenticated;
revoke all on function public.protect_app_payment_order() from public, anon, authenticated;
revoke all on function public.app_payment_on_cancel() from public, anon, authenticated;
revoke all on function public.app_payment_courier_payout() from public, anon, authenticated;
revoke all on function public.marketplace_place_order(uuid, uuid, jsonb, text, numeric, integer, public.payment_mode, public.logistics_mode, boolean, text, uuid, uuid) from public, anon, authenticated;
