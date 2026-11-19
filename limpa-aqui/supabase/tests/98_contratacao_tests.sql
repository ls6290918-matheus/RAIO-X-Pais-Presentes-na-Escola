-- Testes do marketplace, Etapa 4 (anúncios, propostas e contratação). Roda depois de 97_marketplace_tests.sql.
\set ON_ERROR_STOP on
\set QUIET on

-- Preparação: Niterói volta a ter operação ativa; João volta para a busca
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '14141414-0000-0000-0000-000000000014', false);
select public.admin_set_municipality_status(3303302, 'ativo');
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
select public.set_marketplace_visible((select id from public.businesses where slug = 'lavanderia-do-joao'), true);
reset role;
create temporary table t_ids (k text primary key, id uuid);
grant all on t_ids to authenticated, anon;
set role authenticated;

-- T108: cliente publica anúncio; quem não tem perfil de cliente não publica
select set_config('request.jwt.claim.sub', '16161616-0000-0000-0000-000000000016', false);
do $$
declare a uuid; l uuid;
begin
  select id into a from public.user_addresses where label = 'Casa';
  l := public.create_listing('lavagem_tenis', 'Lavar 3 pares de tênis brancos', 'Estão bem sujos de barro.', a, true);
  insert into t_ids values ('listing', l), ('addr', a);
  assert (select municipality_id from public.listings where id = l) = 3303302, 'T108 município';
  assert (select count(*) from public.my_listings()) = 1, 'T108 meus anúncios';
  raise notice 'T108 OK  cliente publica anúncio no município do endereço';
end $$;
select set_config('request.jwt.claim.sub', '17171717-0000-0000-0000-000000000017', false);
do $$ begin
  begin perform public.create_listing('lavagem_tenis', 'Quero lavar tênis', null, (select id from t_ids where k = 'addr')); raise exception 'T108 FALHOU sem perfil';
  exception when insufficient_privilege then null; end;
  assert (select count(*) from public.listings) = 0, 'T108 outro cliente vê anúncio';
  begin insert into public.listings (user_id, category_code, title, municipality_id) values (auth.uid(), 'outros', 'Anúncio direto', 3303302); raise exception 'T108 FALHOU insert';
  exception when insufficient_privilege then null; end;
end $$;

-- T109: prestadores que atendem Niterói veem a oportunidade sem o endereço exato
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
do $$
declare r record;
begin
  select * into r from public.provider_open_listings((select id from public.businesses where slug = 'lavanderia-do-joao'));
  assert r.title = 'Lavar 3 pares de tênis brancos' and r.neighborhood = 'Icaraí' and r.municipality_name = 'Niterói', 'T109 oportunidade';
  assert position('Gavião' in row_to_json(r)::text) = 0, 'T109 rua vazou';
  assert (select count(*) from public.listings) = 0, 'T109 prestador lê tabela de anúncios';
  raise notice 'T109 OK  prestador da região vê a oportunidade só com bairro e município';
end $$;
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000004', false);
do $$ begin
  begin perform public.provider_open_listings((select id from public.businesses where slug = 'lavanderia-do-joao')); raise exception 'T109 FALHOU funcionário';
  exception when insufficient_privilege then null; end;
end $$;

-- T110: propostas
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
do $$
declare p uuid;
begin
  p := public.send_proposal((select id from t_ids where k = 'listing'), (select id from public.businesses where slug = 'lavanderia-do-joao'),
                            95, 3, 'Busco aí amanhã.', true);
  p := public.send_proposal((select id from t_ids where k = 'listing'), (select id from public.businesses where slug = 'lavanderia-do-joao'),
                            90, 3, 'Busco aí amanhã. Faço por 90.', true);
  insert into t_ids values ('prop_joao', p);
  assert (select price from public.proposals where id = p) = 90 and (select count(*) from public.proposals) = 1, 'T110 João atualiza a própria proposta';
end $$;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', false);
do $$
declare p uuid;
begin
  begin perform public.send_proposal((select id from t_ids where k = 'listing'), (select id from public.businesses where slug = 'maria-sneakers'), 80, 5, null, true);
    raise exception 'T110 FALHOU coleta sem oferecer';
  exception when raise_exception then if sqlerrm like 'T110%' then raise; end if; end;
  p := public.send_proposal((select id from t_ids where k = 'listing'), (select id from public.businesses where slug = 'maria-sneakers'), 80, 5, 'Entrega em 5 dias.', false);
  insert into t_ids values ('prop_maria', p);
  assert (select count(*) from public.proposals) = 1, 'T110 Maria vê proposta do João';
  begin perform public.send_proposal((select id from t_ids where k = 'listing'), (select id from public.businesses where slug = 'lavanderia-do-joao'), 10, 1, null, false);
    raise exception 'T110 FALHOU proposta em nome de outra';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub', '16161616-0000-0000-0000-000000000016', false);
