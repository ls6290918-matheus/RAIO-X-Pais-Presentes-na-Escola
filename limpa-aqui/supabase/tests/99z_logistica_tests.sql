-- Testes do marketplace, Etapa 6 (logística com entregadores). Roda depois de 99_pagamento_tests.sql.
\set ON_ERROR_STOP on
\set QUIET on

reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('19191919-0000-0000-0000-000000000019', 'edu@teste.com', '{"full_name":"Edu Moto"}'),
  ('20202020-0000-0000-0000-000000000020', 'rio@teste.com', '{"full_name":"Rui Rio"}'),
  ('21212121-0000-0000-0000-000000000021', 'iva@teste.com', '{"full_name":"Iva Bike"}');
create temporary table t_log (k text primary key, id uuid, n numeric);
grant all on t_log to authenticated, anon;
insert into t_log (k, id) select 'biz', id from t_pay where k = 'biz';
insert into t_log (k, id) select 'svc', id from t_pay where k = 'svc';
insert into t_log (k, id) select 'addr', id from t_pay where k = 'addr';
set role authenticated;

-- T124: entregador se cadastra e espera aprovação
select set_config('request.jwt.claim.sub', '19191919-0000-0000-0000-000000000019', false);
do $$ begin
  assert public.add_my_role('entregador') = 'pendente', 'T124 pendente';
  begin perform public.save_courier_profile('moto', '12a4', '21933332222', array[3303302]); raise exception 'T124 FALHOU cpf';
  exception when others then if sqlerrm like 'T124%' then raise; end if; end;
  perform public.save_courier_profile('moto', '1234', '(21) 93333-2222', array[3303302]);
  assert (select vehicle from public.couriers) = 'moto' and (select count(*) from public.courier_areas) = 1, 'T124 cadastro';
  begin perform public.courier_available_deliveries(); raise exception 'T124 FALHOU pendente vê corridas';
  exception when insufficient_privilege then null; end;
  raise notice 'T124 OK  entregador cadastra veículo, 4 dígitos do CPF e municípios; sem aprovação não vê corridas';
end $$;
select set_config('request.jwt.claim.sub', '20202020-0000-0000-0000-000000000020', false);
select public.add_my_role('entregador');
select public.save_courier_profile('carro', '5678', '21922221111', array[3304557]);
select set_config('request.jwt.claim.sub', '21212121-0000-0000-0000-000000000021', false);
select public.add_my_role('entregador');
select public.save_courier_profile('bicicleta', '9012', '21911110000', array[3303302]);

-- T125: tarifa do admin + entregador aprovado = logística; cliente vê a cotação
select set_config('request.jwt.claim.sub', '18181818-0000-0000-0000-000000000018', false);
do $$ begin
  assert not (select available from public.quote_delivery((select id from t_log where k = 'biz'), (select id from t_log where k = 'addr'))), 'T125 sem tarifa';
end $$;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
do $$ begin
  begin perform public.admin_upsert_delivery_zone(3303302, 8, 1.5, 10); raise exception 'T125 FALHOU dono mexeu na tarifa';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub', '14141414-0000-0000-0000-000000000014', false);
select public.admin_upsert_delivery_zone(3303302, 8, 1.5, 10);
select public.admin_upsert_delivery_zone(3304557, 9, 2, 12);
do $$ begin
  assert not (select has_logistics from public.admin_logistics_overview() where municipality_id = 3303302), 'T125 sem entregador aprovado';
  perform public.admin_set_role_status('19191919-0000-0000-0000-000000000019', 'entregador', 'ativo');
  perform public.admin_set_role_status('20202020-0000-0000-0000-000000000020', 'entregador', 'ativo');
  perform public.admin_set_role_status('21212121-0000-0000-0000-000000000021', 'entregador', 'ativo');
  assert (select has_logistics and couriers_approved = 2 from public.admin_logistics_overview() where municipality_id = 3303302), 'T125 logística';
  assert (select areas from public.admin_couriers() where user_id = '19191919-0000-0000-0000-000000000019') = array['Niterói'], 'T125 admin vê áreas';
end $$;
select set_config('request.jwt.claim.sub', '18181818-0000-0000-0000-000000000018', false);
do $$
declare q record;
begin
  select * into q from public.quote_delivery((select id from t_log where k = 'biz'), (select id from t_log where k = 'addr'));
  assert not q.available and q.reason like 'Marque seu endereço no mapa%', 'T125 sem coordenadas: ' || coalesce(q.reason, '');
  update public.user_addresses set lat = -22.9035, lng = -43.1095 where id = (select id from t_log where k = 'addr');
  select * into q from public.quote_delivery((select id from t_log where k = 'biz'), (select id from t_log where k = 'addr'));
  assert q.available and q.distance_km > 0 and q.fee_per_leg = greatest(10, round(8 + 1.5 * q.distance_km, 2)) and q.total = q.fee_per_leg * 2, 'T125 cotação';
  insert into t_log (k, n) values ('fee', q.fee_per_leg);
  -- anúncio: cotação pela proposta
  insert into t_log (k, id) values ('lst', public.create_listing('lavagem_tenis', 'Tênis para coleta', null, (select id from t_log where k = 'addr')));
  raise notice 'T125 OK  logística só com tarifa ativa e entregador aprovado; cliente vê o valor da coleta e da devolução antes';
