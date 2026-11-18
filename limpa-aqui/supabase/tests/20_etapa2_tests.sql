-- Testes da Etapa 2 (clientes, serviços, pedidos). Roda depois de 10_etapa1_tests.sql,
-- que deixa criadas a lavanderia de A (João) e a de B (Maria).
\set ON_ERROR_STOP on
\set QUIET on

-- Usuário D: funcionário (staff) da lavanderia de A
reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('dddddddd-0000-0000-0000-000000000004', 'staff@teste.com', '{"full_name":"Pedro Staff"}');
insert into public.business_members (business_id, user_id, role)
select id, 'dddddddd-0000-0000-0000-000000000004', 'staff' from public.businesses where slug = 'lavanderia-do-joao';

-- T16: nenhuma tabela nova sem RLS
do $$ begin
  assert not exists (select 1 from public.tables_without_rls()), 'T16 há tabela sem RLS';
  raise notice 'T16 OK  clientes, serviços, pedidos e itens têm RLS';
end $$;

-- ---------------------------------------------------------------- Usuário A (dono)
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);

-- T17: dono cadastra serviços e clientes
do $$
declare v_biz uuid;
begin
  select id into v_biz from public.businesses;
  insert into public.services (business_id, name, price, due_days) values
    (v_biz, 'Lavagem simples', 40, 2),
    (v_biz, 'Lavagem premium', 70.50, 4),
    (v_biz, 'Pintura de sola', 90, null);
  insert into public.customers (business_id, name, whatsapp) values
    (v_biz, 'Ana Cliente', '11911112222'),
    (v_biz, 'Bruno Cliente', null);
  assert (select count(*) from public.services) = 3, 'T17 serviços';
  assert (select count(*) from public.customers) = 2, 'T17 clientes';
  raise notice 'T17 OK  dono cadastra serviços e clientes';
end $$;

-- T18: WhatsApp duplicado na mesma lavanderia é recusado
do $$ begin
  begin
    insert into public.customers (business_id, name, whatsapp)
    select id, 'Ana Duplicada', '11911112222' from public.businesses;
    raise exception 'T18 FALHOU';
  exception when unique_violation then
    raise notice 'T18 OK  WhatsApp de cliente não se repete na mesma lavanderia';
  end;
end $$;

-- T19: insert direto em orders / order_items é negado
do $$ begin
  begin
    insert into public.orders (business_id, number, customer_id, due_date)
    select business_id, 99, id, current_date from public.customers limit 1;
    raise exception 'T19 FALHOU orders';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.order_items (business_id, order_id, service_name, unit_price)
    values (gen_random_uuid(), gen_random_uuid(), 'x', 1);
    raise exception 'T19 FALHOU order_items';
  exception when insufficient_privilege then null;
  end;
  raise notice 'T19 OK  pedidos e itens só são criados pela função create_order';
end $$;

-- T20: create_order grava itens, total, número e prazo
do $$
declare
  v_ana uuid; v_simples uuid; v_premium uuid; v_order uuid; o public.orders%rowtype;
begin
  select id into v_ana from public.customers where name = 'Ana Cliente';
  select id into v_simples from public.services where name = 'Lavagem simples';
  select id into v_premium from public.services where name = 'Lavagem premium';

  v_order := public.create_order(v_ana, jsonb_build_array(
    jsonb_build_object('service_id', v_simples, 'description', 'Nike Air Force branco', 'quantity', 2),
    jsonb_build_object('service_id', v_premium, 'description', 'Jordan 1', 'unit_price', 65)
  ), null, 'Cliente pediu cuidado com o cadarço');

  select * into o from public.orders where id = v_order;
  assert o.number = 1, 'T20 número';
  assert o.total = 145, 'T20 total (2 x 40 + 65)';
  assert o.status = 'recebido', 'T20 status inicial';
  assert o.due_date = (now() at time zone 'America/Sao_Paulo')::date + 4, 'T20 prazo = maior prazo dos serviços';
  assert (select count(*) from public.order_items where order_id = v_order) = 2, 'T20 itens';
  assert (select service_name from public.order_items where order_id = v_order and position = 1) = 'Lavagem premium', 'T20 nome do serviço no item';
  assert (select next_order_number from public.businesses) = 2, 'T20 próximo número';
  raise notice 'T20 OK  create_order calcula total, prazo e numeração';
