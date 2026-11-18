-- Testes da Etapa 7 (equipe). Roda depois de 80_calculadoras_tests.sql.
\set ON_ERROR_STOP on
\set QUIET on

reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('12121212-0000-0000-0000-000000000012', 'funcionaria@teste.com', '{"full_name":"Paula Funcionária"}'),
  ('13131313-0000-0000-0000-000000000013', 'outra@teste.com', '{"full_name":"Rita Outra"}');

create temporary table t_tok (k text primary key, tok text);
grant all on t_tok to authenticated, anon;

-- ---------------------------------------------------------------- Usuário A (dono)
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);

-- T77: dono cria convites
do $$
declare v uuid; r record;
begin
  select id into v from public.businesses where slug = 'lavanderia-do-joao';
  select * into r from public.create_invite(v, 'Paula');
  assert r.token ~ '^[0-9a-f]{64}$', 'T77 token';
  assert r.expires_at > now() + interval '6 days', 'T77 validade';
  insert into t_tok values ('paula', r.token);
  select * into r from public.create_invite(v, null); insert into t_tok values ('expira', r.token);
  select * into r from public.create_invite(v, null); insert into t_tok values ('cancela', r.token);
  assert (select count(*) from public.team_invites where business_id = v) = 3, 'T77 lista';
  raise notice 'T77 OK  dono cria convites com código secreto que vale 7 dias';
end $$;

-- T78: insert direto e funcionário criando convite são recusados
do $$
declare v uuid;
begin
  select id into v from public.businesses where slug = 'lavanderia-do-joao';
  begin insert into public.team_invites (business_id) values (v); raise exception 'T78 FALHOU insert';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000004', false);
do $$
declare v uuid;
begin
  select id into v from public.businesses where slug = 'lavanderia-do-joao';
  begin perform public.create_invite(v, 'X'); raise exception 'T78 FALHOU staff';
  exception when raise_exception then if sqlerrm like 'T78%' then raise; end if; end;
  assert (select count(*) from public.team_invites) = 0, 'T78 staff vê convites';
  begin perform public.list_team(v); raise exception 'T78 FALHOU staff lista';
  exception when raise_exception then if sqlerrm like 'T78%' then raise; end if; end;
  raise notice 'T78 OK  convite só por RPC e só pelo dono; funcionário não vê convites nem a lista';
end $$;

-- T79: link aberto sem login mostra só o nome da lavanderia
reset role;
set role anon;
select set_config('request.jwt.claim.sub', '', false);
do $$
declare r record;
begin
  select * into r from public.get_invite((select tok from t_tok where k = 'paula'));
  assert r.business_name = 'Lavanderia do João Premium' and r.status = 'valido', 'T79 convite: ' || coalesce(r.status, 'nulo');
  assert not exists (select 1 from public.get_invite('naoexiste')), 'T79 lixo';
  begin perform public.accept_invite((select tok from t_tok where k = 'paula')); raise exception 'T79 FALHOU anon aceitou';
  exception when insufficient_privilege then null; end;
  begin perform count(*) from public.team_invites; raise exception 'T79 FALHOU anon leu';
  exception when insufficient_privilege then null; end;
  raise notice 'T79 OK  visitante vê só o nome da lavanderia e a situação; não aceita nem lista convites';
end $$;

-- T80: aceitar → vira funcionária; não dá para usar duas vezes
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '12121212-0000-0000-0000-000000000012', false);
do $$
declare v uuid;
begin
  -- tinha começado o assistente sozinha
  perform public.save_onboarding_step(1, '{"situation":"autonomo"}');
  v := public.accept_invite((select tok from t_tok where k = 'paula'));
  assert (select role from public.business_members where user_id = '12121212-0000-0000-0000-000000000012') = 'staff', 'T80 staff';
  assert (select slug from public.businesses where id = v) = 'lavanderia-do-joao', 'T80 lavanderia';
  assert not exists (select 1 from public.onboarding_profiles where user_id = '12121212-0000-0000-0000-000000000012'), 'T80 assistente abandonado limpo';
  assert (select count(*) from public.customers) > 0, 'T80 funcionária vê clientes';
  begin perform public.accept_invite((select tok from t_tok where k = 'expira')); raise exception 'T80 FALHOU 2ª lavanderia';
  exception when raise_exception then if sqlerrm like 'T80%' then raise; end if; end;
  raise notice 'T80 OK  convite aceito vira funcionária e já enxerga a lavanderia; não entra em duas';
