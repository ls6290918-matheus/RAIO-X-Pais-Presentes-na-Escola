-- Testes das séries do painel administrativo. Roda por último.
\set ON_ERROR_STOP on
\set QUIET on

reset role;
create temp table t157 as select
  (select count(*) from public.orders where origin = 'marketplace' and status <> 'cancelado'
     and created_at >= (current_date - 6)::timestamp at time zone 'America/Sao_Paulo') as d7,
  (select count(*) from public.orders where origin = 'marketplace' and status <> 'cancelado'
     and created_at >= (current_date - 90)::timestamp at time zone 'America/Sao_Paulo') as d90;
grant select on t157 to authenticated;
set role authenticated;
select set_config('request.jwt.claim.sub', '14141414-0000-0000-0000-000000000014', false);
do $$
declare s jsonb; w jsonb;
begin
  s := public.admin_timeseries(current_date - 6, current_date);
  assert s ->> 'unit' = 'day' and jsonb_array_length(s -> 'points') = 7, 'T157 7 dias: ' || s::text;
  assert (select sum((x ->> 'orders')::int) from jsonb_array_elements(s -> 'points') x)
       = (select d7 from t157) and (select d7 from t157) > 0, 'T157 soma dos dias';
  w := public.admin_timeseries(current_date - 90, current_date);
  assert w ->> 'unit' = 'week' and jsonb_array_length(w -> 'points') between 13 and 15, 'T157 semanas';
  assert (select sum((x ->> 'orders')::int) from jsonb_array_elements(w -> 'points') x)
       = (select d90 from t157), 'T157 soma das semanas (sem contar fora do período)';
  assert (select count(*) from public.admin_recent_orders(current_date - 30, current_date)) > 0, 'T157 pedidos recentes';
end $$;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
do $$ begin
  begin perform public.admin_timeseries(current_date - 6, current_date); raise exception 'T157 FALHOU dono';
  exception when insufficient_privilege then null; end;
  begin perform public.admin_recent_orders(current_date - 6, current_date); raise exception 'T157 FALHOU dono pedidos';
  exception when insufficient_privilege then null; end;
  raise notice 'T157 OK  séries do painel (por dia até 31 dias, por semana acima) somam o período certo; pedidos recentes; só o admin';
end $$;
reset role;
