-- Etapa 6: agenda do prestador. Roda por último.
\set ON_ERROR_STOP on
\set QUIET on
reset role;
create temp table t167 as
  select o.business_id, count(*) filter (where o.due_date between current_date - 3 and current_date + 10 and o.status not in ('cancelado','orcamento')) as n
  from public.orders o join public.business_members bm on bm.business_id = o.business_id
  where bm.user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and bm.role = 'owner'
  group by o.business_id order by 2 desc limit 1;
grant select on t167 to authenticated;
set role authenticated;
-- T167: agenda por dia (pedidos e capacidade); só a equipe vê; período limitado
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
do $$ declare a jsonb; b uuid := (select business_id from t167); begin
  a := public.provider_agenda(b, current_date - 3, current_date + 10);
  assert jsonb_array_length(a -> 'days') = 14, 'T167 14 dias';
  assert (select sum((d ->> 'count')::int) from jsonb_array_elements(a -> 'days') d) = (select n from t167), 'T167 soma dos dias';
  assert (a -> 'orders') is not null, 'T167 pedidos';
  begin perform public.provider_agenda(b, current_date, current_date + 60); raise exception 'T167 FALHOU período';
  exception when invalid_parameter_value then null; end;
end $$;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', false);
do $$ begin
  begin perform public.provider_agenda((select business_id from t167), current_date, current_date + 7); raise exception 'T167 FALHOU outra lavanderia';
  exception when insufficient_privilege then null; end;
  raise notice 'T167 OK  agenda do prestador: pedidos por dia de entrega, capacidade e atrasados; só a equipe da lavanderia';
end $$;
reset role;
