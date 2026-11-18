-- Testes da Etapa 2b (endereços e entregas). Roda depois de 20_etapa2_tests.sql.
\set ON_ERROR_STOP on
\set QUIET on

reset role;

-- T31: nada sem RLS depois da migration
do $$ begin
  assert not exists (select 1 from public.tables_without_rls()), 'T31 há tabela sem RLS';
  raise notice 'T31 OK  RLS continua em todas as tabelas';
end $$;

-- ---------------------------------------------------------------- Usuário A (dono)
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);

-- T32: dono salva o endereço completo da lavanderia
do $$ begin
  update public.businesses
     set street = 'Rua da Mooca', street_number = '1000', postal_code = '03104002',
         lat = -23.5505, lng = -46.6000, place_id = 'ChIJ-teste'
   where slug = 'lavanderia-do-joao';
  assert (select street from public.businesses where slug = 'lavanderia-do-joao') = 'Rua da Mooca', 'T32 rua';
  assert (select lat from public.businesses where slug = 'lavanderia-do-joao') = -23.5505, 'T32 lat';
  raise notice 'T32 OK  dono salva endereço e localização da lavanderia';
end $$;

-- T33: coordenada inválida e CEP inválido são recusados
do $$ begin
  begin
    update public.businesses set lat = 120 where slug = 'lavanderia-do-joao';
    raise exception 'T33 FALHOU lat';
  exception when check_violation then null;
  end;
  begin
    update public.customers set postal_code = '123' where name = 'Ana Cliente';
    raise exception 'T33 FALHOU cep';
  exception when check_violation then null;
  end;
  raise notice 'T33 OK  latitude fora do limite e CEP inválido são recusados';
end $$;

-- T34: endereço do cliente e pedido com entrega
do $$
declare v_ana uuid; v_srv uuid; v uuid;
begin
  update public.customers
     set street = 'Av. Paes de Barros', street_number = '50', neighborhood = 'Mooca', city = 'São Paulo',
         state = 'SP', postal_code = '03115000', lat = -23.56, lng = -46.59
   where name = 'Ana Cliente'
  returning id into v_ana;
  select id into v_srv from public.services where name = 'Lavagem simples';
  v := public.create_order(v_ana, jsonb_build_array(jsonb_build_object('service_id', v_srv)), null, null, 'entrega');
  assert (select delivery_type from public.orders where id = v) = 'entrega', 'T34 entrega';
  -- sem informar, continua sendo retirada (compatível com a tela antiga)
  v := public.create_order(v_ana, jsonb_build_array(jsonb_build_object('service_id', v_srv)));
  assert (select delivery_type from public.orders where id = v) = 'retirada', 'T34 padrão';
  update public.orders set delivery_type = 'entrega' where id = v;
  assert (select delivery_type from public.orders where id = v) = 'entrega', 'T34 alterar tipo';
  raise notice 'T34 OK  endereço do cliente e pedido com entrega no endereço';
end $$;

-- ---------------------------------------------------------------- Usuário D (staff de A)
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000004', false);

-- T35: staff edita endereço de cliente, mas não o da lavanderia
do $$
declare n int;
begin
  update public.customers set complement = 'Apto 12' where name = 'Ana Cliente';
  get diagnostics n = row_count;
  assert n = 1, 'T35 staff não editou cliente';
  update public.businesses set street = 'HACK' where slug = 'lavanderia-do-joao';
  get diagnostics n = row_count;
  assert n = 0, 'T35 staff alterou endereço da lavanderia';
  raise notice 'T35 OK  staff edita endereço de cliente; endereço da lavanderia é do dono';
end $$;

-- ---------------------------------------------------------------- Usuário B (outra lavanderia)
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', false);

-- T36: ISOLAMENTO — B não vê nem altera endereços de A
do $$
declare n int;
begin
  assert not exists (select 1 from public.customers where street = 'Av. Paes de Barros'), 'T36 B vê endereço de cliente de A';
  assert not exists (select 1 from public.businesses where street = 'Rua da Mooca'), 'T36 B vê endereço de A';
  update public.customers set street = 'HACK' where street = 'Av. Paes de Barros';
  get diagnostics n = row_count;
  assert n = 0, 'T36 B alterou endereço de A';
  raise notice 'T36 OK  usuário B não vê nem altera endereços de A';
end $$;

reset role;
do $$ begin
  assert (select street from public.businesses where slug = 'lavanderia-do-joao') = 'Rua da Mooca', 'T37 endereço de A';
  assert (select complement from public.customers where name = 'Ana Cliente') = 'Apto 12', 'T37 complemento';
  raise notice 'T37 OK  endereços de A intactos';
end $$;
