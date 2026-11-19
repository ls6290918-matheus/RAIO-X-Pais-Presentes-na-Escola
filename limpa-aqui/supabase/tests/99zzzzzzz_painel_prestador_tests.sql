-- Testes do painel financeiro do prestador. Roda por último.
\set ON_ERROR_STOP on
\set QUIET on

reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
do $$
declare d jsonb; b uuid := (select id from public.businesses where slug = 'lavanderia-do-joao');
begin
  d := public.provider_dashboard(b);
  assert (d -> 'month' ->> 'revenue')::numeric = (select coalesce(sum(total), 0) from public.orders
           where business_id = b and status not in ('cancelado', 'orcamento') and received_at >= date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'),
         'T156 faturamento do mês: ' || (d -> 'month')::text;
  assert (d -> 'month' ->> 'revenue')::numeric = (d -> 'month' ->> 'received')::numeric + (d -> 'month' ->> 'to_receive')::numeric, 'T156 recebido + a receber';
  assert (d -> 'month' ->> 'orders')::int > 0 and (d -> 'month' ->> 'avg_ticket')::numeric > 0, 'T156 pedidos e ticket';
  assert jsonb_array_length(d -> 'weekly') = 8, 'T156 8 semanas';
  assert (d ->> 'year_revenue')::numeric >= (d -> 'month' ->> 'revenue')::numeric, 'T156 ano >= mês';
  assert jsonb_array_length(d -> 'recent') between 1 and 6, 'T156 últimos pedidos';
end $$;
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000004', false);
do $$ begin
  begin perform public.provider_dashboard((select id from public.businesses where slug = 'lavanderia-do-joao')); raise exception 'T156 FALHOU funcionário';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', false);
do $$ begin
  begin perform public.provider_dashboard((select id from public.businesses where slug = 'lavanderia-do-joao')); raise exception 'T156 FALHOU outra lavanderia';
  exception when insufficient_privilege then null; end;
  raise notice 'T156 OK  painel financeiro do prestador: faturamento, recebido e a receber do mês, 8 semanas, ano e últimos pedidos; só o dono vê';
end $$;
reset role;
