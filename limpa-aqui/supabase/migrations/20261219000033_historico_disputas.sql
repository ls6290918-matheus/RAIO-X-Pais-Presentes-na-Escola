-- =====================================================================
-- LIMPA AQUI — Histórico do pedido, confirmação de recebimento e disputas (PRD seção 8)
--  * order_status_history: cada mudança do pedido fica registrada (quem, quando, de/para), por gatilho
--  * As etapas "aguardando pagamento", "concluído" e "em disputa" são derivadas, sem mexer no
--    enum order_status (as telas, comissões, avaliações e relatórios atuais continuam iguais):
--      - aguardando pagamento: pedido pelo app ainda não pago
--      - concluído: o cliente confirmou o recebimento (ou 7 dias após a entrega sem disputa)
--      - em disputa: há uma disputa aberta
--  * order_disputes: cliente ou dono da lavanderia abre; a outra parte responde; o admin decide
--  * Enquanto houver disputa aberta, os repasses do pedido ficam bloqueados e não podem ser pagos
--  * Só entra por RPC; ninguém lê as tabelas direto
-- =====================================================================

-- ---------------------------------------------------------------------
-- Histórico
-- ---------------------------------------------------------------------
create table if not exists public.order_status_history (
  id          bigint generated always as identity primary key,
  order_id    uuid not null references public.orders (id) on delete cascade,
  event       text not null check (event ~ '^[a-z_]{3,40}$'),
  from_status text,
  to_status   text,
  actor_id    uuid references auth.users (id) on delete set null,
  note        text check (note is null or char_length(note) <= 300),
  created_at  timestamptz not null default now()
);
create index if not exists order_status_history_order_idx on public.order_status_history (order_id, created_at, id);
alter table public.order_status_history enable row level security;
revoke all on public.order_status_history from anon, authenticated;

create or replace function public.order_history_add(p_order uuid, p_event text, p_from text, p_to text, p_note text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.order_status_history (order_id, event, from_status, to_status, actor_id, note)
  values (p_order, p_event, p_from, p_to, auth.uid(), left(p_note, 300));
$$;

create or replace function public.orders_history_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.order_history_add(new.id, 'criado', null, new.status::text);
    if new.payment_mode = 'app' and not new.paid and new.status <> 'cancelado' then
      perform public.order_history_add(new.id, 'aguardando_pagamento', null, null);
    end if;
    return new;
  end if;
  if new.status is distinct from old.status then
    perform public.order_history_add(new.id, 'status', old.status::text, new.status::text);
  end if;
  if new.paid is distinct from old.paid then
    perform public.order_history_add(new.id, case when new.paid then 'pagamento_confirmado' else 'pagamento_desfeito' end, null, null);
  end if;
  return new;
exception when others then
  return new; -- o histórico nunca impede a operação
end;
$$;

drop trigger if exists orders_history_ins on public.orders;
create trigger orders_history_ins after insert on public.orders
  for each row execute function public.orders_history_trigger();
drop trigger if exists orders_history_upd on public.orders;
create trigger orders_history_upd after update of status, paid on public.orders
  for each row execute function public.orders_history_trigger();

-- Pedidos que já existiam: o que dá para reconstruir pelas datas gravadas
insert into public.order_status_history (order_id, event, from_status, to_status, note, created_at)
select o.id, 'criado', null, null, 'Registrado antes do histórico', o.created_at
from public.orders o
where not exists (select 1 from public.order_status_history h where h.order_id = o.id);
insert into public.order_status_history (order_id, event, from_status, to_status, note, created_at)
select o.id, 'status', null, x.st, 'Registrado antes do histórico', x.at
from public.orders o
cross join lateral (values ('pronto', o.ready_at), ('entregue', o.delivered_at), ('cancelado', o.canceled_at)) as x (st, at)
where x.at is not null
  and not exists (select 1 from public.order_status_history h where h.order_id = o.id and h.event = 'status');

-- ---------------------------------------------------------------------
-- Confirmação de recebimento pelo cliente
-- ---------------------------------------------------------------------
alter table public.orders add column if not exists client_confirmed_at timestamptz;

-- ---------------------------------------------------------------------
-- Disputas
-- ---------------------------------------------------------------------
create table if not exists public.order_disputes (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders (id) on delete cascade,
  business_id     uuid not null references public.businesses (id) on delete cascade,
  opened_by       uuid references auth.users (id) on delete set null,
  opened_by_role  text not null check (opened_by_role in ('cliente', 'prestador')),
  reason          text not null check (reason in ('nao_recebido', 'dano', 'item_faltando', 'qualidade', 'cobranca', 'atraso', 'outro')),
  description     text not null check (char_length(description) between 10 and 1000),
  response        text check (response is null or char_length(response) <= 1000),
  responded_at    timestamptz,
  status          text not null default 'aberta' check (status in ('aberta', 'resolvida')),
  resolution      text check (resolution is null or resolution in ('favor_cliente', 'favor_prestador', 'acordo')),
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 500),
  resolved_by     uuid references auth.users (id) on delete set null,
  resolved_at     timestamptz,
  created_at      timestamptz not null default now(),
  check ((status = 'resolvida') = (resolution is not null))
);
create unique index if not exists order_disputes_one_open on public.order_disputes (order_id) where status = 'aberta';
create index if not exists order_disputes_status_idx on public.order_disputes (status, created_at desc);
alter table public.order_disputes enable row level security;
revoke all on public.order_disputes from anon, authenticated;

