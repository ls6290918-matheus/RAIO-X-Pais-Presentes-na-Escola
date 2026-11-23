-- Fase 1 / Subetapa 1: idempotência na criação de pedidos. Roda por último.
-- (a concorrência real, com duas sessões ao mesmo tempo, está em tests/concorrencia/idempotencia.sh)
\set ON_ERROR_STOP on
\set QUIET on
reset role;
create temp table t180 (k text primary key, id uuid, n bigint);
insert into t180 (k, id) select 'biz', id from public.businesses where slug = 'lavanderia-do-joao';
insert into t180 (k, id) select 'other_biz', id from public.businesses where slug <> 'lavanderia-do-joao' limit 1;
insert into t180 (k, id) select 'svc', s.id from public.services s
  where s.business_id = (select id from t180 where k = 'biz') and s.active and s.pricing_unit = 'unidade' limit 1;
insert into t180 (k, id) select 'addr18', id from public.user_addresses where user_id = '18181818-0000-0000-0000-000000000018' limit 1;
insert into t180 (k, id) select 'addr17', id from public.user_addresses where user_id = '17171717-0000-0000-0000-000000000017' limit 1;
-- o cliente 1717 precisa de WhatsApp para contratar (só no banco de teste)
update public.profiles set phone = '21933332222' where id = '17171717-0000-0000-0000-000000000017' and phone is null;
-- retrato dos pedidos que já existiam (não podem mudar)
insert into t180 (k, n) select 'old_count', count(*) from public.orders;
create temp table t180_old as select id, md5(row(o.*)::text) as h from public.orders o;
insert into t180 (k, id) values ('k1', gen_random_uuid()), ('k2', gen_random_uuid()), ('kb', gen_random_uuid());
grant select, insert on t180 to authenticated;
set role authenticated;

-- T180: contratação direta: mesma chave devolve o pedido original; chave nova cria outro; sem chave continua como antes
select set_config('request.jwt.claim.sub', '18181818-0000-0000-0000-000000000018', false);
do $$
declare
  items jsonb := jsonb_build_array(jsonb_build_object('service_id', (select id from t180 where k = 'svc'), 'quantity', 1));
  o1 uuid; o2 uuid; o3 uuid; o4 uuid; o5 uuid;
begin
  o1 := public.hire_services((select id from t180 where k = 'biz'), items, (select id from t180 where k = 'addr18'), p_request_id => (select id from t180 where k = 'k1'));
  o2 := public.hire_services((select id from t180 where k = 'biz'), items, (select id from t180 where k = 'addr18'), p_request_id => (select id from t180 where k = 'k1'));
  assert o1 = o2, 'T180 repetição devolve o pedido original';
  assert (select count(*) from public.my_orders() where id = o1) = 1, 'T180 o cliente vê o pedido';
  -- repetição após "erro de rede" com outro conteúdo no corpo: a chave manda, nada novo é criado
  o2 := public.hire_services((select id from t180 where k = 'biz'), items || items, (select id from t180 where k = 'addr18'), p_request_id => (select id from t180 where k = 'k1'));
  assert o1 = o2, 'T180 nova tentativa com a mesma chave';
  o3 := public.hire_services((select id from t180 where k = 'biz'), items, (select id from t180 where k = 'addr18'), p_request_id => (select id from t180 where k = 'k2'));
  assert o3 <> o1, 'T180 nova contratação legítima cria outro pedido';
  -- chamada antiga (sem chave): continua criando um pedido por chamada
  o4 := public.hire_services((select id from t180 where k = 'biz'), items, (select id from t180 where k = 'addr18'));
  o5 := public.hire_services((select id from t180 where k = 'biz'), items, (select id from t180 where k = 'addr18'));
  assert o4 <> o5, 'T180 compatível com chamadas sem chave';
  insert into t180 (k, id) values ('o1', o1), ('o3', o3), ('o4', o4);
  -- a mesma chave não pode ser usada em outra lavanderia
  begin
    perform public.hire_services((select id from t180 where k = 'other_biz'), items, (select id from t180 where k = 'addr18'), p_request_id => (select id from t180 where k = 'k1'));
    raise exception 'T180 FALHOU chave reaproveitada em outra lavanderia';
  exception when invalid_parameter_value then null; end;
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.orders where client_request_id = (select id from t180 where k = 'k1')) = 1, 'T180 um pedido só por chave';
  assert (select client_request_id from public.orders where id = (select id from t180 where k = 'o4')) is null, 'T180 sem chave fica nulo';
  -- a chave fica no pedido, mas o pedido segue o fluxo normal (valor e livro-razão)
  assert (select total from public.orders where id = (select id from t180 where k = 'o1')) > 0, 'T180 valor do pedido';
  assert exists (select 1 from public.financial_ledger where order_id = (select id from t180 where k = 'o1') and event = 'pedido_marketplace'), 'T180 livro-razão normal';
