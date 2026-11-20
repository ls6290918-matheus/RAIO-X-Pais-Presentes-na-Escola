-- Testes do onboarding dinâmico. Roda depois de 30_enderecos_tests.sql.
-- Usuários: A = dono da "lavanderia-do-joao", B = dona da "maria-sneakers",
-- C = sem lavanderia (faz o assistente do zero), D = funcionário de A.
\set ON_ERROR_STOP on
\set QUIET on

reset role;

-- T38: catálogo e RLS
do $$ begin
  assert not exists (select 1 from public.tables_without_rls()), 'T38 há tabela sem RLS';
  assert (select count(*) from public.service_categories) >= 13, 'T38 categorias';
  assert (select count(*) from public.service_templates) >= 15, 'T38 sugestões';
  assert exists (select 1 from public.feature_rules where trigger_type = 'categoria' and trigger_value = 'lavagem_tenis' and feature_code = 'campos_calcado'), 'T38 regra tênis';
  raise notice 'T38 OK  catálogo com 13 categorias, sugestões e regras; RLS em todas as tabelas';
end $$;

-- ---------------------------------------------------------------- Anônimo
set role anon;
select set_config('request.jwt.claim.sub', '', false);
do $$ begin
  begin perform count(*) from public.service_categories; raise exception 'T39 FALHOU catálogo';
  exception when insufficient_privilege then null; end;
  begin perform public.save_onboarding_step(1, '{}'); raise exception 'T39 FALHOU save';
  exception when insufficient_privilege then null; end;
  begin perform public.complete_onboarding(); raise exception 'T39 FALHOU complete';
  exception when insufficient_privilege then null; end;
  raise notice 'T39 OK  visitante anônimo não lê o catálogo nem usa o assistente';
end $$;
reset role;

-- ---------------------------------------------------------------- Usuário C (assistente do zero)
insert into auth.users (id, email, raw_user_meta_data) values
  ('eeeeeeee-0000-0000-0000-000000000005', 'iniciante@teste.com', '{"full_name":"Carla Iniciante"}');
set role authenticated;
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000005', false);

-- T40: salvamento por etapa, sem apagar o que já foi respondido
do $$
declare p public.onboarding_profiles;
begin
  p := public.save_onboarding_step(1, '{"situation":"comecar_em_casa"}');
  assert p.situation = 'comecar_em_casa' and p.current_step = 1, 'T40 etapa 1';
  p := public.save_onboarding_step(2, '{"categories":["lavagem_tenis","passadoria"],"custom_categories":["Tingimento"]}');
  assert p.situation = 'comecar_em_casa', 'T40 manteve etapa 1';
  assert p.categories = array['lavagem_tenis', 'passadoria'], 'T40 categorias';
  p := public.save_onboarding_step(3, '{"operations":["trabalho_em_casa","faz_entregas","sozinho"]}');
  p := public.save_onboarding_step(4, '{"has_clients":false,"team":"sozinho","service_region":"Zona Leste"}');
  assert p.current_step = 4 and p.has_clients = false and p.service_region = 'Zona Leste', 'T40 etapa 4';
  -- voltar uma etapa e mudar a resposta
  p := public.save_onboarding_step(2, '{"categories":["lavagem_tenis","passadoria","lavagem_roupas"]}');
  assert p.current_step = 2 and cardinality(p.categories) = 3 and p.operations @> array['faz_entregas'], 'T40 voltar e alterar';
  raise notice 'T40 OK  cada etapa salva só o que mudou; dá para voltar e alterar';
end $$;

-- T41: respostas inválidas são recusadas
do $$ begin
  begin perform public.save_onboarding_step(2, '{"categories":["inventada"]}'); raise exception 'T41 FALHOU categoria';
  exception when invalid_parameter_value then null; end;
  begin perform public.save_onboarding_step(1, '{"situation":"astronauta"}'); raise exception 'T41 FALHOU situação';
  exception when invalid_parameter_value then null; end;
  begin perform public.save_onboarding_step(3, '{"operations":["teletransporte"]}'); raise exception 'T41 FALHOU operação';
  exception when invalid_parameter_value then null; end;
  assert (select cardinality(categories) from public.onboarding_profiles) = 3, 'T41 respostas válidas preservadas';
  raise notice 'T41 OK  categoria, situação e operação fora das opções são recusadas';
