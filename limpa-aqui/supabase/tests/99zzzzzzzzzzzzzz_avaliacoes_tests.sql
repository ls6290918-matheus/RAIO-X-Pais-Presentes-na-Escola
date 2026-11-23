-- Avaliações (PRD Fase 3). Roda por último.
\set ON_ERROR_STOP on
\set QUIET on
reset role;
create temp table t168 (k text primary key, id uuid);
insert into t168 select 'done', o.id from public.orders o
  where o.client_user_id = '18181818-0000-0000-0000-000000000018' and o.status = 'entregue'
    and (select count(*) from public.deliveries d where d.order_id = o.id and d.status = 'entregue') >= 1 limit 1;
insert into t168 select 'open', o.id from public.orders o where o.client_user_id = '18181818-0000-0000-0000-000000000018' and o.status = 'recebido' limit 1;
insert into t168 select 'deliv', d.id from public.deliveries d where d.order_id = (select id from t168 where k = 'done') and d.status = 'entregue' limit 1;
grant select on t168 to authenticated;
set role authenticated;

-- T168: cliente avalia lavanderia (pedido entregue) e entregador (corrida entregue); 1 por pedido/corrida; corrige em 7 dias
select set_config('request.jwt.claim.sub', '18181818-0000-0000-0000-000000000018', false);
do $$ declare r1 uuid; r2 uuid; st record; begin
  select * into st from public.my_review_status(array[(select id from t168 where k = 'done')]);
  assert st.can_review_provider and st.provider_rating is null and jsonb_array_length(st.deliveries) >= 1, 'T168 status antes';
  begin perform public.submit_review((select id from t168 where k = 'open'), 5); raise exception 'T168 FALHOU pedido aberto';
  exception when invalid_parameter_value then null; end;
  begin perform public.submit_review((select id from t168 where k = 'done'), 6); raise exception 'T168 FALHOU nota 6';
  exception when invalid_parameter_value then null; end;
  r1 := public.submit_review((select id from t168 where k = 'done'), 4, 'Tênis voltaram ótimos', 5, 4, 4);
  r2 := public.submit_review((select id from t168 where k = 'done'), 5, 'Mudei de ideia: perfeito!');
  assert r1 = r2, 'T168 corrige a mesma avaliação';
  perform public.submit_review((select id from t168 where k = 'done'), 5, 'Entregador pontual', null, 5, null, (select id from t168 where k = 'deliv'));
  select * into st from public.my_review_status(array[(select id from t168 where k = 'done')]);
  assert st.provider_rating = 5 and (st.deliveries -> 0 ->> 'rating') is not null, 'T168 status depois';
  begin perform 1 from public.reviews; raise exception 'T168 FALHOU tabela direta';
  exception when insufficient_privilege then null; end;
end $$;
-- outra pessoa não avalia
select set_config('request.jwt.claim.sub', '17171717-0000-0000-0000-000000000017', false);
do $$ begin
  begin perform public.submit_review((select id from t168 where k = 'done'), 1, 'Ruim'); raise exception 'T168 FALHOU estranho';
  exception when insufficient_privilege then null; end;
end $$;
-- público vê média e comentários (só primeiro nome)
reset role; set role anon;
do $$ begin
  assert (select rating from public.provider_ratings(array['lavanderia-do-joao'])) = 5, 'T168 média pública';
  assert (select count(*) from public.public_reviews('lavanderia-do-joao') where comment like 'Mudei%') = 1, 'T168 comentário público';
end $$;
reset role; set role authenticated;
-- dono responde; equipe vê painel; outro dono não
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
do $$ declare b uuid := (select business_id from public.orders where id = (select id from t168 where k = 'done')); r uuid; begin
  assert (public.business_reviews(b) -> 'summary' ->> 'count')::int >= 1, 'T168 painel';
  select (x ->> 'id')::uuid into r from jsonb_array_elements(public.business_reviews(b) -> 'items') x limit 1;
  perform public.reply_review(r, 'Obrigado, Bia!');
  assert exists (select 1 from public.public_reviews('lavanderia-do-joao') where reply = 'Obrigado, Bia!'), 'T168 resposta pública';
end $$;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', false);
do $$ begin
  begin perform public.business_reviews((select business_id from public.orders where id = (select id from t168 where k = 'done'))); raise exception 'T168 FALHOU outro dono painel';
  exception when insufficient_privilege then null; end;
  raise notice 'T168 OK  avaliações: cliente avalia lavanderia e entregador depois de entregue, corrige; média e comentários públicos; dono responde; só participantes';
end $$;
reset role;
