-- =====================================================================
-- LIMPA AQUI — painel financeiro do prestador (só o dono)
-- provider_dashboard(lavanderia): faturamento e recebido do mês, a receber, faturamento do ano,
-- variação sobre o mês anterior, faturamento das últimas 8 semanas (gráfico), repasses do app,
-- comissão a pagar e os últimos pedidos. Mês no fuso da lavanderia; pedidos cancelados não contam.
-- =====================================================================

create or replace function public.provider_dashboard(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz   text;
  v_now  timestamp;
  m0     timestamptz;
  m1     timestamptz;
  pm0    timestamptz;
  y0     timestamptz;
  w0     timestamptz;
begin
  if not public.is_business_owner(p_business_id) then
    raise exception 'Somente o dono da lavanderia vê o financeiro.' using errcode = '42501';
  end if;
  select coalesce(s.timezone, 'America/Sao_Paulo') into v_tz from public.business_settings s where s.business_id = p_business_id;
  v_tz := coalesce(v_tz, 'America/Sao_Paulo');
  v_now := now() at time zone v_tz;
  m0  := date_trunc('month', v_now) at time zone v_tz;
  m1  := (date_trunc('month', v_now) + interval '1 month') at time zone v_tz;
  pm0 := (date_trunc('month', v_now) - interval '1 month') at time zone v_tz;
  y0  := date_trunc('year', v_now) at time zone v_tz;
  w0  := (date_trunc('week', v_now) - interval '7 weeks') at time zone v_tz;

  return (
    with o as (
      select * from public.orders
       where business_id = p_business_id and status not in ('cancelado', 'orcamento') and received_at >= least(y0, pm0, w0)
    ),
    m as (select * from o where received_at >= m0 and received_at < m1)
    select jsonb_build_object(
      'month', jsonb_build_object(
        'revenue', coalesce((select sum(total) from m), 0),
        'received', coalesce((select sum(total) from m where paid), 0),
        'to_receive', coalesce((select sum(total) from m where not paid), 0),
        'orders', (select count(*) from m),
        'avg_ticket', coalesce((select round(avg(total), 2) from m), 0),
        'marketplace_orders', (select count(*) from m where origin = 'marketplace')
      ),
      'prev_month_revenue', coalesce((select sum(total) from o where received_at >= pm0 and received_at < m0), 0),
      'year_revenue', coalesce((select sum(total) from o where received_at >= y0), 0),
      'open_unpaid', coalesce((select sum(x.total) from public.orders x
                                where x.business_id = p_business_id and not x.paid and x.status in ('recebido', 'em_lavagem', 'pronto', 'entregue')), 0),
      'weekly', (select jsonb_agg(jsonb_build_object('week', to_char(wk, 'DD/MM'), 'total', coalesce(t.total, 0)) order by wk)
                 from generate_series(date_trunc('week', v_now) - interval '7 weeks', date_trunc('week', v_now), interval '1 week') wk
                 left join lateral (select sum(total) as total from o
                                     where received_at >= (wk at time zone v_tz) and received_at < ((wk + interval '1 week') at time zone v_tz)) t on true),
      'payouts_pending', coalesce((select sum(amount) from public.payouts p
                                    where p.business_id = p_business_id and p.payee_type = 'prestador' and p.status in ('pendente', 'bloqueado')), 0),
      'payouts_paid_month', coalesce((select sum(amount) from public.payouts p
                                       where p.business_id = p_business_id and p.payee_type = 'prestador' and p.status = 'pago' and p.paid_at >= m0), 0),
      'commission_to_pay', coalesce((select sum(commission_amount) from public.platform_commissions c
                                      where c.business_id = p_business_id and c.status = 'a_cobrar'), 0),
      'recent', coalesce((select jsonb_agg(r order by r.received_at desc) from (
                   select x.id, x.number, cu.name as customer, x.total, x.status, x.paid, x.origin, x.received_at
                   from public.orders x join public.customers cu on cu.id = x.customer_id
                   where x.business_id = p_business_id and x.status <> 'orcamento'
                   order by x.received_at desc limit 6) r), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.provider_dashboard(uuid) from public, anon;
grant execute on function public.provider_dashboard(uuid) to authenticated;