end $$;

-- T42: concluir cria a lavanderia, grava a identidade e aplica as regras
do $$
declare v uuid; b public.businesses;
begin
  perform public.save_onboarding_step(5, jsonb_build_object('draft', jsonb_build_object(
    'name', 'Carla Lava Tênis', 'slug', 'carla-lava-tenis', 'whatsapp', '(11) 97777-0000',
    'email', 'Contato@CarlaTenis.com', 'city', 'São Paulo', 'state', 'sp',
    'opening_hours', jsonb_build_object('seg', '09:00-18:00', 'sab', '09:00-13:00'))));
  v := public.complete_onboarding();
  select * into b from public.businesses where id = v;
  assert b.slug = 'carla-lava-tenis' and b.email = 'contato@carlatenis.com', 'T42 identidade';
  assert b.service_region = 'Zona Leste' and b.opening_hours ->> 'sab' = '09:00-13:00', 'T42 região e horário';
  assert b.segment = 'iniciante', 'T42 segmento';
  assert (select role from public.business_members where business_id = v) = 'owner', 'T42 dono';
  assert (select completed_at is not null and business_id = v from public.onboarding_profiles), 'T42 perfil concluído';
  raise notice 'T42 OK  concluir cria a lavanderia com identidade, região, horário e segmento iniciante';
end $$;

-- T43: recursos e categorias saem das regras
do $$
declare v uuid; f text[];
begin
  select id into v from public.businesses;
  select array_agg(feature_code order by feature_code) into f from public.business_features where enabled;
  assert f @> array['pedidos','clientes','servicos','checklist'], 'T43 sempre';
  assert f @> array['campos_calcado','fotos'], 'T43 tênis';
  assert f @> array['catalogo_roupas'], 'T43 passadoria/roupas';
  assert f @> array['entregas'], 'T43 entregas';
  assert f @> array['calculadoras','pagina_publica'], 'T43 iniciante';
  assert not (f && array['equipe','orcamento','indicadores']), 'T43 não deveria habilitar ' || array_to_string(f, ',');
  assert (select count(*) from public.business_categories where business_id = v and active) = 4, 'T43 3 do catálogo + 1 personalizada';
  assert exists (select 1 from public.business_categories where custom_name = 'Tingimento'), 'T43 personalizada';
  raise notice 'T43 OK  tênis → ficha do calçado e fotos; roupas → catálogo; entregas → central; iniciante → calculadoras';
end $$;

-- T44: aplicar de novo não muda nada (idempotente)
do $$
declare v uuid; n1 int; n2 int; c1 int; c2 int;
begin
  select id into v from public.businesses;
  select count(*) into n1 from public.business_features where business_id = v and enabled;
  select count(*) into c1 from public.business_categories where business_id = v;
  perform public.apply_business_rules(v);
  perform public.apply_business_rules(v);
  select count(*) into n2 from public.business_features where business_id = v and enabled;
  select count(*) into c2 from public.business_categories where business_id = v;
  assert n1 = n2 and c1 = c2, 'T44 mudou ao reaplicar';
  raise notice 'T44 OK  reaplicar as regras não duplica nem altera nada';
end $$;

-- T45: ajustes manuais do dono são respeitados no recálculo
do $$
declare v uuid;
begin
  select id into v from public.businesses;
  update public.business_features set enabled = false where business_id = v and feature_code = 'entregas';
  insert into public.business_features (business_id, feature_code, enabled) values (v, 'orcamento', true);
  assert (select source from public.business_features where business_id = v and feature_code = 'entregas') = 'manual', 'T45 virou manual';
  perform public.apply_business_rules(v);
  assert not (select enabled from public.business_features where business_id = v and feature_code = 'entregas'), 'T45 regra religou entregas';
  assert (select enabled from public.business_features where business_id = v and feature_code = 'orcamento'), 'T45 regra desligou orçamento manual';
  raise notice 'T45 OK  o que o dono liga ou desliga à mão continua assim depois de recalcular';
