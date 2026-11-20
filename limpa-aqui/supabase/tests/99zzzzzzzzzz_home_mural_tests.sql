-- Testes da Etapa 5: banners e anúncio com quantidade, prazo e fotos. Roda por último.
\set ON_ERROR_STOP on
\set QUIET on

reset role;
set role authenticated;

-- T161: banners — só o admin cria; a home só vê os ativos e dentro do período
select set_config('request.jwt.claim.sub', '14141414-0000-0000-0000-000000000014', false);
do $$ declare b1 uuid; b2 uuid; b3 uuid; begin
  b1 := public.admin_upsert_banner(null, 'Tênis limpos em 48h', 'Veja quem lava perto de você', '/buscar?c=lavagem_tenis', 'agua', true);
  b2 := public.admin_upsert_banner(null, 'Desativado', null, null, 'petroleo', false);
  b3 := public.admin_upsert_banner(null, 'Futuro', null, '/buscar', 'claro', true, now() + interval '2 days', now() + interval '5 days');
  assert (select count(*) from public.admin_banners()) >= 3, 'T161 lista do admin';
  perform public.admin_upsert_banner(b1, 'Tênis limpos em 48h!', 'Veja quem lava perto de você', '/buscar?c=lavagem_tenis', 'agua', true, null, null, 1);
  begin perform public.admin_upsert_banner(null, 'Externo', null, 'https://golpe.com', 'agua', true); raise exception 'T161 FALHOU link externo';
  exception when invalid_parameter_value or check_violation then null; end;
  insert into t_ids values ('banner_off', b2);
end $$;
reset role;
set role anon;
do $$ begin
  assert (select count(*) from public.public_banners() where title = 'Tênis limpos em 48h!') = 1, 'T161 visitante vê o ativo';
  assert not exists (select 1 from public.public_banners() where title in ('Desativado', 'Futuro')), 'T161 desativado/futuro escondidos';
end $$;
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
do $$ begin
  begin perform public.admin_upsert_banner(null, 'Meu banner', null, null, 'agua', true); raise exception 'T161 FALHOU dono';
  exception when insufficient_privilege then null; end;
  begin perform public.admin_delete_banner((select id from t_ids where k = 'banner_off')); raise exception 'T161 FALHOU apagar';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.banners; raise exception 'T161 FALHOU tabela direta';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub', '14141414-0000-0000-0000-000000000014', false);
do $$ begin
  perform public.admin_delete_banner((select id from t_ids where k = 'banner_off'));
  assert not exists (select 1 from public.admin_banners() where title = 'Desativado'), 'T161 apagado';
  raise notice 'T161 OK  banners: só o admin cria/edita/apaga; link só interno; visitante vê só os ativos no período';
end $$;

-- T162: anúncio com quantidade, prazo e fotos; fotos só para quem pode ver o anúncio
select set_config('request.jwt.claim.sub', '17171717-0000-0000-0000-000000000017', false);
do $$ declare a uuid; l uuid; begin
  select id into a from public.user_addresses where user_id = auth.uid() limit 1;
  l := public.create_listing('lavagem_tenis', 'Lavar 3 pares de tênis brancos', null, a, true);
  insert into t_ids values ('listing_fotos', l);
  perform public.set_listing_details(l, 3, (now() at time zone 'America/Sao_Paulo')::date + 3);
  begin perform public.set_listing_details(l, 3, (now() at time zone 'America/Sao_Paulo')::date - 1); raise exception 'T162 FALHOU prazo passado';
  exception when invalid_parameter_value then null; end;
  begin perform public.set_listing_details(l, 0, null); raise exception 'T162 FALHOU quantidade';
  exception when check_violation then null; end;
  begin insert into public.listing_photos (listing_id, path) values (l, 'outra-pasta/f.jpg'); raise exception 'T162 FALHOU caminho';
  exception when insufficient_privilege then null; end;
  insert into public.listing_photos (listing_id, path) select l, l::text || '/f' || g || '.jpg' from generate_series(1, 5) g;
  begin insert into public.listing_photos (listing_id, path) values (l, l::text || '/f6.jpg'); raise exception 'T162 FALHOU 6 fotos';
  exception when invalid_parameter_value then null; end;
  assert (select quantity from public.listing_extras(array[l])) = 3, 'T162 dono vê quantidade';
  assert (select cardinality(photos) from public.listing_extras(array[l])) = 5, 'T162 dono vê fotos';
end $$;
-- prestador que atende a cidade vê; quem não atende / não é prestador não vê
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
do $$ begin
  assert (select cardinality(photos) from public.listing_extras(array[(select id from t_ids where k = 'listing_fotos')])) = 5, 'T162 prestador da cidade vê';
  assert (select count(*) from public.listing_photos where listing_id = (select id from t_ids where k = 'listing_fotos')) = 5, 'T162 prestador lê fotos';
  begin insert into public.listing_photos (listing_id, path) values ((select id from t_ids where k = 'listing_fotos'), (select id from t_ids where k = 'listing_fotos')::text || '/x.jpg');
    raise exception 'T162 FALHOU prestador grava';
  exception when insufficient_privilege or invalid_parameter_value then null; end;
end $$;
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000005', false);
do $$ begin
  assert not exists (select 1 from public.listing_extras(array[(select id from t_ids where k = 'listing_fotos')])), 'T162 quem não atende não vê';
  assert (select count(*) from public.listing_photos where listing_id = (select id from t_ids where k = 'listing_fotos')) = 0, 'T162 fotos escondidas';
end $$;
select set_config('request.jwt.claim.sub', '16161616-0000-0000-0000-000000000016', false);
do $$ begin
  assert not exists (select 1 from public.listing_extras(array[(select id from t_ids where k = 'listing_fotos')])), 'T162 outro usuário não vê';
  begin perform public.set_listing_details((select id from t_ids where k = 'listing_fotos'), 1, null); raise exception 'T162 FALHOU outro altera';
  exception when insufficient_privilege then null; end;
  raise notice 'T162 OK  anúncio com quantidade, prazo (não no passado) e até 5 fotos; fotos só para o dono, o admin e prestadores da cidade';
end $$;
reset role;