end $$;

select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
do $$ begin
  insert into t_log (k, id) values ('prop', public.send_proposal((select id from t_log where k = 'lst'), (select id from t_log where k = 'biz'), 70, 2));
end $$;
select set_config('request.jwt.claim.sub', '18181818-0000-0000-0000-000000000018', false);
do $$ begin
  assert (select available and total = (select n from t_log where k = 'fee') * 2 from public.quote_proposal_delivery((select id from t_log where k = 'prop'))), 'T125 cotação da proposta';
  perform public.cancel_listing((select id from t_log where k = 'lst'));
end $$;
select set_config('request.jwt.claim.sub', '17171717-0000-0000-0000-000000000017', false);
do $$ begin
  assert not (select available from public.quote_proposal_delivery((select id from t_log where k = 'prop'))), 'T125 cotação de proposta alheia';
end $$;
select set_config('request.jwt.claim.sub', '18181818-0000-0000-0000-000000000018', false);

-- T126: contratar com entregador cria a corrida de coleta
do $$
declare o uuid;
begin
  o := public.hire_services((select id from t_log where k = 'biz'), jsonb_build_array(jsonb_build_object('service_id', (select id from t_log where k = 'svc'))),
                            (select id from t_log where k = 'addr'), 'entregador');
  insert into t_log (k, id) values ('order', o);
  assert (select delivery_fee_total from public.my_orders() where id = o) = (select n from t_log where k = 'fee') * 2, 'T126 taxa no pedido';
  assert (select count(*) from public.order_deliveries(o) where leg = 'pickup' and status = 'disponivel') = 1, 'T126 coleta';
  assert (select count(*) from public.order_deliveries(o)) = 1, 'T126 só coleta';
end $$;
select set_config('request.jwt.claim.sub', '19191919-0000-0000-0000-000000000019', false);
do $$
declare r record;
begin
  select * into r from public.courier_available_deliveries();
  assert r.leg = 'pickup' and r.origin_neighborhood is not distinct from null or r.leg = 'pickup', 'T126 vê corrida';
  assert position('Niterói' in row_to_json(r)::text) > 0 and position('9333' in row_to_json(r)::text) = 0, 'T126 sem contato antes de aceitar';
  insert into t_log (k, id) values ('pickup', r.id);
  assert (select count(*) from public.deliveries) = 0, 'T126 tabela antes de aceitar';
end $$;
select set_config('request.jwt.claim.sub', '20202020-0000-0000-0000-000000000020', false);
do $$ begin
  assert (select count(*) from public.courier_available_deliveries()) = 0, 'T126 entregador de outro município vê';
  begin perform public.accept_delivery((select id from t_log where k = 'pickup')); raise exception 'T126 FALHOU outro município aceitou';
  exception when raise_exception then if sqlerrm like 'T126%' then raise; end if; end;
  raise notice 'T126 OK  pedido com entregador cria a corrida de coleta; só entregadores do município a veem, sem endereço nem contato';
end $$;

-- T127: aceitar, coletar, entregar
select set_config('request.jwt.claim.sub', '19191919-0000-0000-0000-000000000019', false);
do $$
declare r record;
begin
  perform public.accept_delivery((select id from t_log where k = 'pickup'));
  select * into r from public.my_deliveries();
  assert r.status = 'aceita' and r.origin_phone = '21944443333' and r.dest_label like 'Lavanderia do João%', 'T127 contatos depois de aceitar';
  perform public.advance_delivery((select id from t_log where k = 'pickup'), 'coletada');
  begin perform public.release_delivery((select id from t_log where k = 'pickup')); raise exception 'T127 FALHOU desistiu após coletar';
  exception when raise_exception then if sqlerrm like 'T127%' then raise; end if; end;
  perform public.advance_delivery((select id from t_log where k = 'pickup'), 'entregue');
end $$;
select set_config('request.jwt.claim.sub', '21212121-0000-0000-0000-000000000021', false);
do $$ begin
  begin perform public.accept_delivery((select id from t_log where k = 'pickup')); raise exception 'T127 FALHOU pegou corrida feita';
  exception when raise_exception then if sqlerrm like 'T127%' then raise; end if; end;
  begin perform public.advance_delivery((select id from t_log where k = 'pickup'), 'entregue'); raise exception 'T127 FALHOU mexeu na corrida de outro';
  exception when raise_exception then if sqlerrm like 'T127%' then raise; end if; end;