do $$ begin
  assert (select count(*) from public.listing_proposals((select id from t_ids where k = 'listing'))) = 2, 'T110 cliente vê 2 propostas';
  assert (select business_name from public.listing_proposals((select id from t_ids where k = 'listing')) order by price limit 1) = 'Maria Sneakers', 'T110 nome';
  raise notice 'T110 OK  prestadores mandam e atualizam propostas; não veem a do concorrente; cliente vê todas';
end $$;
select set_config('request.jwt.claim.sub', '17171717-0000-0000-0000-000000000017', false);
do $$ begin
  begin perform public.listing_proposals((select id from t_ids where k = 'listing')); raise exception 'T110 FALHOU outro cliente';
  exception when raise_exception then if sqlerrm like 'T110%' then raise; end if; end;
end $$;

-- T111: aceitar proposta vira pedido
select set_config('request.jwt.claim.sub', '16161616-0000-0000-0000-000000000016', false);
do $$
declare o uuid;
begin
  begin perform public.accept_proposal((select id from t_ids where k = 'prop_joao'), 'entregador'); raise exception 'T111 FALHOU entregador';
  exception when raise_exception then if sqlerrm like 'T111%' then raise; end if; end;
  begin perform public.accept_proposal((select id from t_ids where k = 'prop_joao'), 'sem_logistica', 'app'); raise exception 'T111 FALHOU app';
  exception when raise_exception then if sqlerrm like 'T111%' then raise; end if; end;
  begin perform public.accept_proposal((select id from t_ids where k = 'prop_maria'), 'prestador'); raise exception 'T111 FALHOU coleta Maria';
  exception when raise_exception then if sqlerrm like 'T111%' then raise; end if; end;
  o := public.accept_proposal((select id from t_ids where k = 'prop_joao'), 'prestador', 'direto', 'Portão azul');
  insert into t_ids values ('order', o);
  assert (select count(*) from public.my_orders() where id = o and payment_mode = 'direto' and logistics_mode = 'prestador' and total = 90) = 1, 'T111 meus pedidos';
  assert (select status from public.my_listings() where id = (select id from t_ids where k = 'listing')) = 'contratado', 'T111 anúncio contratado';
  begin perform public.accept_proposal((select id from t_ids where k = 'prop_maria')); raise exception 'T111 FALHOU aceitou 2';
  exception when raise_exception then if sqlerrm like 'T111%' then raise; end if; end;
end $$;
reset role;
do $$
declare o public.orders; c public.customers;
begin
  select * into o from public.orders where id = (select id from t_ids where k = 'order');
  select * into c from public.customers where id = o.customer_id;
  assert o.origin = 'marketplace' and o.client_user_id = '16161616-0000-0000-0000-000000000016' and o.delivery_type = 'entrega', 'T111 pedido';
  assert o.notes = 'Portão azul' and o.status = 'recebido' and o.due_date = (now() at time zone 'America/Sao_Paulo')::date + 3, 'T111 notas e prazo';
  assert (select service_name from public.order_items where order_id = o.id) = 'Lavar 3 pares de tênis brancos', 'T111 item';
  assert c.user_id = '16161616-0000-0000-0000-000000000016' and c.street = 'Rua Gavião Peixoto' and c.municipality_id = 3303302, 'T111 ficha do cliente';
  assert (select status from public.proposals where id = (select id from t_ids where k = 'prop_maria')) = 'recusada', 'T111 outra recusada';
  raise notice 'T111 OK  aceitar proposta cria o pedido no painel da lavanderia, com endereço do cliente; as outras são recusadas';
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
do $$ begin
  assert exists (select 1 from public.orders where id = (select id from t_ids where k = 'order')), 'T111 João vê o pedido';
end $$;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', false);
do $$ begin
  assert not exists (select 1 from public.orders where id = (select id from t_ids where k = 'order')), 'T111 Maria vê o pedido';
end $$;

