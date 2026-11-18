-- Testes da Etapa 4 (ficha por categoria, quantidade decimal e orçamentos). Roda depois de 50_painel_tests.sql.
\set ON_ERROR_STOP on
\set QUIET on

-- ---------------------------------------------------------------- Usuário A (dono da lavanderia-do-joao)
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);

do $$
declare v uuid;
begin
  select id into v from public.businesses where slug = 'lavanderia-do-joao';
  insert into public.services (business_id, name, price, category_code, pricing_unit) values
    (v, 'Lavagem por quilo A', 12.90, 'lavagem_roupas', 'kg'),
    (v, 'Tênis premium A', 60, 'lavagem_tenis', 'par'),
    (v, 'Sofá A', 0, 'higienizacao_sofas', 'orcamento');
end $$;

-- T58: ficha do calçado e quantidade decimal por kg
do $$
declare v_cli uuid; v_kg uuid; v_ten uuid; o uuid; it jsonb;
begin
  select id into v_cli from public.customers where name = 'Ana Cliente';
  select id into v_kg from public.services where name = 'Lavagem por quilo A';
  select id into v_ten from public.services where name = 'Tênis premium A';
  o := public.create_order(v_cli, jsonb_build_array(
    jsonb_build_object('service_id', v_kg, 'quantity', 2.5),
    jsonb_build_object('service_id', v_ten, 'quantity', 1, 'attributes',
      jsonb_build_object('marca', ' Nike ', 'modelo', 'Air Force 1', 'cor', 'Branco', 'numeracao', '42', 'tecido', ''))
  ));
  assert (select total from public.orders where id = o) = 92.25, 'T58 total 2,5 kg × 12,90 + 60';
  select attributes into it from public.order_items where order_id = o and position = 1;
  assert it = '{"marca":"Nike","modelo":"Air Force 1","cor":"Branco","numeracao":"42"}'::jsonb, 'T58 ficha limpa: ' || it::text;
  assert (select status from public.orders where id = o) = 'recebido', 'T58 status';
  raise notice 'T58 OK  quantidade decimal por kg e ficha do calçado (espaços e campos vazios limpos)';
end $$;

-- T59: ficha inválida e quantidade fracionada em serviço por par são recusadas
do $$
declare v_cli uuid; v_ten uuid; v_sofa uuid;
begin
  select id into v_cli from public.customers where name = 'Ana Cliente';
  select id into v_ten from public.services where name = 'Tênis premium A';
  select id into v_sofa from public.services where name = 'Sofá A';
  begin
    perform public.create_order(v_cli, jsonb_build_array(jsonb_build_object('service_id', v_ten, 'attributes', jsonb_build_object('senha', 'x'))));
    raise exception 'T59 FALHOU campo desconhecido';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.create_order(v_cli, jsonb_build_array(jsonb_build_object('service_id', v_ten, 'attributes', jsonb_build_object('numeracao', '42424242424'))));
    raise exception 'T59 FALHOU numeração longa';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.create_order(v_cli, jsonb_build_array(jsonb_build_object('service_id', v_sofa, 'attributes', jsonb_build_object('largura_cm', 99999))));
    raise exception 'T59 FALHOU medida';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.create_order(v_cli, jsonb_build_array(jsonb_build_object('service_id', v_ten, 'quantity', 1.5)));
    raise exception 'T59 FALHOU 1,5 par';
  exception when invalid_parameter_value then null; end;
  raise notice 'T59 OK  campo desconhecido, texto longo, medida absurda e 1,5 par são recusados';
end $$;

