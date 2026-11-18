-- Testes da Etapa 5 (fotos de antes e depois). Roda depois de 60_pedidos_categoria_tests.sql.
\set ON_ERROR_STOP on
\set QUIET on

-- ---------------------------------------------------------------- Usuário A (dono)
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);

-- T64: registrar fotos de antes e depois no próprio pedido
do $$
declare v uuid; o uuid;
begin
  select id into v from public.businesses where slug = 'lavanderia-do-joao';
  select id into o from public.orders where business_id = v order by number limit 1;
  insert into public.order_photos (business_id, order_id, kind, path) values
    (v, o, 'antes',  v || '/' || o || '/a1.webp'),
    (v, o, 'depois', v || '/' || o || '/d1.webp');
  assert (select count(*) from public.order_photos where order_id = o) = 2, 'T64 fotos';
  assert (select created_by from public.order_photos where path like '%a1.webp') = 'aaaaaaaa-0000-0000-0000-000000000001', 'T64 autor';
  raise notice 'T64 OK  fotos de antes e depois registradas no pedido';
end $$;

-- T65: caminho fora da pasta do pedido é recusado; limite de 12 fotos
do $$
declare v uuid; o uuid; o2 uuid;
begin
  select id into v from public.businesses where slug = 'lavanderia-do-joao';
  select id into o from public.orders where business_id = v order by number limit 1;
  select id into o2 from public.orders where business_id = v order by number desc limit 1;
  begin
    insert into public.order_photos (business_id, order_id, kind, path) values (v, o, 'antes', v || '/' || o2 || '/x.webp');
    raise exception 'T65 FALHOU pasta de outro pedido';
  exception when check_violation then null; end;
  for i in 3..12 loop
    insert into public.order_photos (business_id, order_id, kind, path) values (v, o, 'antes', v || '/' || o || '/f' || i || '.webp');
  end loop;
  begin
    insert into public.order_photos (business_id, order_id, kind, path) values (v, o, 'antes', v || '/' || o || '/f13.webp');
    raise exception 'T65 FALHOU 13ª foto';
  exception when raise_exception then if sqlerrm like 'T65%' then raise; end if; end;
  raise notice 'T65 OK  foto só na pasta do próprio pedido; no máximo 12 por pedido';
end $$;

-- T66: business_of_path entende a pasta e ignora lixo
do $$ begin
  assert public.business_of_path('aaaaaaaa-0000-0000-0000-000000000001/x/y.webp') = 'aaaaaaaa-0000-0000-0000-000000000001', 'T66 uuid';
  assert public.business_of_path('../etc/passwd') is null, 'T66 lixo';
  assert public.business_of_path('') is null, 'T66 vazio';
  raise notice 'T66 OK  pasta do Storage → empresa (caminhos inválidos não dão acesso)';
end $$;

-- ---------------------------------------------------------------- Usuário D (funcionário de A)
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000004', false);
do $$
declare n int;
begin
  assert (select count(*) from public.order_photos) = 12, 'T67 staff não vê fotos';
  delete from public.order_photos where path like '%f12.webp';
  get diagnostics n = row_count;
  assert n = 1, 'T67 staff não apagou';
  raise notice 'T67 OK  funcionário vê, envia e apaga fotos da lavanderia';
end $$;

-- ---------------------------------------------------------------- Usuário B (outra empresa)
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', false);
do $$
declare v uuid; o uuid; n int;
begin
  assert (select count(*) from public.order_photos) = 0, 'T68 B vê fotos de A';
  delete from public.order_photos;
  get diagnostics n = row_count;
  assert n = 0, 'T68 B apagou fotos de A';
  reset role;
  select id into v from public.businesses where slug = 'lavanderia-do-joao';
  select id into o from public.orders where business_id = v order by number limit 1;
  set role authenticated;
  begin
    insert into public.order_photos (business_id, order_id, kind, path) values (v, o, 'antes', v || '/' || o || '/intruso.webp');
    raise exception 'T68 FALHOU B inseriu';
  exception when insufficient_privilege then null; end;
  raise notice 'T68 OK  outra empresa não vê, não envia e não apaga fotos de A';
end $$;

-- ---------------------------------------------------------------- Anônimo
reset role;
set role anon;
select set_config('request.jwt.claim.sub', '', false);
do $$ begin
  begin perform count(*) from public.order_photos; raise exception 'T69 FALHOU';
  exception when insufficient_privilege then null; end;
  raise notice 'T69 OK  visitante anônimo não lê fotos';
end $$;

reset role;
do $$ begin
  assert (select status from public.features where code = 'fotos') = 'disponivel', 'T70 recurso';
  assert not exists (select 1 from public.tables_without_rls()), 'T70 RLS';
  raise notice 'T70 OK  recurso de fotos disponível; RLS em todas as tabelas';
end $$;
