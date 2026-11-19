-- =====================================================================
-- LIMPA AQUI — Marketplace, Etapa 7: painel administrativo
--  * admin_dashboard(período): indicadores do PRD separados por modalidade de pagamento, comissões,
--    logística, cobertura por município e atividade do marketplace
--  * admin_reconciliation(): pendências de conciliação (pagamento direto não confirmado, comissões a cobrar por prestador)
--  * admin_courier_report(período): corridas concluídas e valores por entregador (repasse no pagamento direto)
--  * admin_ledger(período, evento): livro-razão com nomes, para conferência e exportação
-- Só leitura; tudo checa has_role('admin').
-- =====================================================================

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
  )
  select jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'by_mode', (
      select jsonb_agg(jsonb_build_object(
        'mode', m.mode,
        'orders', (select count(*) from o where o.payment_mode = m.mode and o.status <> 'cancelado'),
        'canceled', (select count(*) from o where o.payment_mode = m.mode and o.status = 'cancelado'),
        'orders_total', coalesce((select sum(o.total) from o where o.payment_mode = m.mode and o.status <> 'cancelado'), 0),
        'paid_orders', (select count(*) from public.external_payment_confirmations e join o on o.id = e.order_id where o.payment_mode = m.mode),
        'paid_total', coalesce((select sum(e.amount) from public.external_payment_confirmations e join o on o.id = e.order_id where o.payment_mode = m.mode), 0)
      ) order by m.mode)
      from (values ('direto'::public.payment_mode), ('app'::public.payment_mode)) m (mode)
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

-- Pendências de conciliação
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
    -- pagamento direto: pedido já pronto/entregue (ou mais de 7 dias) sem confirmação de recebimento
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
    -- comissões a cobrar agrupadas por prestador
    'commissions_by_business', coalesce((
      select jsonb_agg(x order by x.amount desc) from (
        select b.id as business_id, b.name as business_name, count(*) as commissions, sum(c.commission_amount) as amount,
               min(c.created_at) as oldest
        from public.platform_commissions c join public.businesses b on b.id = c.business_id
        where c.status = 'a_cobrar'
        group by b.id, b.name
      ) x), '[]'::jsonb)
  );
end;
$$;

-- Corridas por entregador no período (no pagamento direto o cliente paga o entregador; aqui é a conferência)
create or replace function public.admin_courier_report(p_from date, p_to date)
returns table (user_id uuid, full_name text, phone text, rides bigint, fees numeric, earnings numeric, last_ride timestamptz)
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
  select d.courier_id, p.full_name, p.phone, count(*), sum(d.delivery_fee), sum(d.courier_earnings), max(d.completed_at)
  from public.deliveries d left join public.profiles p on p.id = d.courier_id
  where d.status = 'entregue' and d.courier_id is not null
    and d.completed_at >= (p_from::timestamp at time zone 'America/Sao_Paulo')
    and d.completed_at < ((p_to + 1)::timestamp at time zone 'America/Sao_Paulo')
  group by d.courier_id, p.full_name, p.phone
  order by count(*) desc;
end;
$$;

-- Livro-razão com nomes (para conferir e exportar)
create or replace function public.admin_ledger(p_from date, p_to date, p_event text default null)
returns table (id bigint, created_at timestamptz, event text, payment_mode public.payment_mode, amount numeric,
               business_name text, order_number integer, details jsonb)
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
  select f.id, f.created_at, f.event, f.payment_mode, f.amount, b.name, o.number, f.details
  from public.financial_ledger f
  left join public.businesses b on b.id = f.business_id
  left join public.orders o on o.id = f.order_id
  where f.created_at >= (p_from::timestamp at time zone 'America/Sao_Paulo')
    and f.created_at < ((p_to + 1)::timestamp at time zone 'America/Sao_Paulo')
    and (p_event is null or f.event = p_event)
  order by f.id desc
  limit 2000;
end;
$$;

revoke all on function public.admin_dashboard(date, date) from public, anon;
revoke all on function public.admin_reconciliation() from public, anon;
revoke all on function public.admin_courier_report(date, date) from public, anon;
revoke all on function public.admin_ledger(date, date, text) from public, anon;
grant execute on function public.admin_dashboard(date, date) to authenticated;
grant execute on function public.admin_reconciliation() to authenticated;
grant execute on function public.admin_courier_report(date, date) to authenticated;
grant execute on function public.admin_ledger(date, date, text) to authenticated;