end $$;

-- T21: numeração sequencial e prazo informado/padrão
do $$
declare v_bruno uuid; v_sola uuid; v2 uuid; v3 uuid;
begin
  select id into v_bruno from public.customers where name = 'Bruno Cliente';
  select id into v_sola from public.services where name = 'Pintura de sola';
  v2 := public.create_order(v_bruno, jsonb_build_array(jsonb_build_object('service_id', v_sola)));
  v3 := public.create_order(v_bruno, jsonb_build_array(jsonb_build_object('service_id', v_sola)), date '2030-01-10');
  assert (select number from public.orders where id = v2) = 2, 'T21 número 2';
  assert (select number from public.orders where id = v3) = 3, 'T21 número 3';
  -- serviço sem prazo usa o prazo padrão da lavanderia (5 dias, definido na Etapa 1)
  assert (select due_date from public.orders where id = v2) = (now() at time zone 'America/Sao_Paulo')::date + 5, 'T21 prazo padrão';
  assert (select due_date from public.orders where id = v3) = date '2030-01-10', 'T21 prazo informado';
  raise notice 'T21 OK  numeração sequencial e prazo padrão/informado';
end $$;

-- T22: validações de create_order
do $$
declare v_ana uuid; v_simples uuid;
begin
  select id into v_ana from public.customers where name = 'Ana Cliente';
  select id into v_simples from public.services where name = 'Lavagem simples';
  begin
    perform public.create_order(v_ana, '[]'::jsonb);
    raise exception 'T22 FALHOU vazio';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.create_order(v_ana, jsonb_build_array(jsonb_build_object('service_id', v_simples, 'quantity', 0)));
    raise exception 'T22 FALHOU quantidade';
  exception when invalid_parameter_value then null;
  end;
  update public.services set active = false where id = v_simples;
  begin
    perform public.create_order(v_ana, jsonb_build_array(jsonb_build_object('service_id', v_simples)));
    raise exception 'T22 FALHOU serviço desativado';
  exception when raise_exception then
    if sqlerrm like 'T22%' then raise; end if;
  end;
  update public.services set active = true where id = v_simples;
  -- falhas não consomem número de pedido
  assert (select next_order_number from public.businesses) = 4, 'T22 numeração consumida em falha';
  raise notice 'T22 OK  pedido vazio, quantidade inválida e serviço desativado são recusados';
end $$;

-- T23: transições de status
do $$
declare v uuid; o public.orders%rowtype;
begin
  select id into v from public.orders where number = 1;
  perform public.set_order_status(v, 'em_lavagem');
  perform public.set_order_status(v, 'pronto');
  select * into o from public.orders where id = v;
  assert o.status = 'pronto' and o.ready_at is not null, 'T23 pronto';
  perform public.set_order_status(v, 'entregue');
  select * into o from public.orders where id = v;
  assert o.delivered_at is not null, 'T23 entregue';
  begin
    perform public.set_order_status(v, 'recebido');
    raise exception 'T23 FALHOU entregue -> recebido';
  exception when raise_exception then
    if sqlerrm like 'T23%' then raise; end if;
  end;
  perform public.set_order_status(v, 'pronto');   -- desfazer entrega
  select * into o from public.orders where id = v;
  assert o.status = 'pronto' and o.delivered_at is null and o.ready_at is not null, 'T23 desfazer';

  select id into v from public.orders where number = 2;
  perform public.set_order_status(v, 'cancelado');
  begin
    perform public.set_order_status(v, 'recebido');
    raise exception 'T23 FALHOU cancelado reaberto';
  exception when raise_exception then
    if sqlerrm like 'T23%' then raise; end if;
  end;
  raise notice 'T23 OK  status só muda por transições válidas e registra as datas';
