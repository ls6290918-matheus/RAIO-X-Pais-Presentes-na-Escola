-- Testes da Fase 1 do PRD Mestre: categorias do admin e perfil de trabalho. Roda por último.
\set ON_ERROR_STOP on
\set QUIET on

reset role;
set role authenticated;

-- T158: admin gerencia categorias; categoria desativada some da busca e não aceita anúncio novo
select set_config('request.jwt.claim.sub', '14141414-0000-0000-0000-000000000014', false);
do $$ begin
  assert (select count(*) from public.admin_categories() where code in ('lavagem_tapetes', 'higienizacao_calcados')) = 2, 'T158 novas categorias';
  perform public.admin_upsert_category('lavagem_carpetes', 'Lavagem de carpetes', 'casa', '{m2}', null, true, 'Carpetes e passadeiras');
  assert (select active from public.admin_categories() where code = 'lavagem_carpetes'), 'T158 criada ativa';
  assert exists (select 1 from public.public_categories() where code = 'lavagem_carpetes'), 'T158 aparece na busca';
  perform public.admin_upsert_category('lavagem_carpetes', 'Carpetes', 'casa', '{m2,peca}', 5, false);
  assert (select name from public.admin_categories() where code = 'lavagem_carpetes') = 'Carpetes', 'T158 nome alterado';
  assert not exists (select 1 from public.public_categories() where code = 'lavagem_carpetes'), 'T158 desativada some da busca';
  perform public.admin_upsert_category('lavagem_tenis', 'Lavagem de tênis', 'calcados', '{par}', null, false);
  begin perform public.admin_upsert_category('Código Ruim', 'X Y', 'casa', '{m2}'); raise exception 'T158 FALHOU código';
  exception when invalid_parameter_value then null; end;
  begin perform public.admin_upsert_category('abc', 'Nome', 'grupo_x', '{m2}'); raise exception 'T158 FALHOU grupo';
  exception when invalid_parameter_value then null; end;
end $$;
-- cliente não publica anúncio em categoria desativada
select set_config('request.jwt.claim.sub', '17171717-0000-0000-0000-000000000017', false);
do $$ declare a uuid; begin
  select id into a from public.user_addresses where user_id = auth.uid() limit 1;
  begin perform public.create_listing('lavagem_tenis', 'Lavar mais tênis brancos', null, a, false); raise exception 'T158 FALHOU anúncio';
  exception when invalid_parameter_value then null; end;
end $$;
-- dono comum não mexe em categorias
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
do $$ begin
  begin perform public.admin_upsert_category('qualquer', 'Qualquer', 'casa', '{m2}'); raise exception 'T158 FALHOU dono';
  exception when insufficient_privilege then null; end;
  begin perform public.admin_categories(); raise exception 'T158 FALHOU dono lista';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub', '14141414-0000-0000-0000-000000000014', false);
do $$ begin
  perform public.admin_upsert_category('lavagem_tenis', 'Lavagem de tênis', 'calcados', '{par}', null, true);
  raise notice 'T158 OK  admin cria, edita e desativa categorias; desativada some da busca e não aceita anúncio; só o admin';
end $$;

-- T159: perfil de trabalho (equipamentos, capacidade, experiência) só pelo dono
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
do $$ declare b uuid; begin
  select business_id into b from public.business_members where user_id = auth.uid() and role = 'owner' limit 1;
  perform public.set_work_profile(b, '{maquina_lavar,ferro_passar,maquina_lavar}', 15, '  5 anos lavando tênis  ');
  assert (select equipment from public.businesses where id = b) = '{ferro_passar,maquina_lavar}'::text[], 'T159 equipamentos sem repetição';
  assert (select daily_capacity from public.businesses where id = b) = 15, 'T159 capacidade';
  assert (select experience from public.businesses where id = b) = '5 anos lavando tênis', 'T159 experiência';
  begin perform public.set_work_profile(b, '{foguete}', 15, null); raise exception 'T159 FALHOU equipamento inválido';
  exception when check_violation then null; end;
  begin perform public.set_work_profile(b, '{}', 0, null); raise exception 'T159 FALHOU capacidade';
  exception when check_violation then null; end;
  insert into t_ids values ('biz_a_fase1', b);
end $$;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', false);
do $$ begin
  begin perform public.set_work_profile((select id from t_ids where k = 'biz_a_fase1'), '{}', 10, null); raise exception 'T159 FALHOU outro dono';
  exception when insufficient_privilege then null; end;
  raise notice 'T159 OK  perfil de trabalho: equipamentos válidos sem repetição, capacidade e experiência; só o dono';
end $$;
reset role;