create or replace function public.order_has_open_dispute(p_order uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.order_disputes d where d.order_id = p_order and d.status = 'aberta');
$$;

-- ---------------------------------------------------------------------
-- Trava dos repasses durante a disputa
-- ---------------------------------------------------------------------
alter table public.payouts add column if not exists dispute_hold boolean not null default false;

create or replace function public.payouts_dispute_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.order_id is null or new.status not in ('pendente', 'pago') or not public.order_has_open_dispute(new.order_id) then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.status = 'pago' then
    raise exception 'Este pedido tem uma disputa aberta. O repasse só pode ser pago depois que ela for resolvida.' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and current_setting('limpaaqui.internal', true) is distinct from 'on' then
    raise exception 'Este pedido tem uma disputa aberta. O repasse continua bloqueado até ela ser resolvida.' using errcode = 'P0001';
  end if;
  -- repasse criado (ou liberado pelo gateway) durante a disputa: nasce bloqueado
  new.status := 'bloqueado';
  new.dispute_hold := true;
  return new;
end;
$$;

drop trigger if exists payouts_dispute_guard on public.payouts;
create trigger payouts_dispute_guard before insert or update of status on public.payouts
  for each row execute function public.payouts_dispute_guard();

-- Avisa todos os administradores
create or replace function public.notify_admins(p_kind text, p_title text, p_body text, p_link text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, kind, title, body, link)
  select r.user_id, p_kind, left(p_title, 120), left(p_body, 300), left(p_link, 200)
  from public.user_roles r where r.role = 'admin' and r.status = 'ativo';
$$;

-- ---------------------------------------------------------------------
-- RPCs do cliente e da lavanderia
-- ---------------------------------------------------------------------

-- Situação de cada pedido (etapa derivada, o que dá para fazer e a última disputa)
create or replace function public.order_stage_info(p_order_ids uuid[])
returns table (order_id uuid, client_confirmed_at timestamptz, delivered_at timestamptz, auto_concluded boolean,
               can_confirm boolean, can_dispute boolean, dispute jsonb)
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
          from public.order_disputes d where d.order_id = o.id order by d.created_at desc limit 1)
  from public.orders o
  where o.id = any (coalesce(p_order_ids, '{}'))
    and (o.client_user_id = auth.uid() or public.is_business_member(o.business_id));
end;
$$;

-- Linha do tempo: histórico do pedido + etapas das corridas + disputas
create or replace function public.order_timeline(p_order_id uuid)
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
  if o.id is null or not (o.client_user_id = auth.uid() or public.is_business_member(o.business_id) or public.has_role('admin')) then
    raise exception 'Pedido não encontrado.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'events', coalesce((select jsonb_agg(jsonb_build_object(
                  'event', h.event, 'from', h.from_status, 'to', h.to_status, 'note', h.note, 'at', h.created_at,
                  'actor', case when h.actor_id is null then 'sistema'
                                when h.actor_id = o.client_user_id then 'cliente'
                                when exists (select 1 from public.business_members m where m.business_id = o.business_id and m.user_id = h.actor_id) then 'lavanderia'
                                when exists (select 1 from public.user_roles r where r.user_id = h.actor_id and r.role = 'admin') then 'admin'
                                else 'sistema' end)
                  order by h.created_at, h.id)
                from public.order_status_history h where h.order_id = o.id), '[]'::jsonb),
    'deliveries', coalesce((select jsonb_agg(jsonb_build_object(
                  'leg', d.leg, 'status', d.status, 'created_at', d.created_at, 'accepted_at', d.accepted_at,
                  'picked_at', d.picked_at, 'completed_at', d.completed_at, 'canceled_at', d.canceled_at)
                  order by d.created_at)
                from public.deliveries d where d.order_id = o.id), '[]'::jsonb)
  );
