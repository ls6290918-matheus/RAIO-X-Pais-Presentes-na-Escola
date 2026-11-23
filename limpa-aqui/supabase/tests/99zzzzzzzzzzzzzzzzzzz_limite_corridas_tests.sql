-- Fase 1 / Subetapa 2: limite de corridas simultâneas por entregador. Roda por último.
-- (a concorrência real, com sessões ao mesmo tempo, está em tests/concorrencia/limite_corridas.sh)
\set ON_ERROR_STOP on
\set QUIET on
reset role;
create temp table t183 (k text primary key, id uuid);
-- entregadores 1919 e 2020 online e atendendo o mesmo município
insert into t183 (k, id) values ('e19', '19191919-0000-0000-0000-000000000019'), ('e21', '21212121-0000-0000-0000-000000000021');
update public.couriers set online = true, online_since = now() where user_id in (select id from t183);
-- nenhuma corrida antiga deles em andamento (ponto de partida limpo)
update public.deliveries set status = 'cancelada', canceled_at = now()
 where courier_id in (select id from t183) and status in ('aceita', 'coletada');
create temp table t183_mun as
  select a.municipality_id as id from public.courier_areas a
  where a.user_id = '19191919-0000-0000-0000-000000000019' and a.active
    and exists (select 1 from public.courier_areas b where b.user_id = '21212121-0000-0000-0000-000000000021' and b.municipality_id = a.municipality_id and b.active)
  limit 1;
-- pedidos sem corrida ativa para receber corridas novas
create temp table t183_orders as
  select o.id, o.business_id, row_number() over (order by o.created_at) as n
  from public.orders o
  where not exists (select 1 from public.deliveries d where d.order_id = o.id and d.status <> 'cancelada')
  limit 4;
-- d1..d4: coletas disponíveis em pedidos diferentes; d1r: devolução do mesmo pedido de d1
with ins as (
  insert into public.deliveries (order_id, business_id, leg, municipality_id, origin_label, origin_address, dest_label, dest_address,
                                 distance_km, delivery_fee, courier_earnings, status)
  select x.id, x.business_id, 'pickup', (select id from t183_mun), 'Cliente', 'Rua A, 1', 'Lavanderia', 'Rua B, 2', 3, 12, 10, 'disponivel'
  from t183_orders x
  returning id, order_id)
insert into t183 (k, id) select 'd' || x.n, ins.id from ins join t183_orders x on x.id = ins.order_id;
with ins as (
  insert into public.deliveries (order_id, business_id, leg, municipality_id, origin_label, origin_address, dest_label, dest_address,
                                 distance_km, delivery_fee, courier_earnings, status)
  select x.id, x.business_id, 'return', (select id from t183_mun), 'Lavanderia', 'Rua B, 2', 'Cliente', 'Rua A, 1', 3, 12, 10, 'disponivel'
  from t183_orders x where x.n = 1
  returning id)
insert into t183 (k, id) select 'd1r', id from ins;
grant select on t183 to authenticated;
set role authenticated;

-- T183: limite padrão de 1 corrida ativa; segunda é recusada; outro entregador pega normalmente
select set_config('request.jwt.claim.sub', '19191919-0000-0000-0000-000000000019', false);
do $$ declare s jsonb; begin
  perform public.accept_delivery((select id from t183 where k = 'd1'));
  begin
    perform public.accept_delivery((select id from t183 where k = 'd2'));
    raise exception 'T183 FALHOU aceitou a segunda corrida';
  exception when invalid_parameter_value then
    if sqlerrm <> 'Você já possui uma entrega em andamento. Conclua ou finalize essa entrega antes de aceitar outra.' then raise; end if;
  end;
  s := public.courier_summary();
  assert (s ->> 'active')::int = 1 and (s ->> 'max_active')::int = 1, 'T183 resumo mostra 1 de 1';
