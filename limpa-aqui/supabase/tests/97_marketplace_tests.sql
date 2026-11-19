-- Testes do marketplace, Etapa 3 (prestador no marketplace e busca pública). Roda depois de 96_anunciante_tests.sql.
\set ON_ERROR_STOP on
\set QUIET on

-- ---------------------------------------------------------------- A (dono) prepara a lavanderia
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);

-- T100: sem área de atendimento não aparece; alteração direta bloqueada
do $$
declare v uuid; miss text[];
begin
  select id into v from public.businesses where slug = 'lavanderia-do-joao';
  miss := public.marketplace_requirements(v);
  assert exists (select 1 from unnest(miss) x where x like '%município de atendimento%'), 'T100 falta área: ' || array_to_string(miss, ' | ');
  begin perform public.set_marketplace_visible(v, true); raise exception 'T100 FALHOU ligou sem requisitos';
  exception when raise_exception then if sqlerrm like 'T100%' then raise; end if; end;
  begin update public.businesses set marketplace_visible = true where id = v; raise exception 'T100 FALHOU update direto';
  exception when raise_exception then if sqlerrm like 'T100%' then raise; end if; end;
  begin update public.businesses set accepts_app_payment = true where id = v; raise exception 'T100 FALHOU pagamento app';
  exception when raise_exception then if sqlerrm like 'T100%' then raise; end if; end;
  assert not (select marketplace_visible from public.businesses where id = v), 'T100 visível';
  raise notice 'T100 OK  sem área de atendimento não entra na busca; ninguém liga "aparecer" ou "pagar pelo app" direto';
end $$;

-- T101: com área, serviço e pagamento → aparece; funcionário e outra lavanderia não mexem
do $$
declare v uuid;
begin
  select id into v from public.businesses where slug = 'lavanderia-do-joao';
  insert into public.service_areas (business_id, municipality_id) values (v, 3304904), (v, 3303302);
  update public.businesses set public_description = 'Lavamos tênis com carinho.', offers_pickup = true,
         lat = -22.8268, lng = -43.0634 where id = v;
  update public.services set category_code = 'lavagem_tenis' where business_id = v and id = (select id from public.services where business_id = v and active order by created_at limit 1);
  assert cardinality(public.marketplace_requirements(v)) = 0, 'T101 requisitos: ' || array_to_string(public.marketplace_requirements(v), ' | ');
  perform public.set_marketplace_visible(v, true);
  assert (select marketplace_visible from public.businesses where id = v), 'T101 visível';
  raise notice 'T101 OK  com município, serviço, área e pagamento a lavanderia passa a aparecer';
end $$;

select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000004', false);
do $$
declare v uuid;
begin
  select id into v from public.businesses where slug = 'lavanderia-do-joao';
  assert (select count(*) from public.service_areas where business_id = v) = 2, 'T102 funcionário lê áreas';
  begin perform public.set_marketplace_visible(v, false); raise exception 'T102 FALHOU funcionário desligou';
  exception when insufficient_privilege then null; end;
  begin insert into public.service_areas (business_id, municipality_id) values (v, 3304557); raise exception 'T102 FALHOU funcionário área';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', false);
do $$
declare v uuid;
begin
  reset role;
  select id into v from public.businesses where slug = 'lavanderia-do-joao';
  set role authenticated;
  assert (select count(*) from public.service_areas) = 0, 'T102 outra lavanderia vê áreas de A';
  begin insert into public.service_areas (business_id, municipality_id) values (v, 3304557); raise exception 'T102 FALHOU outra lavanderia';
  exception when insufficient_privilege then null; end;
  delete from public.service_areas where business_id = v;
  begin perform public.set_marketplace_visible(v, false); raise exception 'T102 FALHOU outra desligou';
  exception when insufficient_privilege then null; end;
  reset role;
  assert (select count(*) from public.service_areas where business_id = v) = 2, 'T102 apagou';
  set role authenticated;
  raise notice 'T102 OK  funcionário e outra lavanderia não mudam áreas nem a visibilidade de A';
end $$;

-- Maria (Rio de Janeiro) também aparece em Niterói, mais perto do centro de Niterói
do $$
declare v uuid;
begin
  select id into v from public.businesses where slug = 'maria-sneakers';
  if not exists (select 1 from public.services where business_id = v and active and price > 0) then
    insert into public.services (business_id, name, price) values (v, 'Higienização de tênis', 60);
  end if;
  insert into public.service_areas (business_id, municipality_id) values (v, 3303302);
  update public.businesses set lat = -22.9030, lng = -43.1150 where id = v;
  perform public.set_marketplace_visible(v, true);
end $$;

-- ---------------------------------------------------------------- Visitante sem conta
reset role;
set role anon;
select set_config('request.jwt.claim.sub', '', false);