end;
$$;

create or replace function public.confirm_order_received(p_order_id uuid)
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
    raise exception 'Só quem contratou o pedido pode confirmar o recebimento.' using errcode = '42501';
  end if;
  if o.status <> 'entregue' then
    raise exception 'Você pode confirmar quando o pedido for entregue.' using errcode = '22023';
  end if;
  if public.order_has_open_dispute(o.id) then
    raise exception 'Há uma disputa aberta neste pedido. Ela precisa ser resolvida antes.' using errcode = '22023';
  end if;
  if o.client_confirmed_at is not null then
    return;
  end if;
  update public.orders set client_confirmed_at = now() where id = o.id;
  perform public.order_history_add(o.id, 'concluido', null, null, 'Cliente confirmou o recebimento');
  begin
    perform public.notify_business(o.business_id, 'pedido_concluido', 'Pedido nº ' || o.number || ' concluído',
                                   'O cliente confirmou que recebeu tudo certo.', '/app/pedidos/' || o.id, false);
  exception when others then null;
  end;
end;
$$;

create or replace function public.open_dispute(p_order_id uuid, p_reason text, p_description text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  v_role text;
  v_id uuid;
  v_desc text := trim(coalesce(p_description, ''));
begin
  select * into o from public.orders where id = p_order_id for update;
  if o.id is null then
    raise exception 'Pedido não encontrado.' using errcode = '42501';
  end if;
  v_role := case when o.client_user_id = auth.uid() then 'cliente'
                 when public.is_business_owner(o.business_id) then 'prestador' end;
  if v_role is null then
    raise exception 'Só o cliente do pedido ou o dono da lavanderia podem abrir uma disputa.' using errcode = '42501';
  end if;
  if o.origin is distinct from 'marketplace' or o.client_user_id is null then
    raise exception 'Disputas valem para pedidos feitos pelo Limpa Aqui.' using errcode = '22023';
  end if;
  if o.status in ('orcamento', 'cancelado') then
    raise exception 'Este pedido não pode ter disputa.' using errcode = '22023';
  end if;
  if o.client_confirmed_at is not null then
    raise exception 'O recebimento já foi confirmado e o pedido está concluído.' using errcode = '22023';
  end if;
  if o.status = 'entregue' and o.delivered_at < now() - interval '7 days' then
    raise exception 'O prazo para abrir disputa é de 7 dias depois da entrega.' using errcode = '22023';
  end if;
  if public.order_has_open_dispute(o.id) then
    raise exception 'Já existe uma disputa aberta neste pedido.' using errcode = '22023';
  end if;
  if (select count(*) from public.order_disputes d where d.order_id = o.id) >= 3 then
    raise exception 'Este pedido já teve disputas demais. Fale com o suporte.' using errcode = '22023';
  end if;
  if p_reason is null or p_reason not in ('nao_recebido', 'dano', 'item_faltando', 'qualidade', 'cobranca', 'atraso', 'outro') then
    raise exception 'Escolha o motivo.' using errcode = '22023';
  end if;
  if char_length(v_desc) < 10 or char_length(v_desc) > 1000 then
    raise exception 'Conte o que aconteceu (de 10 a 1.000 caracteres).' using errcode = '22023';
  end if;

  insert into public.order_disputes (order_id, business_id, opened_by, opened_by_role, reason, description)
  values (o.id, o.business_id, auth.uid(), v_role, p_reason, v_desc)
  returning id into v_id;

  -- repasses ainda não pagos ficam bloqueados até a decisão
  perform set_config('limpaaqui.internal', 'on', true);
  update public.payouts set status = 'bloqueado', dispute_hold = true where order_id = o.id and status = 'pendente';
  perform set_config('limpaaqui.internal', 'off', true);

  perform public.order_history_add(o.id, 'disputa_aberta', null, null,
                                   case when v_role = 'cliente' then 'Aberta pelo cliente' else 'Aberta pela lavanderia' end);
  begin
    if v_role = 'cliente' then
      perform public.notify_business(o.business_id, 'disputa', 'Disputa no pedido nº ' || o.number,
                                     'O cliente relatou um problema. Responda para a administração analisar.', '/app/pedidos/' || o.id, true);
    else
      perform public.notify(o.client_user_id, 'disputa', 'Disputa no pedido nº ' || o.number,
                            'A lavanderia relatou um problema. Responda para a administração analisar.', '/cliente/pedidos');
    end if;
    perform public.notify_admins('disputa', 'Nova disputa: pedido nº ' || o.number, left(v_desc, 200), '/admin?aba=disputas');
  exception when others then null;
  end;
  return v_id;
end;
$$;

create or replace function public.respond_dispute(p_dispute_id uuid, p_response text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.order_disputes;
  o public.orders;
  v_text text := trim(coalesce(p_response, ''));
begin
  select * into d from public.order_disputes where id = p_dispute_id for update;
  if d.id is null then
    raise exception 'Disputa não encontrada.' using errcode = '42501';
  end if;
  select * into o from public.orders where id = d.order_id;
  if not ((d.opened_by_role = 'cliente' and public.is_business_owner(o.business_id))
       or (d.opened_by_role = 'prestador' and o.client_user_id = auth.uid())) then
    raise exception 'Só a outra parte do pedido pode responder.' using errcode = '42501';
  end if;
  if d.status <> 'aberta' then
    raise exception 'Esta disputa já foi resolvida.' using errcode = '22023';
  end if;
  if char_length(v_text) < 2 or char_length(v_text) > 1000 then
    raise exception 'Escreva a sua resposta (até 1.000 caracteres).' using errcode = '22023';
  end if;
  update public.order_disputes set response = v_text, responded_at = now() where id = d.id;
  perform public.order_history_add(o.id, 'disputa_respondida', null, null,
                                   case when d.opened_by_role = 'cliente' then 'Respondida pela lavanderia' else 'Respondida pelo cliente' end);
  begin
    perform public.notify_admins('disputa', 'Disputa respondida: pedido nº ' || o.number, left(v_text, 200), '/admin?aba=disputas');
  exception when others then null;
  end;
end;
$$;

-- ---------------------------------------------------------------------
-- Admin
-- ---------------------------------------------------------------------
create or replace function public.admin_disputes(p_status text default 'aberta')
returns table (id uuid, order_id uuid, order_number integer, business_name text, client_name text,
               opened_by_role text, reason text, description text, response text, responded_at timestamptz,
               status text, resolution text, resolution_note text, resolved_at timestamptz, created_at timestamptz,
               order_status public.order_status, payment_mode public.payment_mode, paid boolean, amount numeric,
               payouts_held numeric, payouts_paid numeric)
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
  select d.id, o.id, o.number, b.name, coalesce(nullif(trim(p.full_name), ''), 'Cliente'),
         d.opened_by_role, d.reason, d.description, d.response, d.responded_at,
         d.status, d.resolution, d.resolution_note, d.resolved_at, d.created_at,
         o.status, o.payment_mode, o.paid, round(coalesce(o.total, 0) + coalesce(o.delivery_fee_total, 0), 2),
         coalesce((select sum(x.amount) from public.payouts x where x.order_id = o.id and x.status = 'bloqueado'), 0),
         coalesce((select sum(x.amount) from public.payouts x where x.order_id = o.id and x.status = 'pago'), 0)
  from public.order_disputes d
  join public.orders o on o.id = d.order_id
  join public.businesses b on b.id = d.business_id
  left join public.profiles p on p.id = o.client_user_id
  where p_status is null or d.status = p_status
  order by (d.status = 'aberta') desc, d.created_at desc
  limit 300;
end;
$$;

create or replace function public.admin_resolve_dispute(p_dispute_id uuid, p_resolution text, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.order_disputes;
  o public.orders;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_label text;
begin
  if not public.has_role('admin') then
    raise exception 'Somente a administração da plataforma pode fazer isso.' using errcode = '42501';
  end if;
  select * into d from public.order_disputes where id = p_dispute_id for update;
  if d.id is null then
    raise exception 'Disputa não encontrada.' using errcode = 'P0001';
  end if;
  if d.status <> 'aberta' then
    raise exception 'Esta disputa já foi resolvida.' using errcode = '22023';
  end if;
  if p_resolution is null or p_resolution not in ('favor_cliente', 'favor_prestador', 'acordo') then
    raise exception 'Escolha a decisão.' using errcode = '22023';
  end if;
  if v_note is null or char_length(v_note) > 500 then
    raise exception 'Explique a decisão para as duas partes (até 500 caracteres).' using errcode = '22023';
  end if;
  select * into o from public.orders where id = d.order_id for update;

  update public.order_disputes
     set status = 'resolvida', resolution = p_resolution, resolution_note = v_note, resolved_by = auth.uid(), resolved_at = now()
   where id = d.id;

  perform set_config('limpaaqui.internal', 'on', true);
  if p_resolution = 'favor_cliente' then
    -- o dinheiro volta para o cliente: repasses não pagos são cancelados e o Pix vai para "a devolver"
    if o.payment_mode = 'app' and o.paid then
      update public.payment_transactions set needs_refund = true
       where order_id = o.id and applied and status = 'completed' and not needs_refund;
      perform public.ledger_add('pagamento_app_a_devolver', o.id, o.business_id, 'app', public.app_order_amount(o),
                                jsonb_build_object('reason', 'disputa', 'dispute_id', d.id));
      update public.payouts set status = 'cancelado', dispute_hold = false where order_id = o.id and status in ('pendente', 'bloqueado');
      if exists (select 1 from public.payouts x where x.order_id = o.id and x.status = 'pago') then
        perform public.ledger_add('repasse_a_recuperar', o.id, o.business_id, 'app',
                                  (select sum(x.amount) from public.payouts x where x.order_id = o.id and x.status = 'pago'),
                                  jsonb_build_object('dispute_id', d.id));
      end if;
      update public.platform_commissions set status = 'cancelada' where order_id = o.id and status <> 'cancelada';
    end if;
  else
    -- a favor da lavanderia ou acordo: o que a disputa bloqueou volta a valer
    -- (se o Pix estiver em estorno/contestação no gateway, continua bloqueado)
    update public.payouts x set status = 'pendente', dispute_hold = false
     where x.order_id = o.id and x.dispute_hold and x.status = 'bloqueado'
       and (x.transaction_id is null
            or exists (select 1 from public.payment_transactions t where t.id = x.transaction_id and t.status = 'completed'));
    update public.payouts set dispute_hold = false where order_id = o.id and dispute_hold;
  end if;
  perform set_config('limpaaqui.internal', 'off', true);

  v_label := case p_resolution when 'favor_cliente' then 'a favor do cliente' when 'favor_prestador' then 'a favor da lavanderia' else 'por acordo' end;
  perform public.order_history_add(o.id, 'disputa_resolvida', null, null, 'Resolvida ' || v_label || ': ' || v_note);
  perform public.ledger_add('disputa_resolvida', o.id, o.business_id, coalesce(o.payment_mode, 'direto'), 0,
                            jsonb_build_object('dispute_id', d.id, 'resolution', p_resolution));
  begin
    perform public.notify_business(o.business_id, 'disputa', 'Disputa do pedido nº ' || o.number || ' resolvida',
                                   'Decisão ' || v_label || '. ' || v_note, '/app/pedidos/' || o.id, true);
    perform public.notify(o.client_user_id, 'disputa', 'Disputa do pedido nº ' || o.number || ' resolvida',
                          'Decisão ' || v_label || '. ' || v_note, '/cliente/pedidos');
  exception when others then null;
  end;
end;
$$;

-- ---------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------
revoke all on function public.order_history_add(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.orders_history_trigger() from public, anon, authenticated;
revoke all on function public.payouts_dispute_guard() from public, anon, authenticated;
revoke all on function public.notify_admins(text, text, text, text) from public, anon, authenticated;
revoke all on function public.order_has_open_dispute(uuid) from public, anon, authenticated;
revoke all on function public.order_stage_info(uuid[]) from public, anon;
revoke all on function public.order_timeline(uuid) from public, anon;
revoke all on function public.confirm_order_received(uuid) from public, anon;
revoke all on function public.open_dispute(uuid, text, text) from public, anon;
revoke all on function public.respond_dispute(uuid, text) from public, anon;
revoke all on function public.admin_disputes(text) from public, anon;
revoke all on function public.admin_resolve_dispute(uuid, text, text) from public, anon;
grant execute on function public.order_stage_info(uuid[]) to authenticated;
grant execute on function public.order_timeline(uuid) to authenticated;
grant execute on function public.confirm_order_received(uuid) to authenticated;
grant execute on function public.open_dispute(uuid, text, text) to authenticated;
grant execute on function public.respond_dispute(uuid, text) to authenticated;
grant execute on function public.admin_disputes(text) to authenticated;
grant execute on function public.admin_resolve_dispute(uuid, text, text) to authenticated;
