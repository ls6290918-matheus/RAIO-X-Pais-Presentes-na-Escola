-- Testes da Etapa 1. Cada bloco falha (RAISE) se o comportamento não for o esperado.
\set ON_ERROR_STOP on
\set QUIET on

-- Usuários de teste (como o Supabase Auth faria)
insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'joao@teste.com',  '{"full_name":"João Silva"}'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'maria@teste.com', '{"full_name":"Maria Souza"}'),
  ('cccccccc-0000-0000-0000-000000000003', 'sem@teste.com',   '{}');

-- T01: trigger criou os perfis
do $$ begin
  assert (select count(*) from public.profiles) = 3, 'T01 perfis não criados';
  assert (select full_name from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000001') = 'João Silva', 'T01 nome do perfil';
  raise notice 'T01 OK  perfis criados pelo trigger de cadastro';
end $$;

-- T02: nenhuma tabela pública sem RLS
do $$ begin
  assert not exists (select 1 from public.tables_without_rls()), 'T02 há tabela sem RLS';
  raise notice 'T02 OK  todas as tabelas do schema public têm RLS';
end $$;

-- ---------------------------------------------------------------- Usuário A
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);

-- T03: slug inválido / reservado / ok
do $$ begin
  assert public.check_slug_available('ab') = 'invalid', 'T03 curto';
  assert public.check_slug_available('Lava Joao') = 'invalid', 'T03 espaço';
  assert public.check_slug_available('-joao') = 'invalid', 'T03 hífen inicial';
  assert public.check_slug_available('joao--lava') = 'invalid', 'T03 hífen duplo';
  assert public.check_slug_available('rastrear') = 'reserved', 'T03 reservado';
  assert public.check_slug_available('lavanderia-do-joao') = 'ok', 'T03 ok';
  raise notice 'T03 OK  validação de endereço público (inválido, reservado, livre)';
end $$;

-- T04: insert direto em businesses é negado (só via RPC)
do $$ begin
  begin
    insert into public.businesses (name, slug, created_by)
    values ('Hack', 'hack-direto', 'aaaaaaaa-0000-0000-0000-000000000001');
    raise exception 'T04 FALHOU: insert direto permitido';
  exception when insufficient_privilege then
    raise notice 'T04 OK  insert direto em businesses negado';
  end;
end $$;

-- T05: criar lavanderia via RPC
do $$
declare v uuid;
begin
  v := public.create_business('Lavanderia do João', 'lavanderia-do-joao', '(11) 98888-7777', 'São Paulo', 'sp', 'Mooca');
  assert (select role from public.business_members where business_id = v) = 'owner', 'T05 dono';
  assert (select whatsapp from public.businesses where id = v) = '11988887777', 'T05 whatsapp normalizado';
  assert (select state from public.businesses where id = v) = 'SP', 'T05 UF maiúscula';
  assert (select default_due_days from public.business_settings where business_id = v) = 3, 'T05 settings';
  raise notice 'T05 OK  create_business cria lavanderia + dono + configurações';
end $$;

-- T06: segundo cadastro do mesmo usuário é recusado
do $$ begin
  begin
    perform public.create_business('Outra', 'outra-do-joao');
    raise exception 'T06 FALHOU';
  exception when raise_exception then
    if sqlerrm like 'T06%' then raise; end if;
    raise notice 'T06 OK  usuário não cria segunda lavanderia (%)', sqlerrm;
  end;
end $$;

-- T07: dono atualiza dados permitidos, mas não slug nem numeração
do $$ begin
  update public.businesses set name = 'Lavanderia do João Premium', city = 'Santo André'
  where slug = 'lavanderia-do-joao';
  assert (select name from public.businesses where slug = 'lavanderia-do-joao') = 'Lavanderia do João Premium', 'T07 nome';
  begin
    update public.businesses set slug = 'novo-slug' where slug = 'lavanderia-do-joao';
    raise exception 'T07 FALHOU slug alterado';
  exception when raise_exception then
    if sqlerrm like 'T07%' then raise; end if;
  end;
  begin
    update public.businesses set next_order_number = 999 where slug = 'lavanderia-do-joao';
    raise exception 'T07 FALHOU numeração alterada';
  exception when raise_exception then
    if sqlerrm like 'T07%' then raise; end if;
  end;
  update public.business_settings set default_due_days = 5;
  assert (select default_due_days from public.business_settings) = 5, 'T07 prazo';
  raise notice 'T07 OK  dono edita dados; slug e numeração protegidos';
