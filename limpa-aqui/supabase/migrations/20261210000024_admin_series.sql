-- =====================================================================
-- LIMPA AQUI — painel administrativo: séries para gráficos e pedidos recentes
--  * admin_timeseries(período): pedidos do marketplace por dia (até 31 dias) ou por semana,
--    com quantidade, valor e quantos já foram pagos (cancelados não contam)
--  * admin_recent_orders(período): pedidos do marketplace com prestador, cliente, modalidade e situação
-- Só leitura; só o admin.
-- =====================================================================

create or replace function public.admin_timeseries(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_step interval;
  v_unit text;
begin
  if not public.has_role('admin') then
    raise exception 'Somente a administração da plataforma pode fazer isso.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 731 then
    raise exception 'Período inválido (até 2 anos).' using errcode = '22023';
  end if;
  if p_to - p_from <= 31 then
    v_step := interval '1 day'; v_unit := 'day';
  else
    v_step := interval '1 week'; v_unit := 'week';
  end if;
  return jsonb_build_object('unit', v_unit, 'points', coalesce((
    select jsonb_agg(jsonb_build_object(
             'start', b::date,
             'label', to_char(b, 'DD/MM'),
             'orders', coalesce(t.orders, 0),
             'total', coalesce(t.total, 0),
             'paid', coalesce(t.paid, 0)) order by b)
    from generate_series(date_trunc(v_unit, p_from::timestamp), p_to::timestamp, v_step) b
    left join lateral (
      select count(*) as orders, sum(o.total) as total, count(*) filter (where o.paid) as paid
      from public.orders o
      where o.origin = 'marketplace' and o.status <> 'cancelado'
        and o.created_at >= greatest(b, p_from::timestamp) at time zone 'America/Sao_Paulo'
        and o.created_at < least(b + v_step, (p_to + 1)::timestamp) at time zone 'America/Sao_Paulo'
    ) t on true), '[]'::jsonb));
end;
$$;

create or replace function public.admin_recent_orders(p_from date, p_to date)
returns table (id uuid, number integer, business_name text, client_name text, payment_mode public.payment_mode,
               logistics_mode public.logistics_mode, status public.order_status, paid boolean, total numeric, created_at timestamptz)
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
  select o.id, o.number, b.name, c.name, o.payment_mode, o.logistics_mode, o.status, o.paid, o.total + coalesce(o.delivery_fee_total, 0), o.created_at
  from public.orders o
  join public.businesses b on b.id = o.business_id
  join public.customers c on c.id = o.customer_id
  where o.origin = 'marketplace'
    and o.created_at >= (p_from::timestamp at time zone 'America/Sao_Paulo')
    and o.created_at < ((p_to + 1)::timestamp at time zone 'America/Sao_Paulo')
  order by o.created_at desc
  limit 200;
end;
$$;

revoke all on function public.admin_timeseries(date, date) from public, anon;
revoke all on function public.admin_recent_orders(date, date) from public, anon;
grant execute on function public.admin_timeseries(date, date) to authenticated;
grant execute on function public.admin_recent_orders(date, date) to authenticated;