end $$;

-- T24: campos protegidos do pedido
do $$
declare v uuid;
begin
  select id into v from public.orders where number = 1;
  update public.orders set paid = true, notes = 'Pago no Pix' where id = v;
  assert (select paid from public.orders where id = v), 'T24 pago';
  begin
    update public.orders set total = 1 where id = v;
    raise exception 'T24 FALHOU total';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.orders set status = 'entregue' where id = v;
    raise exception 'T24 FALHOU status';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.orders set number = 50 where id = v;
    raise exception 'T24 FALHOU número';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.orders where id = v;
    raise exception 'T24 FALHOU delete';
  exception when insufficient_privilege then null;
  end;
  raise notice 'T24 OK  tela edita pago/prazo/observações; total, status e número protegidos';
end $$;

-- T25: cliente com pedido não pode ser excluído
do $$ begin
  begin
    delete from public.customers where name = 'Ana Cliente';
    raise exception 'T25 FALHOU';
  exception when foreign_key_violation then
    raise notice 'T25 OK  cliente com pedidos não é excluído';
  end;
end $$;

-- ---------------------------------------------------------------- Usuário D (staff de A)
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000004', false);

-- T26: staff opera pedidos e clientes, mas não mexe no catálogo nem exclui clientes
do $$
declare v_biz uuid; v_cli uuid; v_simples uuid; v uuid; n int;
begin
  select id into v_biz from public.businesses;
  assert (select count(*) from public.orders) = 3, 'T26 staff vê pedidos';
  insert into public.customers (business_id, name) values (v_biz, 'Carla Balcão') returning id into v_cli;
  select id into v_simples from public.services where name = 'Lavagem simples';
  v := public.create_order(v_cli, jsonb_build_array(jsonb_build_object('service_id', v_simples)));
  assert (select number from public.orders where id = v) = 4, 'T26 staff cria pedido';
  perform public.set_order_status(v, 'em_lavagem');

  update public.services set price = 1 where id = v_simples;
  get diagnostics n = row_count;
  assert n = 0, 'T26 staff alterou preço';
  begin
    insert into public.services (business_id, name, price) values (v_biz, 'Serviço staff', 10);
    raise exception 'T26 FALHOU staff criou serviço';
  exception when insufficient_privilege then null;
  end;
  delete from public.customers where id = v_cli;
  get diagnostics n = row_count;
  assert n = 0, 'T26 staff excluiu cliente';
  raise notice 'T26 OK  staff cria clientes e pedidos; catálogo e exclusões são do dono';
end $$;

-- ---------------------------------------------------------------- Usuário B (outra lavanderia)
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', false);

-- T27: ISOLAMENTO — B não vê nada da operação de A
do $$ begin
  assert (select count(*) from public.customers) = 0, 'T27 clientes';
  assert (select count(*) from public.services) = 0, 'T27 serviços';
  assert (select count(*) from public.orders) = 0, 'T27 pedidos';
  assert (select count(*) from public.order_items) = 0, 'T27 itens';
  raise notice 'T27 OK  usuário B não enxerga clientes, serviços nem pedidos de A';
end $$;

-- T28: ISOLAMENTO — B não altera nem usa dados de A, mesmo com ids forjados
do $$
declare
  v_biz_a uuid; v_biz_b uuid; v_cli_a uuid; v_srv_a uuid; v_ord_a uuid; v_cli_b uuid; v_srv_b uuid; n int;