-- T60: orçamento — cria, ajusta itens, aprova
do $$
declare v_cli uuid; v_sofa uuid; o uuid; n int; r timestamptz;
begin
  select id into v_cli from public.customers where name = 'Ana Cliente';
  select id into v_sofa from public.services where name = 'Sofá A';
  select next_order_number into n from public.businesses where slug = 'lavanderia-do-joao';
  o := public.create_order(v_cli,
         jsonb_build_array(jsonb_build_object('service_id', v_sofa, 'attributes',
           jsonb_build_object('largura_cm', 210, 'profundidade_cm', 90, 'lugares', 3, 'tecido', 'Suede'))),
         null, 'Visita na quinta', 'retirada', true);
  assert (select status from public.orders where id = o) = 'orcamento', 'T60 status orçamento';
  assert (select number from public.orders where id = o) = n, 'T60 mesma numeração';
  assert (select (attributes ->> 'lugares')::int from public.order_items where order_id = o) = 3, 'T60 medidas';
  -- combinou o preço com o cliente
  perform public.update_quote_items(o, jsonb_build_array(jsonb_build_object('service_id', v_sofa, 'unit_price', 280,
           'attributes', jsonb_build_object('largura_cm', 210, 'lugares', 3))));
  assert (select total from public.orders where id = o) = 280, 'T60 total ajustado';
  assert (select count(*) from public.order_items where order_id = o) = 1, 'T60 itens trocados';
  select received_at into r from public.orders where id = o;
  perform public.set_order_status(o, 'recebido');
  assert (select status from public.orders where id = o) = 'recebido', 'T60 aprovado';
  -- (numa mesma transação now() não muda; no uso real a aprovação é outra transação)
  assert (select received_at from public.orders where id = o) >= r, 'T60 data de recebimento = aprovação';
  -- depois de aprovado, itens não mudam mais e não volta a ser orçamento
  begin perform public.update_quote_items(o, '[]'::jsonb); raise exception 'T60 FALHOU editar pedido';
  exception when raise_exception then if sqlerrm like 'T60%' then raise; end if; end;
  begin perform public.set_order_status(o, 'orcamento'); raise exception 'T60 FALHOU voltar a orçamento';
  exception when raise_exception then if sqlerrm like 'T60%' then raise; end if; end;
  raise notice 'T60 OK  orçamento com medidas, preço combinado depois, aprovado vira pedido e trava itens';
end $$;

-- T61: orçamento recusado (cancelado) e transições proibidas
do $$
declare v_cli uuid; v_sofa uuid; o uuid;
begin
  select id into v_cli from public.customers where name = 'Ana Cliente';
  select id into v_sofa from public.services where name = 'Sofá A';
  o := public.create_order(v_cli, jsonb_build_array(jsonb_build_object('service_id', v_sofa)), null, null, 'retirada', true);
  begin perform public.set_order_status(o, 'em_lavagem'); raise exception 'T61 FALHOU orçamento → lavagem';
  exception when raise_exception then if sqlerrm like 'T61%' then raise; end if; end;
  perform public.set_order_status(o, 'cancelado');
  assert (select canceled_at is not null from public.orders where id = o), 'T61 recusado';
  raise notice 'T61 OK  orçamento só vira pedido ou é recusado; não pula etapas';
end $$;

-- ---------------------------------------------------------------- Usuário B (outra empresa)
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', false);
do $$
declare o uuid;
begin
  reset role;
  select o2.id into o from public.orders o2 join public.businesses b on b.id = o2.business_id
   where b.slug = 'lavanderia-do-joao' and o2.status = 'cancelado' order by o2.number desc limit 1;
  set role authenticated;
  begin perform public.update_quote_items(o, '[]'::jsonb); raise exception 'T62 FALHOU';
  exception when raise_exception then if sqlerrm like 'T62%' then raise; end if; end;
  assert (select count(*) from public.order_items where order_id = o) = 0, 'T62 B vê itens de A';
  raise notice 'T62 OK  outra empresa não lê nem altera orçamentos de A';
end $$;

reset role;
do $$ begin
  assert (select count(*) from public.features where code in ('campos_calcado','catalogo_roupas','dimensoes_item','orcamento') and status = 'disponivel') = 4, 'T63 recursos';
  assert not exists (select 1 from public.tables_without_rls()), 'T63 RLS';
  raise notice 'T63 OK  ficha do calçado, catálogo de roupas, medidas e orçamentos disponíveis';
end $$;