-- T112: contratar direto pelo catálogo (preço do catálogo, nada de orçamento)
select set_config('request.jwt.claim.sub', '16161616-0000-0000-0000-000000000016', false);
do $$
declare v uuid; s uuid; s_orc uuid; o uuid; price numeric;
begin
  reset role;
  select id into v from public.businesses where slug = 'lavanderia-do-joao';
  select id, s2.price into s, price from public.services s2 where business_id = v and active and pricing_unit <> 'orcamento' and s2.price > 0 order by created_at limit 1;
  select id into s_orc from public.services where business_id = v and active and pricing_unit = 'orcamento' limit 1;
  if s_orc is null then
    insert into public.services (business_id, name, price, pricing_unit) values (v, 'Sofá sob orçamento', 0, 'orcamento') returning id into s_orc;
  end if;
  set role authenticated;
  o := public.hire_services(v, jsonb_build_array(jsonb_build_object('service_id', s, 'quantity', 2, 'unit_price', 0.01)),
                            (select id from t_ids where k = 'addr'));
  assert (select total from public.my_orders() where id = o) = round(price * 2, 2), 'T112 preço do catálogo';
  begin perform public.hire_services(v, jsonb_build_array(jsonb_build_object('service_id', s_orc)), (select id from t_ids where k = 'addr')); raise exception 'T112 FALHOU orçamento';
  exception when raise_exception then if sqlerrm like 'T112%' then raise; end if; end;
  begin perform public.hire_services((select id from public.businesses where slug = 'maria-sneakers'),
          jsonb_build_array(jsonb_build_object('service_id', (select id from public.services where business_id = (select id from public.businesses where slug = 'maria-sneakers') and active limit 1))),
          (select id from t_ids where k = 'addr'), 'prestador'); raise exception 'T112 FALHOU coleta';
  exception when raise_exception then if sqlerrm like 'T112%' then raise; end if; end;
  raise notice 'T112 OK  contratar pelo perfil usa o preço do catálogo; sob orçamento e coleta não oferecida são recusados';
end $$;

-- T113: sem WhatsApp não contrata; prestador fora da busca não recebe nem propõe
reset role;
insert into public.user_roles (user_id, role) values ('17171717-0000-0000-0000-000000000017', 'anunciante');
set role authenticated;
select set_config('request.jwt.claim.sub', '17171717-0000-0000-0000-000000000017', false);
do $$
declare a uuid;
begin
  insert into public.user_addresses (label, city, state) values ('Casa', 'Niterói', 'RJ') returning id into a;
  begin perform public.hire_services((select id from public.businesses where slug = 'lavanderia-do-joao'),
          '[{"service_id":"00000000-0000-0000-0000-000000000000"}]', a); raise exception 'T113 FALHOU sem whatsapp';
  exception when raise_exception then if sqlerrm like 'T113%' then raise; end if; end;
  insert into t_ids values ('listing2', public.create_listing('lavagem_edredons', 'Edredom de casal', null, a));
end $$;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
select public.set_marketplace_visible((select id from public.businesses where slug = 'lavanderia-do-joao'), false);
do $$ begin
  begin perform public.send_proposal((select id from t_ids where k = 'listing2'), (select id from public.businesses where slug = 'lavanderia-do-joao'), 50, 2);
    raise exception 'T113 FALHOU invisível propôs';
  exception when raise_exception then if sqlerrm like 'T113%' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub', '17171717-0000-0000-0000-000000000017', false);
do $$ begin
  perform public.cancel_listing((select id from t_ids where k = 'listing2'));
  assert (select status from public.my_listings() where id = (select id from t_ids where k = 'listing2')) = 'cancelado', 'T113 cancelado';
  raise notice 'T113 OK  sem WhatsApp não contrata; prestador fora da busca não propõe; cliente encerra o anúncio';
end $$;

-- T114: visitante não usa nada disso; RLS em tudo
reset role;
set role anon;
do $$ begin
  begin perform public.create_listing('outros', 'Teste anônimo', null, gen_random_uuid()); raise exception 'T114 FALHOU anon';
  exception when insufficient_privilege then null; end;
  begin perform count(*) from public.proposals; raise exception 'T114 FALHOU propostas';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
-- T115: apagar a conta de quem contratou (ex.: pedido de exclusão) mantém o pedido na lavanderia, sem o vínculo
do $$
declare o uuid := (select id from t_ids where k = 'order');
begin
  delete from auth.users where id = '16161616-0000-0000-0000-000000000016';
  assert (select client_user_id is null and listing_id is null and proposal_id is null and total = 90 from public.orders where id = o), 'T115 pedido mantido';
  assert not exists (select 1 from public.listings where user_id = '16161616-0000-0000-0000-000000000016'), 'T115 anúncios apagados';
  raise notice 'T115 OK  conta do cliente apagada: anúncios somem, o pedido fica na lavanderia sem o vínculo';
end $$;
do $$ begin
  assert not exists (select 1 from public.tables_without_rls() where table_name not in ('t_tok', 't_ids')), 'T114 RLS';
  raise notice 'T114 OK  visitante não publica nem vê propostas; RLS em todas as tabelas';
end $$;