begin
  reset role;
  select id into v_biz_a from public.businesses where slug = 'lavanderia-do-joao';
  select id into v_biz_b from public.businesses where slug = 'maria-sneakers';
  select id into v_cli_a from public.customers where name = 'Ana Cliente';
  select id into v_srv_a from public.services where name = 'Lavagem simples';
  select id into v_ord_a from public.orders where business_id = v_biz_a and number = 1;
  set role authenticated;

  update public.customers set name = 'HACK' where id = v_cli_a;
  get diagnostics n = row_count;
  assert n = 0, 'T28 B alterou cliente de A';
  update public.orders set paid = false where id = v_ord_a;
  get diagnostics n = row_count;
  assert n = 0, 'T28 B alterou pedido de A';
  delete from public.services where id = v_srv_a;
  get diagnostics n = row_count;
  assert n = 0, 'T28 B excluiu serviço de A';

  begin
    insert into public.customers (business_id, name) values (v_biz_a, 'Intruso');
    raise exception 'T28 FALHOU B inseriu cliente em A';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.create_order(v_cli_a, jsonb_build_array(jsonb_build_object('service_id', v_srv_a)));
    raise exception 'T28 FALHOU B criou pedido para cliente de A';
  exception when raise_exception then
    if sqlerrm like 'T28%' then raise; end if;
  end;

  begin
    perform public.set_order_status(v_ord_a, 'cancelado');
    raise exception 'T28 FALHOU B mudou status de A';
  exception when raise_exception then
    if sqlerrm like 'T28%' then raise; end if;
  end;

  -- B usa o próprio cliente com o serviço de A: recusado
  insert into public.customers (business_id, name) values (v_biz_b, 'Cliente da Maria') returning id into v_cli_b;
  begin
    perform public.create_order(v_cli_b, jsonb_build_array(jsonb_build_object('service_id', v_srv_a)));
    raise exception 'T28 FALHOU B usou serviço de A';
  exception when raise_exception then
    if sqlerrm like 'T28%' then raise; end if;
  end;

  -- O primeiro pedido de B é o número 1 da lavanderia de B
  insert into public.services (business_id, name, price) values (v_biz_b, 'Higienização', 50) returning id into v_srv_b;
  v_ord_a := public.create_order(v_cli_b, jsonb_build_array(jsonb_build_object('service_id', v_srv_b)));
  assert (select number from public.orders where id = v_ord_a) = 1, 'T28 numeração de B';
  raise notice 'T28 OK  usuário B não altera nem usa clientes, serviços ou pedidos de A';
end $$;

-- ---------------------------------------------------------------- Anônimo
reset role;
set role anon;
select set_config('request.jwt.claim.sub', '', false);
do $$ begin
  begin
    perform count(*) from public.orders;
    raise exception 'T29 FALHOU anon leu pedidos';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from public.customers;
    raise exception 'T29 FALHOU anon leu clientes';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.create_order(gen_random_uuid(), '[]'::jsonb);
    raise exception 'T29 FALHOU anon chamou create_order';
  exception when insufficient_privilege then null;
  end;
  raise notice 'T29 OK  visitante anônimo não lê pedidos/clientes nem cria pedidos';
end $$;

-- ---------------------------------------------------------------- Conferência final
reset role;
do $$ begin
  assert (select name from public.customers where name = 'Ana Cliente') is not null, 'T30 cliente de A';
  assert (select price from public.services where name = 'Lavagem simples') = 40, 'T30 preço de A';
  assert (select paid from public.orders o join public.businesses b on b.id = o.business_id
          where b.slug = 'lavanderia-do-joao' and o.number = 1), 'T30 pedido de A';
  -- Excluir um serviço mantém o histórico do item
  delete from public.services where name = 'Lavagem premium';
  assert (select service_name from public.order_items where service_name = 'Lavagem premium' and service_id is null) = 'Lavagem premium',
    'T30 histórico do item';
  raise notice 'T30 OK  dados de A intactos; item mantém o serviço mesmo após exclusão';
end $$;