end $$;
set role authenticated;
-- outro cliente usando a mesma chave cria o próprio pedido (a chave vale por usuário)
select set_config('request.jwt.claim.sub', '17171717-0000-0000-0000-000000000017', false);
do $$
declare o uuid;
begin
  o := public.hire_services((select id from t180 where k = 'biz'),
         jsonb_build_array(jsonb_build_object('service_id', (select id from t180 where k = 'svc'), 'quantity', 1)),
         (select id from t180 where k = 'addr17'), p_request_id => (select id from t180 where k = 'k1'));
  assert o <> (select id from t180 where k = 'o1'), 'T180 a chave vale por cliente';
  assert (select count(*) from public.my_orders() where id = o) = 1, 'T180 pedido do próprio cliente';
  assert (select count(*) from public.my_orders() where id = (select id from t180 where k = 'o1')) = 0, 'T180 não vê pedido do outro';
  raise notice 'T180 OK  contratação direta idempotente: repetição devolve o original, chave nova cria outro, sem chave como antes, chave vale por cliente';
end $$;

-- T181: pedido de balcão (create_order) com a mesma proteção
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
do $$
declare
  c uuid := (select id from public.customers where business_id = (select id from t180 where k = 'biz') limit 1);
  items jsonb := jsonb_build_array(jsonb_build_object('service_id', (select id from t180 where k = 'svc')));
  o1 uuid; o2 uuid; o3 uuid; o4 uuid;
begin
  o1 := public.create_order(c, items, p_request_id => (select id from t180 where k = 'kb'));
  o2 := public.create_order(c, items, p_request_id => (select id from t180 where k = 'kb'));
  assert o1 = o2, 'T181 balcão: repetição devolve o original';
  o3 := public.create_order(c, items, p_request_id => gen_random_uuid());
  assert o3 <> o1, 'T181 balcão: chave nova cria outro';
  o4 := public.create_order(c, items, null, null, 'retirada', true); -- chamada antiga, posicional
  assert (select status from public.orders where id = o4) = 'orcamento', 'T181 balcão: chamada antiga';
  raise notice 'T181 OK  pedido de balcão idempotente e compatível com as chamadas antigas';
end $$;

-- T182: pedidos que já existiam não mudaram; ninguém chama as funções internas
reset role;
do $$ begin
  assert not exists (select 1 from t180_old t join public.orders o on o.id = t.id where md5(row(o.*)::text) <> t.h), 'T182 pedidos antigos intactos';
  assert (select count(*) from public.orders o join t180_old t on t.id = o.id where o.client_request_id is not null) = 0, 'T182 antigos sem chave';
  assert not has_function_privilege('authenticated', 'public.lock_order_request(uuid)', 'execute'), 'T182 trava interna';
  assert not has_function_privilege('authenticated', 'public.order_for_request(uuid, uuid)', 'execute'), 'T182 busca interna';
  assert not has_function_privilege('anon', 'public.hire_services(uuid, jsonb, uuid, public.logistics_mode, public.payment_mode, text, uuid)', 'execute'), 'T182 visitante';
  raise notice 'T182 OK  pedidos existentes preservados; funções internas fechadas; visitante não contrata';
end $$;