end $$;

-- T46: mudar as respostas depois atualiza a configuração
do $$
declare v uuid;
begin
  select id into v from public.businesses;
  perform public.save_onboarding_step(2, '{"categories":["lavagem_roupas","higienizacao_sofas"]}');
  perform public.save_onboarding_step(4, '{"team":"2_5"}');
  perform public.apply_business_rules(v);
  assert not (select enabled from public.business_features where business_id = v and feature_code = 'campos_calcado'), 'T46 tênis continuou';
  assert (select enabled from public.business_features where business_id = v and feature_code = 'dimensoes_item'), 'T46 sofá';
  assert (select enabled from public.business_features where business_id = v and feature_code = 'equipe'), 'T46 equipe';
  assert not (select active from public.business_categories where business_id = v and category_code = 'lavagem_tenis'), 'T46 categoria desativada';
  -- o dono reativa uma categoria à mão; ela passa a valer nas regras
  update public.business_categories set active = true where business_id = v and category_code = 'lavagem_tenis';
  perform public.apply_business_rules(v);
  assert (select enabled from public.business_features where business_id = v and feature_code = 'campos_calcado'), 'T46 reativação manual';
  raise notice 'T46 OK  alterar categorias e equipe reconfigura; categoria reativada à mão vale nas regras';
end $$;

-- T47: checklist calculado dos dados reais
do $$
declare v uuid;
begin
  select id into v from public.businesses;
  assert not (select done from public.get_setup_checklist(v) where code = 'servicos'), 'T47 serviços antes';
  assert (select done from public.get_setup_checklist(v) where code = 'dados'), 'T47 dados (WhatsApp, cidade e região)';
  insert into public.services (business_id, name, price, category_code, pricing_unit) values (v, 'Higienização de sofá', 0, 'higienizacao_sofas', 'orcamento');
  insert into public.services (business_id, name, price, category_code, pricing_unit) values (v, 'Lavagem por quilo', 0, 'lavagem_roupas', 'kg');
  assert (select done from public.get_setup_checklist(v) where code = 'servicos'), 'T47 serviços depois';
  assert not (select done from public.get_setup_checklist(v) where code = 'precos'), 'T47 preço zerado não conta';
  update public.services set price = 12.5 where business_id = v and name = 'Lavagem por quilo';
  assert (select done from public.get_setup_checklist(v) where code = 'precos'), 'T47 preços definidos';
  assert not (select done or available from public.get_setup_checklist(v) where code = 'pagina_publica'), 'T47 página pública ainda em breve';
  assert not (select done from public.get_setup_checklist(v) where code = 'pedido'), 'T47 pedido';
  raise notice 'T47 OK  checklist só marca o que existe de verdade (serviço, preço > 0, cliente, pedido)';
end $$;

-- T48: unidade de cobrança e categoria inválida no serviço
do $$ begin
  begin
    insert into public.services (business_id, name, price, category_code) select id, 'Serviço teste', 1, 'nao_existe' from public.businesses;
    raise exception 'T48 FALHOU';
  exception when foreign_key_violation then null;
  end;
  assert (select pricing_unit from public.services where name = 'Lavagem por quilo') = 'kg', 'T48 unidade';
  raise notice 'T48 OK  serviço guarda categoria e unidade de cobrança; categoria inexistente é recusada';
end $$;

-- T49: um segundo concluir não cria outra lavanderia
do $$
declare v1 uuid; v2 uuid;
begin
  select id into v1 from public.businesses;
  v2 := public.complete_onboarding();
  assert v1 = v2, 'T49 criou outra';
  assert (select count(*) from public.business_members where user_id = 'eeeeeeee-0000-0000-0000-000000000005') = 1, 'T49 membros';
  raise notice 'T49 OK  concluir de novo reconfigura a mesma lavanderia';
end $$;

-- ---------------------------------------------------------------- Usuário A (empresa antiga, modo "Personalizar")
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);

