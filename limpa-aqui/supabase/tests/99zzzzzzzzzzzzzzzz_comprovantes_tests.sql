-- Comprovantes por corrida: foto, quantidade, estado e código de quem recebe. Roda por último.
\set ON_ERROR_STOP on
\set QUIET on
reset role;
create temp table t173 (k text primary key, id uuid, code text);
insert into t173 (k, id) select 'order', id from t169 where k = 'open';
with d as (
  insert into public.deliveries (order_id, business_id, leg, municipality_id, courier_id, origin_label, origin_address,
                                 dest_label, dest_address, distance_km, delivery_fee, courier_earnings, status, accepted_at)
  select o.id, o.business_id, 'pickup', x.municipality_id, '19191919-0000-0000-0000-000000000019', 'Casa do cliente', 'Rua A, 1',
         'Lavanderia', 'Rua B, 2', 3, 12, 10, 'aceita', now()
  from public.orders o, lateral (select municipality_id from public.deliveries limit 1) x
  where o.id = (select id from t173 where k = 'order')
  returning id, handoff_code)
insert into t173 select 'pick', id, handoff_code from d;
with d as (
  insert into public.deliveries (order_id, business_id, leg, municipality_id, courier_id, origin_label, origin_address,
                                 dest_label, dest_address, distance_km, delivery_fee, courier_earnings, status, accepted_at, picked_at)
  select o.id, o.business_id, 'return', x.municipality_id, '19191919-0000-0000-0000-000000000019', 'Lavanderia', 'Rua B, 2',
         'Casa do cliente', 'Rua A, 1', 3, 12, 10, 'coletada', now(), now()
  from public.orders o, lateral (select municipality_id from public.deliveries limit 1) x
  where o.id = (select id from t173 where k = 'order')
  returning id, handoff_code)
insert into t173 select 'ret', id, handoff_code from d;
grant select on t173 to authenticated;
set role authenticated;

-- T173: coleta exige foto, quantidade e estado; "Coletei" direto não existe mais; ninguém lê o código pela tabela
select set_config('request.jwt.claim.sub', '19191919-0000-0000-0000-000000000019', false);
do $$ declare d uuid := (select id from t173 where k = 'pick'); begin
  begin perform public.delivery_pickup(d, 4, 'ok', 'outra/foto.jpg'); raise exception 'T173 FALHOU sem foto válida';
  exception when invalid_parameter_value then null; end;
  begin perform public.delivery_pickup(d, 4, 'avaria', d::text || '/foto-coleta-0002.jpg'); raise exception 'T173 FALHOU avaria sem descrição';
  exception when invalid_parameter_value then null; end;
  begin perform public.advance_delivery(d, 'coletada'); raise exception 'T173 FALHOU avanço direto';
  exception when raise_exception then if sqlerrm like 'T173%' then raise; end if; end;
  perform public.delivery_pickup(d, 4, 'ok', d::text || '/foto-coleta-0002.jpg');
  assert (select status from public.deliveries where id = d) = 'coletada', 'T173 coletada';
  begin perform handoff_code from public.deliveries where id = d; raise exception 'T173 FALHOU leu o código';
  exception when insufficient_privilege then null; end;
  assert not exists (select 1 from public.delivery_handoff_codes((select id from t173 where k = 'order'))), 'T173 entregador não vê código';
end $$;
-- coleta (cliente → lavanderia): o código aparece para a lavanderia; devolução: para o cliente
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
do $$ begin
  assert (select string_agg(leg::text, ',') from public.delivery_handoff_codes((select id from t173 where k = 'order'))) = 'pickup', 'T173 lavanderia vê o da coleta';
  assert (select code from public.delivery_handoff_codes((select id from t173 where k = 'order'))) = (select code from t173 where k = 'pick'), 'T173 código certo';
