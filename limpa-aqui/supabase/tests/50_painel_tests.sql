-- Testes da Etapa 3 (painel personalizado). Roda depois de 40_onboarding_tests.sql.
\set ON_ERROR_STOP on
\set QUIET on

-- ---------------------------------------------------------------- Usuário C (Carla, dona)
set role authenticated;
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000005', false);

-- T54: restaurar automático desfaz ajustes manuais e volta ao que as regras mandam
do $$
declare v uuid;
begin
  select id into v from public.businesses where slug = 'carla-lava-tenis';
  -- no T45 a dona desligou "entregas" e ligou "orcamento" à mão
  update public.business_features set enabled = false where business_id = v and feature_code = 'pedidos';
  assert (select count(*) from public.business_features where business_id = v and source = 'manual') >= 2, 'T54 sem ajustes manuais';
  perform public.reset_business_features(v);
  assert not exists (select 1 from public.business_features where business_id = v and source = 'manual'), 'T54 sobrou manual';
  assert (select enabled from public.business_features where business_id = v and feature_code = 'pedidos'), 'T54 pedidos não voltou';
  assert (select enabled from public.business_features where business_id = v and feature_code = 'entregas'), 'T54 entregas (regra: faz_entregas) não voltou';
  raise notice 'T54 OK  restaurar automático apaga ajustes manuais e reaplica as regras';
end $$;

-- T55: o dono ativa uma categoria nova depois do cadastro e os recursos dela aparecem
do $$
declare v uuid;
begin
  select id into v from public.businesses where slug = 'carla-lava-tenis';
  insert into public.business_categories (business_id, category_code) values (v, 'limpeza_cortinas')
  on conflict (business_id, category_code) do update set active = true;
  perform public.apply_business_rules(v);
  assert (select source from public.business_categories where business_id = v and category_code = 'limpeza_cortinas') = 'manual', 'T55 origem';
  assert (select enabled from public.business_features where business_id = v and feature_code = 'catalogo_roupas'), 'T55 recurso da categoria';
  -- e cria uma categoria personalizada
  insert into public.business_categories (business_id, custom_name) values (v, 'Restauração de couro');
  assert exists (select 1 from public.business_categories where business_id = v and custom_name = 'Restauração de couro' and active), 'T55 personalizada';
  raise notice 'T55 OK  ativar categoria depois do cadastro liga os recursos dela; categorias personalizadas aceitas';
end $$;

-- ---------------------------------------------------------------- Usuário D (funcionário de A) e B (outra empresa)
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000004', false);
do $$
declare v uuid;
begin
  select id into v from public.businesses where slug = 'lavanderia-do-joao';
  begin perform public.reset_business_features(v); raise exception 'T56 FALHOU staff';
  exception when raise_exception then if sqlerrm like 'T56%' then raise; end if; end;
  begin
    insert into public.business_categories (business_id, category_code) values (v, 'outros');
    raise exception 'T56 FALHOU staff categoria';
  exception when insufficient_privilege then null;
  end;
end $$;

select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', false);
do $$
declare v uuid;
begin
  reset role;
  select id into v from public.businesses where slug = 'carla-lava-tenis';
  set role authenticated;
  begin perform public.reset_business_features(v); raise exception 'T56 FALHOU outra empresa';
  exception when raise_exception then if sqlerrm like 'T56%' then raise; end if; end;
  raise notice 'T56 OK  só o dono restaura ou muda categorias; funcionário e outra empresa não';
end $$;

reset role;
do $$ begin
  assert not exists (select 1 from public.tables_without_rls()), 'T57 RLS';
  raise notice 'T57 OK  RLS em todas as tabelas';
end $$;