end $$;

select set_config('request.jwt.claim.sub', '13131313-0000-0000-0000-000000000013', false);
do $$ begin
  begin perform public.accept_invite((select tok from t_tok where k = 'paula')); raise exception 'T81 FALHOU usado';
  exception when raise_exception then if sqlerrm like 'T81%' then raise; end if; end;
end $$;

-- T81: expirado e cancelado não funcionam
reset role;
update public.team_invites set expires_at = now() - interval '1 minute' where token = (select tok from t_tok where k = 'expira');
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
do $$ begin
  perform public.revoke_invite((select id from public.team_invites where token = (select tok from t_tok where k = 'cancela')));
end $$;
select set_config('request.jwt.claim.sub', '13131313-0000-0000-0000-000000000013', false);
do $$ begin
  assert (select status from public.get_invite((select tok from t_tok where k = 'expira'))) = 'expirado', 'T81 status expirado';
  assert (select status from public.get_invite((select tok from t_tok where k = 'cancela'))) = 'cancelado', 'T81 status cancelado';
  assert (select status from public.get_invite((select tok from t_tok where k = 'paula'))) = 'usado', 'T81 status usado';
  begin perform public.accept_invite((select tok from t_tok where k = 'expira')); raise exception 'T81 FALHOU expirado';
  exception when raise_exception then if sqlerrm like 'T81%' then raise; end if; end;
  begin perform public.accept_invite((select tok from t_tok where k = 'cancela')); raise exception 'T81 FALHOU cancelado';
  exception when raise_exception then if sqlerrm like 'T81%' then raise; end if; end;
  assert not exists (select 1 from public.business_members where user_id = '13131313-0000-0000-0000-000000000013'), 'T81 entrou';
  raise notice 'T81 OK  convite usado, expirado ou cancelado não funciona';
end $$;

-- T82: dono vê a equipe e remove a funcionária; não remove a si mesmo
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
do $$
declare v uuid; m uuid; o uuid;
begin
  select id into v from public.businesses where slug = 'lavanderia-do-joao';
  assert (select count(*) from public.list_team(v)) = 3, 'T82 dono + Pedro + Paula';
  assert (select email from public.list_team(v) where full_name = 'Paula Funcionária') = 'funcionaria@teste.com', 'T82 e-mail';
  select member_id into m from public.list_team(v) where full_name = 'Paula Funcionária';
  select member_id into o from public.list_team(v) where role = 'owner';
  begin perform public.remove_member(o); raise exception 'T82 FALHOU removeu dono';
  exception when raise_exception then if sqlerrm like 'T82%' then raise; end if; end;
  perform public.remove_member(m);
  assert (select count(*) from public.list_team(v)) = 2, 'T82 removida';
  raise notice 'T82 OK  dono vê nome e e-mail da equipe e remove funcionário; não pode se remover';
end $$;

-- T83: outra empresa não vê nem mexe na equipe de A
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', false);
do $$
declare v uuid; m uuid;
begin
  reset role;
  select id into v from public.businesses where slug = 'lavanderia-do-joao';
  select id into m from public.business_members where user_id = 'dddddddd-0000-0000-0000-000000000004';
  set role authenticated;
  assert (select count(*) from public.team_invites) = 0, 'T83 vê convites';
  begin perform public.list_team(v); raise exception 'T83 FALHOU lista';
  exception when raise_exception then if sqlerrm like 'T83%' then raise; end if; end;
  begin perform public.remove_member(m); raise exception 'T83 FALHOU remove';
  exception when raise_exception then if sqlerrm like 'T83%' then raise; end if; end;
  begin perform public.create_invite(v, 'x'); raise exception 'T83 FALHOU convida';
  exception when raise_exception then if sqlerrm like 'T83%' then raise; end if; end;
  raise notice 'T83 OK  outra empresa não vê, não convida e não remove ninguém da equipe de A';
end $$;

reset role;
do $$ begin
  assert (select status = 'disponivel' and route = '/app/equipe' from public.features where code = 'equipe'), 'T84 recurso';
  assert not exists (select 1 from public.tables_without_rls() where table_name <> 't_tok'), 'T84 RLS';
  raise notice 'T84 OK  equipe disponível; RLS em todas as tabelas';
end $$;
