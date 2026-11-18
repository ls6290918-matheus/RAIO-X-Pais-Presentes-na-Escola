-- Testes do marketplace, Etapa 1 (perfis, admin e municípios). Roda depois de 90_equipe_tests.sql.
\set ON_ERROR_STOP on
\set QUIET on

reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('14141414-0000-0000-0000-000000000014', 'admin@teste.com', '{"full_name":"Ana Admin"}'),
  ('15151515-0000-0000-0000-000000000015', 'entrega@teste.com', '{"full_name":"Edu Entregador"}');
-- o papel de admin só é dado direto no banco
insert into public.user_roles (user_id, role) values ('14141414-0000-0000-0000-000000000014', 'admin');

-- T85: quem já tinha lavanderia virou prestador; tipo do prestador vem do assistente
do $$ begin
  assert exists (select 1 from public.user_roles where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and role = 'prestador' and status = 'ativo'), 'T85 dono';
  assert exists (select 1 from public.user_roles where user_id = 'dddddddd-0000-0000-0000-000000000004' and role = 'prestador'), 'T85 funcionário';
  assert (select count(*) from public.business_members m
          where not exists (select 1 from public.user_roles r where r.user_id = m.user_id and r.role = 'prestador')) = 0, 'T85 todos os membros';
  assert (select provider_type from public.businesses where slug = 'carla-lava-tenis') = 'autonomo', 'T85 tipo autônomo';
  raise notice 'T85 OK  donos e funcionários existentes viraram prestadores; "começar em casa" vira autônomo';
end $$;

-- T86: municípios do RJ e cidade → município
do $$
declare v uuid;
begin
  assert (select count(*) from public.municipalities where state_id = 33) = 92, 'T86 92 municípios';
  assert public.find_municipality('niteroi', 'rj') = 3303302, 'T86 Niterói sem acento';
  assert public.find_municipality(' Rio  de Janeiro ', 'RJ') = 3304557, 'T86 Rio';
  assert public.find_municipality('Armação dos Búzios', 'RJ') = 3300233, 'T86 Búzios';
  assert public.find_municipality('Niterói', 'SP') is null, 'T86 UF errada';
  assert (select count(*) from public.municipalities where status = 'cadastrado') = 92, 'T86 começam só cadastrados';
  raise notice 'T86 OK  92 municípios do RJ; cidade digitada com ou sem acento vira o município certo';
end $$;

set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
do $$
declare v uuid;
begin
  update public.businesses set city = 'São Gonçalo', state = 'RJ' where slug = 'lavanderia-do-joao';
  assert (select municipality_id from public.businesses where slug = 'lavanderia-do-joao') = 3304904, 'T87 município da lavanderia';
  -- o dono não escolhe município nem tipo à mão
  update public.businesses set municipality_id = 3304557, provider_type = 'autonomo' where slug = 'lavanderia-do-joao';
  assert (select municipality_id from public.businesses where slug = 'lavanderia-do-joao') = 3304904, 'T87 município forçado';
  select id into v from public.businesses where slug = 'lavanderia-do-joao';
  insert into public.customers (business_id, name, whatsapp) values (v, 'Cliente Niterói', '21999990000');
  reset role;
  update public.customers set city = 'Niterói', state = 'RJ' where name = 'Cliente Niterói';
  assert (select municipality_id from public.customers where name = 'Cliente Niterói') = 3303302, 'T87 município do cliente';
  set role authenticated;
  raise notice 'T87 OK  município da lavanderia e do cliente sai do endereço; não dá para forçar outro';
end $$;

