-- Testes do marketplace, Etapa 2 (anunciante). Roda depois de 95_perfis_tests.sql.
\set ON_ERROR_STOP on
\set QUIET on

reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('16161616-0000-0000-0000-000000000016', 'cliente1@teste.com', '{"full_name":"Clara Cliente"}'),
  ('17171717-0000-0000-0000-000000000017', 'cliente2@teste.com', '{"full_name":"Caio Cliente"}');

set role authenticated;
select set_config('request.jwt.claim.sub', '16161616-0000-0000-0000-000000000016', false);

-- T93: endereços: município calculado, primeiro vira principal
do $$
declare a1 uuid; a2 uuid;
begin
  perform public.add_my_role('anunciante');
  update public.profiles set phone = '21988887777' where id = auth.uid();
  insert into public.user_addresses (label, street, street_number, neighborhood, city, state, postal_code)
  values ('Casa', 'Rua Gavião Peixoto', '100', 'Icaraí', 'Niteroi', 'RJ', '24230100') returning id into a1;
  insert into public.user_addresses (label, city, state) values ('Trabalho', 'Rio de Janeiro', 'RJ') returning id into a2;
  assert (select municipality_id from public.user_addresses where id = a1) = 3303302, 'T93 Niterói';
  assert (select is_default from public.user_addresses where id = a1), 'T93 primeiro principal';
  assert not (select is_default from public.user_addresses where id = a2), 'T93 segundo não';
  perform public.set_default_address(a2);
  assert (select count(*) from public.user_addresses where is_default) = 1 and (select is_default from public.user_addresses where id = a2), 'T93 troca principal';
  delete from public.user_addresses where id = a2;
  assert (select is_default from public.user_addresses where id = a1), 'T93 apagou principal, outro assume';
  raise notice 'T93 OK  endereço com município automático; um principal; apagar o principal promove outro';
end $$;

-- T94: não dá para forçar município, dono ou principal; endereço fora do RJ fica sem município
do $$
declare a uuid;
begin
  begin insert into public.user_addresses (label, city, state, municipality_id) values ('X', 'Niterói', 'RJ', 3304557); raise exception 'T94 FALHOU município';
  exception when insufficient_privilege then null; end;
  begin insert into public.user_addresses (label, city, state, user_id) values ('X', 'Niterói', 'RJ', '17171717-0000-0000-0000-000000000017'); raise exception 'T94 FALHOU dono';
  exception when insufficient_privilege then null; end;
  begin update public.user_addresses set is_default = false; raise exception 'T94 FALHOU principal';
  exception when insufficient_privilege then null; end;
  insert into public.user_addresses (label, city, state) values ('Mãe', 'Belo Horizonte', 'MG') returning id into a;
  assert (select municipality_id from public.user_addresses where id = a) is null, 'T94 fora do RJ';
  delete from public.user_addresses where id = a;
  raise notice 'T94 OK  município, dono e principal não são escolhidos à mão; fora do RJ fica sem município';
end $$;

-- T95: limite de 10 endereços
do $$
declare i integer;
begin
  for i in 1..9 loop insert into public.user_addresses (label, city, state) values ('E' || i, 'Rio de Janeiro', 'RJ'); end loop;
  begin insert into public.user_addresses (label, city, state) values ('E11', 'Rio de Janeiro', 'RJ'); raise exception 'T95 FALHOU limite';
  exception when raise_exception then if sqlerrm like 'T95%' then raise; end if; end;
  delete from public.user_addresses where label like 'E%';
  raise notice 'T95 OK  no máximo 10 endereços por conta';
end $$;

-- T96: outro cliente não vê nem mexe nos endereços de Clara
select set_config('request.jwt.claim.sub', '17171717-0000-0000-0000-000000000017', false);
do $$
declare a uuid;
begin
  assert (select count(*) from public.user_addresses) = 0, 'T96 vê endereços alheios';
  reset role;
  select id into a from public.user_addresses where user_id = '16161616-0000-0000-0000-000000000016' limit 1;
  set role authenticated;
  update public.user_addresses set street = 'invadido' where id = a;
  delete from public.user_addresses where id = a;
  begin perform public.set_default_address(a); raise exception 'T96 FALHOU principal alheio';
  exception when raise_exception then if sqlerrm like 'T96%' then raise; end if; end;
  reset role;
  assert (select street from public.user_addresses where id = a) = 'Rua Gavião Peixoto', 'T96 alterou';
  set role authenticated;
  raise notice 'T96 OK  outro cliente não vê, não altera e não apaga endereços de Clara';
end $$;

-- T97: Meus pedidos mostra só os pedidos ligados à conta, sem notas internas
reset role;
do $$
declare o uuid;
begin
  select id into o from public.orders where business_id = (select id from public.businesses where slug = 'lavanderia-do-joao') order by created_at limit 1;
  update public.orders set client_user_id = '16161616-0000-0000-0000-000000000016', notes = 'cliente chato (nota interna)' where id = o;
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub', '16161616-0000-0000-0000-000000000016', false);
do $$
declare r record;
begin
  assert (select count(*) from public.my_orders()) = 1, 'T97 um pedido';
  select * into r from public.my_orders();
  assert r.business_name like 'Lavanderia do João%' and jsonb_array_length(r.items) >= 1, 'T97 lavanderia e itens';
  assert (select count(*) from public.orders) = 0, 'T97 cliente lê a tabela de pedidos';
  assert position('chato' in (select row_to_json(x)::text from public.my_orders() x)) = 0, 'T97 nota interna vazou';
  raise notice 'T97 OK  Meus pedidos: só os da conta, com lavanderia e itens, sem notas internas';
end $$;
select set_config('request.jwt.claim.sub', '17171717-0000-0000-0000-000000000017', false);
do $$ begin
  assert (select count(*) from public.my_orders()) = 0, 'T98 vê pedido alheio';
  raise notice 'T98 OK  outro cliente não vê os pedidos de Clara';
end $$;

-- T99: visitante sem conta não acessa nada disso; RLS em tudo
reset role;
set role anon;
do $$ begin
  begin perform count(*) from public.user_addresses; raise exception 'T99 FALHOU anon endereços';
  exception when insufficient_privilege then null; end;
  begin perform public.my_orders(); raise exception 'T99 FALHOU anon pedidos';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  assert not exists (select 1 from public.tables_without_rls() where table_name <> 't_tok'), 'T99 RLS';
  raise notice 'T99 OK  visitante não vê endereços nem pedidos; RLS em todas as tabelas';
end $$;