end $$;
select set_config('request.jwt.claim.sub', '18181818-0000-0000-0000-000000000018', false);
do $$ begin
  assert (select string_agg(leg::text, ',') from public.delivery_handoff_codes((select id from t173 where k = 'order'))) = 'return', 'T173 cliente vê o da devolução';
  raise notice 'T173 OK  coleta só com foto, quantidade e estado; código de 4 dígitos só para quem recebe, nunca para o entregador';
end $$;

-- T174: entrega com o código; código errado conta tentativa; quantidade diferente avisa lavanderia e cliente
select set_config('request.jwt.claim.sub', '19191919-0000-0000-0000-000000000019', false);
do $$ declare d uuid := (select id from t173 where k = 'pick'); r jsonb; begin
  r := public.delivery_dropoff(d, case when (select code from t173 where k = 'pick') = '0000' then '1111' else '0000' end, 3, 'ok');
  assert not (r ->> 'ok')::boolean and (r ->> 'remaining')::int = 4, 'T174 código errado';
  r := public.delivery_dropoff(d, (select code from t173 where k = 'pick'), 3, 'ok');
  assert (r ->> 'ok')::boolean, 'T174 código certo';
  assert (select status from public.deliveries where id = d) = 'entregue', 'T174 entregue';
end $$;
select set_config('request.jwt.claim.sub', '18181818-0000-0000-0000-000000000018', false);
do $$ begin
  assert (select count(*) from public.delivery_proofs_for(array[(select id from t173 where k = 'pick')])) = 2, 'T174 cliente vê os comprovantes';
  assert (select code_verified from public.delivery_proofs_for(array[(select id from t173 where k = 'pick')]) where stage = 'entrega'), 'T174 código conferido';
  assert exists (select 1 from public.notifications where user_id = auth.uid() and kind = 'corrida_alerta'), 'T174 cliente avisado da divergência';
end $$;
select set_config('request.jwt.claim.sub', '17171717-0000-0000-0000-000000000017', false);
do $$ begin
  assert (select count(*) from public.delivery_proofs_for(array[(select id from t173 where k = 'pick')])) = 0, 'T174 estranho não vê';
  raise notice 'T174 OK  entrega com o código de quem recebe; erro conta tentativa; divergência de quantidade avisa as partes; comprovantes só para participantes';
end $$;

-- T175: 5 erros bloqueiam o código; sem código exige foto e explicação e fica marcado
select set_config('request.jwt.claim.sub', '19191919-0000-0000-0000-000000000019', false);
do $$ declare d uuid := (select id from t173 where k = 'ret'); w text; r jsonb; begin
  w := case when (select code from t173 where k = 'ret') = '0000' then '1111' else '0000' end;
  for i in 1..5 loop r := public.delivery_dropoff(d, w, 4, 'ok'); end loop;
  r := public.delivery_dropoff(d, (select code from t173 where k = 'ret'), 4, 'ok');
  assert not (r ->> 'ok')::boolean and (r ->> 'remaining')::int = 0, 'T175 bloqueado após 5 erros';
  begin perform public.delivery_dropoff(d, null, 4, 'ok', null, 'Porteiro recebeu', true); raise exception 'T175 FALHOU sem foto';
  exception when invalid_parameter_value then null; end;
  r := public.delivery_dropoff(d, null, 4, 'ok', d::text || '/foto-entrega-0003.jpg', 'Porteiro do prédio recebeu', true);
  assert (r ->> 'ok')::boolean, 'T175 sem código com foto';
end $$;
reset role;
do $$ begin
  assert (select code_verified from public.delivery_proofs where delivery_id = (select id from t173 where k = 'ret') and stage = 'entrega') = false, 'T175 marcado sem código';
  assert exists (select 1 from public.order_status_history where order_id = (select id from t173 where k = 'order') and event = 'entrega_sem_codigo'), 'T175 histórico';
  raise notice 'T175 OK  5 tentativas erradas bloqueiam o código; entrega sem código só com foto e explicação, marcada no histórico';
end $$;