-- T103: só municípios ativos e com prestador
do $$ begin
  assert exists (select 1 from public.marketplace_municipalities() where id = 3304904 and providers = 1), 'T103 São Gonçalo';
  assert not exists (select 1 from public.marketplace_municipalities() where id = 3303302), 'T103 Niterói ainda não ativo';
  assert not exists (select 1 from public.marketplace_municipalities() where id = 3300100), 'T103 Angra sem prestador';
  assert (select count(*) from public.search_providers(3303302)) = 0, 'T103 busca em município não ativo';
  raise notice 'T103 OK  busca só lista municípios com operação ativa e com prestador; nada em município não ativo';
end $$;

-- admin ativa Niterói
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '14141414-0000-0000-0000-000000000014', false);
select public.admin_set_municipality_status(3303302, 'ativo');
reset role;
set role anon;

-- T104: busca, categoria, distância e perfil público
do $$
declare r record; j jsonb;
begin
  assert (select providers from public.marketplace_municipalities() where id = 3303302) = 2, 'T104 Niterói com 2';
  -- ponto perto do centro do Rio: Maria vem primeiro
  select * into r from public.search_providers(3303302, null, -22.9068, -43.1729) limit 1;
  assert r.slug = 'maria-sneakers' and r.distance_km is not null, 'T104 ordem por distância: ' || coalesce(r.slug, 'nada');
  -- ponto em São Gonçalo: João primeiro
  select * into r from public.search_providers(3303302, null, -22.8270, -43.0630) limit 1;
  assert r.slug = 'lavanderia-do-joao' and r.distance_km < 1, 'T104 João perto';
  assert r.municipality_name = 'São Gonçalo' and r.offers_pickup and r.min_price > 0, 'T104 dados do cartão';
  assert (select count(*) from public.search_providers(3303302, 'higienizacao_sofas')) = 1, 'T104 categoria sofás (só João)';
  assert (select count(*) from public.search_providers(3303302, 'limpeza_cortinas')) = 0, 'T104 categoria cortinas';
  j := public.get_public_provider('lavanderia-do-joao');
  assert j ->> 'name' like 'Lavanderia do João%' and jsonb_array_length(j -> 'services') > 0, 'T104 perfil';
  assert j -> 'areas' ? 'Niterói' and not (j ? 'whatsapp') and not (j ? 'street'), 'T104 perfil sem contato/rua';
  assert position('9888' in j::text) = 0, 'T104 telefone vazou';
  raise notice 'T104 OK  visitante busca por município, categoria e distância e vê o perfil sem rua nem WhatsApp';
end $$;

-- T105: visitante não lê tabelas nem funções internas
do $$ begin
  begin perform count(*) from public.businesses; raise exception 'T105 FALHOU businesses';
  exception when insufficient_privilege then null; end;
  begin perform count(*) from public.service_areas; raise exception 'T105 FALHOU áreas';
  exception when insufficient_privilege then null; end;
  begin perform count(*) from public.services; raise exception 'T105 FALHOU serviços';
  exception when insufficient_privilege then null; end;
  begin perform public.marketplace_requirements(gen_random_uuid()); raise exception 'T105 FALHOU requisitos';
  exception when insufficient_privilege then null; end;
  assert (select count(*) from public.public_categories()) >= 13, 'T105 categorias públicas';
  begin perform count(*) from public.service_categories; raise exception 'T105 FALHOU tabela de categorias';
  exception when insufficient_privilege then null; end;
  raise notice 'T105 OK  visitante só usa a busca e o catálogo de categorias';
end $$;

-- T106: desligou → some; município suspenso → some
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
select public.set_marketplace_visible((select id from public.businesses where slug = 'lavanderia-do-joao'), false);
select set_config('request.jwt.claim.sub', '14141414-0000-0000-0000-000000000014', false);
do $$ begin
  assert (select visible from public.admin_municipality_overview() where id = 3303302) = 1, 'T106 visão admin';
end $$;
select public.admin_set_municipality_status(3303302, 'suspenso');
reset role;
set role anon;
do $$ begin
  assert public.get_public_provider('lavanderia-do-joao') is null, 'T106 perfil de invisível';
  assert (select count(*) from public.search_providers(3304904)) = 0, 'T106 invisível na busca';
  assert (select count(*) from public.search_providers(3303302)) = 0, 'T106 suspenso na busca';
  assert not exists (select 1 from public.marketplace_municipalities() where id in (3303302, 3304904)), 'T106 seletor';
  raise notice 'T106 OK  prestador que desliga some da busca e do perfil; município suspenso some da busca';
end $$;

reset role;
do $$ begin
  assert not exists (select 1 from public.tables_without_rls() where table_name <> 't_tok'), 'T107 RLS';
  assert abs(public.distance_km(-22.9068, -43.1729, -22.8833, -43.1036) - 7.6) < 0.5, 'T107 distância Rio–Niterói';
  raise notice 'T107 OK  distância em km correta; RLS em todas as tabelas';
end $$;