-- T88: escolher perfis
select set_config('request.jwt.claim.sub', '15151515-0000-0000-0000-000000000015', false);
do $$ begin
  assert public.add_my_role('anunciante') = 'ativo', 'T88 anunciante ativo';
  assert public.add_my_role('entregador') = 'pendente', 'T88 entregador pendente';
  assert public.add_my_role('entregador') = 'pendente', 'T88 repetir não muda';
  begin perform public.add_my_role('admin'); raise exception 'T88 FALHOU virou admin';
  exception when insufficient_privilege then null; end;
  begin insert into public.user_roles (user_id, role) values ('15151515-0000-0000-0000-000000000015', 'admin'); raise exception 'T88 FALHOU insert';
  exception when insufficient_privilege then null; end;
  begin update public.user_roles set status = 'ativo' where role = 'entregador'; raise exception 'T88 FALHOU update';
  exception when insufficient_privilege then null; end;
  assert (select count(*) from public.user_roles) = 2, 'T88 vê só os próprios';
  assert not public.has_role('entregador'), 'T88 pendente não vale';
  raise notice 'T88 OK  anunciante ativo na hora; entregador aguarda aprovação; ninguém se dá admin nem se aprova';
end $$;

-- T89: quem não é admin não administra
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
do $$ begin
  begin perform public.admin_set_municipality_status(3303302, 'ativo'); raise exception 'T89 FALHOU município';
  exception when insufficient_privilege then null; end;
  begin perform public.admin_list_role('entregador'); raise exception 'T89 FALHOU lista';
  exception when insufficient_privilege then null; end;
  begin perform public.admin_set_role_status('15151515-0000-0000-0000-000000000015', 'entregador', 'ativo'); raise exception 'T89 FALHOU aprovar';
  exception when insufficient_privilege then null; end;
  begin perform public.admin_municipality_overview(); raise exception 'T89 FALHOU visão';
  exception when insufficient_privilege then null; end;
  begin update public.municipalities set status = 'ativo'; raise exception 'T89 FALHOU update';
  exception when insufficient_privilege then null; end;
  assert not exists (select 1 from public.user_roles where user_id <> 'aaaaaaaa-0000-0000-0000-000000000001'), 'T89 vê perfis alheios';
  raise notice 'T89 OK  prestador comum não ativa município, não aprova entregador e não vê perfis de outros';
end $$;

-- T90: admin aprova entregador e ativa município
select set_config('request.jwt.claim.sub', '14141414-0000-0000-0000-000000000014', false);
do $$
declare r record;
begin
  select * into r from public.admin_list_role('entregador') where full_name = 'Edu Entregador';
  assert r.status = 'pendente' and r.email = 'entrega@teste.com', 'T90 lista';
  perform public.admin_set_role_status('15151515-0000-0000-0000-000000000015', 'entregador', 'ativo');
  perform public.admin_set_municipality_status(3304904, 'ativo');
  assert (select status from public.municipalities where id = 3304904) = 'ativo', 'T90 município';
  select * into r from public.admin_municipality_overview() where id = 3304904;
  assert r.companies = 1 and r.status = 'ativo', 'T90 visão São Gonçalo';
  begin perform public.admin_set_role_status('14141414-0000-0000-0000-000000000014', 'admin', 'suspenso'); raise exception 'T90 FALHOU admin';
  exception when insufficient_privilege then null; end;
  assert (select count(*) from public.user_roles) >= 4, 'T90 admin vê todos';
  raise notice 'T90 OK  admin aprova entregador, ativa município e vê o resumo; perfil admin não muda pela tela';
end $$;

select set_config('request.jwt.claim.sub', '15151515-0000-0000-0000-000000000015', false);
do $$ begin
  assert public.has_role('entregador'), 'T91 aprovado';
  raise notice 'T91 OK  entregador aprovado passa a valer';
end $$;

-- T92: visitante lê municípios; RLS em tudo
reset role;
set role anon;
do $$ begin
  assert (select count(*) from public.municipalities) = 92, 'T92 anon lê';
  begin perform count(*) from public.user_roles; raise exception 'T92 FALHOU anon perfis';
  exception when insufficient_privilege then null; end;
  begin perform public.add_my_role('anunciante'); raise exception 'T92 FALHOU anon add';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  assert not exists (select 1 from public.tables_without_rls() where table_name <> 't_tok'), 'T92 RLS';
  raise notice 'T92 OK  visitante só lê municípios; RLS em todas as tabelas';
end $$;
