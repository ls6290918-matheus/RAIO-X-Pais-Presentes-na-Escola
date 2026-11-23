-- =====================================================================
-- LIMPA AQUI — Etapa 6: agenda do prestador (PRD: agenda e capacidade)
-- provider_agenda(lavanderia, de, até): pedidos por dia de entrega prevista (due_date),
-- com a capacidade diária do perfil de trabalho, as corridas de coleta/devolução de cada pedido
-- e os pedidos atrasados (prazo antes do período e ainda não entregues). Equipe e dono veem.
-- =====================================================================

create or replace function public.provider_agenda(p_business_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if not public.is_business_member(p_business_id) then
    raise exception 'Somente a equipe da lavanderia vê a agenda.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 41 then
    raise exception 'Período inválido (até 6 semanas).' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'capacity', (select b.daily_capacity from public.businesses b where b.id = p_business_id),
    'today', v_today,
    'days', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'date', d::date,
               'count', (select count(*) from public.orders o
                          where o.business_id = p_business_id and o.due_date = d::date and o.status not in ('cancelado', 'orcamento')),
               'open', (select count(*) from public.orders o
                         where o.business_id = p_business_id and o.due_date = d::date and o.status in ('recebido', 'em_lavagem', 'pronto'))
             ) order by d), '[]'::jsonb)
      from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d
    ),
    'orders', (
      select coalesce(jsonb_agg(x order by x.due_date, x.number), '[]'::jsonb) from (
        select o.id, o.number, o.due_date, o.status, o.paid, o.total, o.origin, o.logistics_mode, o.delivery_type,
               c.name as customer,
               (select coalesce(sum(i.quantity), 0) from public.order_items i where i.order_id = o.id) as items,
               (select dl.status from public.deliveries dl where dl.order_id = o.id and dl.leg = 'pickup' order by dl.created_at desc limit 1) as pickup_status,
               (select dl.status from public.deliveries dl where dl.order_id = o.id and dl.leg = 'return' order by dl.created_at desc limit 1) as return_status,
               (o.due_date < v_today and o.status in ('recebido', 'em_lavagem', 'pronto')) as late
        from public.orders o
        join public.customers c on c.id = o.customer_id
        where o.business_id = p_business_id and o.status not in ('cancelado', 'orcamento')
          and (o.due_date between p_from and p_to
               or (o.due_date < p_from and o.status in ('recebido', 'em_lavagem', 'pronto')))
        limit 500
      ) x
    )
  );
end;
$$;

revoke all on function public.provider_agenda(uuid, date, date) from public, anon;
grant execute on function public.provider_agenda(uuid, date, date) to authenticated;