end $$;

-- T08: inserir membro direto é negado (impede se adicionar em outra lavanderia)
do $$ begin
  begin
    insert into public.business_members (business_id, user_id, role)
    select id, 'aaaaaaaa-0000-0000-0000-000000000001', 'owner' from public.businesses limit 1;
    raise exception 'T08 FALHOU';
  exception when insufficient_privilege then
    raise notice 'T08 OK  insert direto em business_members negado';
  end;
end $$;

-- ---------------------------------------------------------------- Usuário B
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', false);

-- T09: slug já usado é recusado
do $$ begin
  assert public.check_slug_available('lavanderia-do-joao') = 'taken', 'T09 taken';
  begin
    perform public.create_business('Copia', 'lavanderia-do-joao');
    raise exception 'T09 FALHOU';
  exception when unique_violation then
    raise notice 'T09 OK  endereço já usado é recusado';
  end;
end $$;

do $$ begin
  perform public.create_business('Maria Sneakers', 'maria-sneakers', '21977776666', 'Rio de Janeiro', 'RJ', 'Tijuca');
end $$;

-- T10: ISOLAMENTO — B não vê nada de A
do $$ begin
  assert (select count(*) from public.businesses) = 1, 'T10 B vê mais de uma lavanderia';
  assert (select slug from public.businesses) = 'maria-sneakers', 'T10 B vê lavanderia errada';
  assert (select count(*) from public.business_members) = 1, 'T10 membros';
  assert (select count(*) from public.business_settings) = 1, 'T10 settings';
  assert (select count(*) from public.profiles) = 1, 'T10 perfis';
  raise notice 'T10 OK  usuário B só enxerga os próprios dados';
end $$;

-- T11: ISOLAMENTO — B não altera A, mesmo mirando o id de A
do $$
declare v_a uuid; n int;
begin
  reset role;
  select id into v_a from public.businesses where slug = 'lavanderia-do-joao';
  set role authenticated;
  update public.businesses set name = 'HACKEADO' where id = v_a;
  get diagnostics n = row_count;
  assert n = 0, 'T11 B alterou lavanderia de A';
  update public.business_settings set default_due_days = 30 where business_id = v_a;
  get diagnostics n = row_count;
  assert n = 0, 'T11 B alterou settings de A';
  update public.profiles set full_name = 'HACK' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  assert n = 0, 'T11 B alterou perfil de A';
  assert public.is_business_member(v_a) = false, 'T11 is_member';
  raise notice 'T11 OK  usuário B não altera dados de A, mesmo com o id forjado';
end $$;

-- T12: delete direto negado
do $$ begin
  begin
    delete from public.businesses;
    raise exception 'T12 FALHOU';
  exception when insufficient_privilege then
    raise notice 'T12 OK  exclusão direta negada';
  end;
end $$;

-- ---------------------------------------------------------------- Usuário C (sem lavanderia)
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', false);
do $$ begin
  assert (select count(*) from public.businesses) = 0, 'T13 C vê lavanderias';
  assert (select count(*) from public.business_members) = 0, 'T13 C vê membros';
  raise notice 'T13 OK  usuário sem lavanderia não vê nada (vai para o onboarding)';
end $$;

-- ---------------------------------------------------------------- Anônimo
reset role;
set role anon;
select set_config('request.jwt.claim.sub', '', false);
do $$ begin
  begin
    perform count(*) from public.businesses;
    raise exception 'T14 FALHOU anon leu businesses';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.create_business('Anon', 'anon-lava');
    raise exception 'T14 FALHOU anon criou';
  exception when insufficient_privilege then null;
  end;
  raise notice 'T14 OK  visitante anônimo não lê tabelas nem cria lavanderia';
end $$;

-- ---------------------------------------------------------------- Usuário autenticado sem sub
reset role;
do $$ begin
  -- dados de A continuam intactos após as tentativas de B
  assert (select name from public.businesses where slug = 'lavanderia-do-joao') = 'Lavanderia do João Premium', 'T15 A alterado';
  assert (select default_due_days from public.business_settings s join public.businesses b on b.id = s.business_id where b.slug = 'lavanderia-do-joao') = 5, 'T15 settings A';
  raise notice 'T15 OK  dados de A intactos após as tentativas de B';
end $$;