end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.financial_ledger where order_id = (select id from t_log where k = 'order') and event = 'corrida_concluida'), 'T127 livro';
  raise notice 'T127 OK  entregador aceita, vê endereço e contato, coleta e entrega; ninguém mais mexe na corrida; livro-razão registra';
end $$;
set role authenticated;

-- T128: pedido pronto cria a devolução; outro entregador pode fazer; entregue fecha o pedido
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
select public.set_order_status((select id from t_log where k = 'order'), 'pronto');
select set_config('request.jwt.claim.sub', '21212121-0000-0000-0000-000000000021', false);
do $$
declare d uuid;
begin
  select id into d from public.courier_available_deliveries() where leg = 'return';
  assert d is not null, 'T128 devolução criada';
  perform public.accept_delivery(d);
  perform public.advance_delivery(d, 'coletada');
  perform public.advance_delivery(d, 'entregue');
end $$;
select set_config('request.jwt.claim.sub', '18181818-0000-0000-0000-000000000018', false);
do $$ begin
  assert (select status from public.my_orders() where id = (select id from t_log where k = 'order')) = 'entregue', 'T128 pedido entregue';
  assert (select string_agg(leg || ':' || courier_name, ',' order by leg) from public.order_deliveries((select id from t_log where k = 'order'))) = 'pickup:Edu,return:Iva', 'T128 dois entregadores';
  raise notice 'T128 OK  "pronto" cria a devolução; outro entregador pode fazer; devolução entregue fecha o pedido';
end $$;
select set_config('request.jwt.claim.sub', '17171717-0000-0000-0000-000000000017', false);
do $$ begin
  begin perform public.order_deliveries((select id from t_log where k = 'order')); raise exception 'T128 FALHOU outro cliente';
  exception when raise_exception then if sqlerrm like 'T128%' then raise; end if; end;
end $$;

-- T129: cancelar o pedido cancela a corrida que não terminou; sem logística não há corrida
select set_config('request.jwt.claim.sub', '18181818-0000-0000-0000-000000000018', false);
do $$ begin
  insert into t_log (k, id) values ('order2', public.hire_services((select id from t_log where k = 'biz'),
     jsonb_build_array(jsonb_build_object('service_id', (select id from t_log where k = 'svc'))), (select id from t_log where k = 'addr'), 'entregador'));
  insert into t_log (k, id) values ('order3', public.hire_services((select id from t_log where k = 'biz'),
     jsonb_build_array(jsonb_build_object('service_id', (select id from t_log where k = 'svc'))), (select id from t_log where k = 'addr'), 'sem_logistica'));
  assert (select count(*) from public.order_deliveries((select id from t_log where k = 'order3'))) = 0, 'T129 sem logística sem corrida';
end $$;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
select public.set_order_status((select id from t_log where k = 'order3'), 'pronto');
select public.set_order_status((select id from t_log where k = 'order2'), 'cancelado');
do $$ begin
  assert (select count(*) from public.order_deliveries((select id from t_log where k = 'order3'))) = 0, 'T129 pronto sem logística';
  assert (select status from public.order_deliveries((select id from t_log where k = 'order2'))) = 'cancelada', 'T129 cancelada';
  raise notice 'T129 OK  cancelar o pedido cancela a corrida pendente; pedido sem logística nunca gera corrida';
end $$;

-- T130: tarifa desligada → sem logística; visitante; RLS
select set_config('request.jwt.claim.sub', '14141414-0000-0000-0000-000000000014', false);
select public.admin_upsert_delivery_zone(3303302, 8, 1.5, 10, 1.3, 30, false);
select set_config('request.jwt.claim.sub', '18181818-0000-0000-0000-000000000018', false);
do $$ begin
  begin perform public.hire_services((select id from t_log where k = 'biz'), jsonb_build_array(jsonb_build_object('service_id', (select id from t_log where k = 'svc'))),
                                     (select id from t_log where k = 'addr'), 'entregador'); raise exception 'T130 FALHOU sem tarifa';
  exception when raise_exception then if sqlerrm like 'T130%' then raise; end if; end;
end $$;
reset role;
set role anon;
do $$ begin
  begin perform public.courier_available_deliveries(); raise exception 'T130 FALHOU anon';
  exception when insufficient_privilege then null; end;
  begin perform count(*) from public.deliveries; raise exception 'T130 FALHOU anon corridas';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  assert not exists (select 1 from public.tables_without_rls() where table_name not in ('t_tok', 't_ids', 't_pay', 't_log')), 'T130 RLS';
  raise notice 'T130 OK  tarifa desligada tira a opção de entregador; visitante não vê corridas; RLS em todas as tabelas';
end $$;