-- T50: empresa existente personaliza sem perder endereço público nem dados
do $$
declare v uuid; antes public.businesses;
begin
  select * into antes from public.businesses where slug = 'lavanderia-do-joao';
  perform public.save_onboarding_step(1, '{"situation":"lavanderia"}');
  perform public.save_onboarding_step(2, '{"categories":["lavagem_tenis"]}');
  perform public.save_onboarding_step(3, '{"operations":["estabelecimento","com_funcionarios"]}');
  perform public.save_onboarding_step(5, '{"draft":{"slug":"tentando-mudar","service_region":"Mooca e Tatuapé"}}');
  v := public.complete_onboarding();
  assert v = antes.id, 'T50 outra lavanderia';
  assert (select slug from public.businesses where id = v) = 'lavanderia-do-joao', 'T50 slug mudou';
  assert (select name from public.businesses where id = v) = antes.name, 'T50 nome apagado';
  assert (select street from public.businesses where id = v) = 'Rua da Mooca', 'T50 endereço apagado';
  assert (select segment from public.businesses where id = v) = 'empresa', 'T50 segmento empresa (funcionários)';
  assert (select enabled from public.business_features where business_id = v and feature_code = 'equipe'), 'T50 equipe';
  raise notice 'T50 OK  lavanderia existente personaliza o painel sem mudar endereço público nem perder dados';
end $$;

-- ---------------------------------------------------------------- Usuário D (funcionário de A)
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000004', false);

-- T51: funcionário vê a configuração, mas não altera
do $$
declare v uuid; n int;
begin
  select id into v from public.businesses where slug = 'lavanderia-do-joao';
  assert (select count(*) from public.business_features where business_id = v) > 0, 'T51 staff não lê recursos';
  update public.business_features set enabled = false where business_id = v;
  get diagnostics n = row_count;
  assert n = 0, 'T51 staff alterou recursos';
  update public.business_categories set active = false where business_id = v;
  get diagnostics n = row_count;
  assert n = 0, 'T51 staff alterou categorias';
  begin perform public.apply_business_rules(v); raise exception 'T51 FALHOU apply';
  exception when raise_exception then if sqlerrm like 'T51%' then raise; end if; end;
  -- o funcionário também não "refaz" o assistente da empresa
  perform public.save_onboarding_step(1, '{"situation":"empresa_limpeza"}');
  perform public.save_onboarding_step(2, '{"categories":["outros"]}');
  begin perform public.complete_onboarding(); raise exception 'T51 FALHOU complete';
  exception when raise_exception then if sqlerrm like 'T51%' then raise; end if; end;
  raise notice 'T51 OK  funcionário vê a configuração, mas só o dono altera ou refaz o assistente';
end $$;

-- ---------------------------------------------------------------- Usuário B (outra empresa)
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', false);

-- T52: ISOLAMENTO
do $$
declare v_c uuid; n int;
begin
  reset role;
  select id into v_c from public.businesses where slug = 'carla-lava-tenis';
  set role authenticated;
  assert (select count(*) from public.business_features where business_id = v_c) = 0, 'T52 B vê recursos de C';
  assert (select count(*) from public.business_categories where business_id = v_c) = 0, 'T52 B vê categorias de C';
  assert (select count(*) from public.onboarding_profiles) = 0, 'T52 B vê respostas de outros';
  assert (select count(*) from public.get_setup_checklist(v_c)) = 0, 'T52 B vê checklist de C';
  update public.business_features set enabled = false where business_id = v_c;
  get diagnostics n = row_count;
  assert n = 0, 'T52 B alterou C';
  begin
    insert into public.business_categories (business_id, category_code) values (v_c, 'outros');
    raise exception 'T52 FALHOU insert';
  exception when insufficient_privilege then null;
  end;
  begin perform public.apply_business_rules(v_c); raise exception 'T52 FALHOU apply';
  exception when raise_exception then if sqlerrm like 'T52%' then raise; end if; end;
  raise notice 'T52 OK  usuário B não vê nem altera configuração, respostas ou checklist de outra empresa';
end $$;

reset role;
do $$ begin
  assert (select count(*) from public.businesses) = 3, 'T53 número de lavanderias';
  assert not exists (select 1 from public.tables_without_rls()), 'T53 RLS';
  raise notice 'T53 OK  nenhuma lavanderia extra criada; RLS em todas as tabelas';
end $$;