end $$;
select set_config('request.jwt.claim.sub', '21212121-0000-0000-0000-000000000021', false);
do $$ begin
  perform public.accept_delivery((select id from t183 where k = 'd2'));
  -- coleta e devolução do mesmo pedido são corridas independentes: outro entregador pode fazer a devolução
  begin
    perform public.accept_delivery((select id from t183 where k = 'd1r'));
    raise exception 'T183 FALHOU 2121 passou do limite';
  exception when invalid_parameter_value then null; end;
  raise notice 'T183 OK  limite de 1 corrida ativa por entregador; a segunda é recusada; entregadores diferentes pegam corridas diferentes';
end $$;

-- T184: concluir, desistir ou ter a corrida cancelada libera a vaga; coleta e devolução seguem independentes
select set_config('request.jwt.claim.sub', '19191919-0000-0000-0000-000000000019', false);
do $$ declare d uuid := (select id from t183 where k = 'd1'); begin
  perform public.delivery_pickup(d, 2, 'ok', d::text || '/foto-coleta-0184.jpg');
  begin
    perform public.accept_delivery((select id from t183 where k = 'd3'));
    raise exception 'T184 FALHOU coletada ainda conta como ativa';
  exception when invalid_parameter_value then null; end;
  perform public.delivery_dropoff(d, null, 2, 'ok', d::text || '/foto-entrega-0184.jpg', 'Recebido no balcão', true);
  -- concluída: a vaga volta; ele pode pegar a devolução do mesmo pedido (corrida independente)
  perform public.accept_delivery((select id from t183 where k = 'd1r'));
end $$;
select set_config('request.jwt.claim.sub', '21212121-0000-0000-0000-000000000021', false);
do $$ begin
  perform public.release_delivery((select id from t183 where k = 'd2')); -- desistiu: libera
  perform public.accept_delivery((select id from t183 where k = 'd3'));
end $$;
reset role;
update public.deliveries set status = 'cancelada', canceled_at = now() where id = (select id from t183 where k = 'd3'); -- cancelada pela operação
set role authenticated;
select set_config('request.jwt.claim.sub', '21212121-0000-0000-0000-000000000021', false);
do $$ begin
  perform public.accept_delivery((select id from t183 where k = 'd4'));
  assert (public.courier_summary() ->> 'active')::int = 1, 'T184 só a nova conta';
  raise notice 'T184 OK  concluir, desistir e cancelamento liberam a vaga; coletada ainda conta; coleta e devolução independentes';
end $$;

-- T185: o admin ajusta o limite (1 a 5), fica na auditoria; mais ninguém mexe
select set_config('request.jwt.claim.sub', '21212121-0000-0000-0000-000000000021', false);
do $$ begin
  begin perform public.admin_set_max_active_deliveries(3); raise exception 'T185 FALHOU entregador mudou o limite';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub', '14141414-0000-0000-0000-000000000014', false);
do $$ begin
  begin perform public.admin_set_max_active_deliveries(9); raise exception 'T185 FALHOU aceitou 9';
  exception when invalid_parameter_value then null; end;
  perform public.admin_set_max_active_deliveries(2);
  assert (public.admin_logistics_settings() ->> 'max_active_deliveries')::int = 2, 'T185 limite 2';
  assert exists (select 1 from public.admin_audit_logs('platform_settings') where changes ? 'max_active_deliveries'), 'T185 auditado';
end $$;
select set_config('request.jwt.claim.sub', '21212121-0000-0000-0000-000000000021', false);
do $$ begin
  perform public.accept_delivery((select id from t183 where k = 'd2')); -- agora pode ter 2
  assert (public.courier_summary() ->> 'active')::int = 2 and (public.courier_summary() ->> 'max_active')::int = 2, 'T185 2 de 2';
end $$;
select set_config('request.jwt.claim.sub', '14141414-0000-0000-0000-000000000014', false);
select public.admin_set_max_active_deliveries(1);
do $$ begin
  raise notice 'T185 OK  admin ajusta o limite de 1 a 5 (auditado); entregador não muda; limite maior permite mais corridas';
end $$;
reset role;
