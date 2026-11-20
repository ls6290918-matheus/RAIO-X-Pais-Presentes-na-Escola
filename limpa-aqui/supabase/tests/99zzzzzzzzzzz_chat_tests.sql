-- Testes do chat. Roda por último (usa o anúncio 'listing_fotos' do teste anterior).
\set ON_ERROR_STOP on
\set QUIET on

reset role;
insert into t_ids select 'chat_biz', b.id from public.businesses b join public.business_members bm on bm.business_id = b.id
  where bm.user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and bm.role = 'owner'
    and public.provider_serves(b.id, b.municipality_id, (select municipality_id from public.listings where id = (select id from t_ids where k = 'listing_fotos')))
  limit 1;
insert into t_ids select 'chat_order', o.id from public.orders o where o.client_user_id = '18181818-0000-0000-0000-000000000018' limit 1;
set role authenticated;

-- T163: conversa por anúncio — o prestador que vê o anúncio pergunta; o cliente responde; só os dois leem
select set_config('request.jwt.claim.sub', '17171717-0000-0000-0000-000000000017', false);
do $$ begin
  begin perform public.open_listing_conversation((select id from t_ids where k = 'listing_fotos'), (select id from t_ids where k = 'chat_biz'));
    raise exception 'T163 FALHOU cliente sem proposta';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
do $$ declare c uuid; c2 uuid; begin
  c := public.open_listing_conversation((select id from t_ids where k = 'listing_fotos'), (select id from t_ids where k = 'chat_biz'));
  c2 := public.open_listing_conversation((select id from t_ids where k = 'listing_fotos'), (select id from t_ids where k = 'chat_biz'));
  assert c = c2, 'T163 mesma conversa';
  insert into t_ids values ('conv', c);
  perform public.send_message(c, 'Olá! Os tênis são de camurça?');
  begin perform public.send_message(c, '   '); raise exception 'T163 FALHOU vazia';
  exception when invalid_parameter_value then null; end;
  begin perform public.send_message(c, null, 'outra-conversa/x.jpg'); raise exception 'T163 FALHOU imagem de outra pasta';
  exception when invalid_parameter_value then null; end;
end $$;
select set_config('request.jwt.claim.sub', '17171717-0000-0000-0000-000000000017', false);
do $$ declare c uuid := (select id from t_ids where k = 'conv'); begin
  assert (select unread from public.my_conversations() where id = c) = 1, 'T163 cliente tem 1 não lida';
  assert public.unread_messages() >= 1, 'T163 total não lidas';
  assert exists (select 1 from public.notifications where link = '/cliente/mensagens/' || c and read_at is null), 'T163 aviso ao cliente';
  assert (select count(*) from public.messages where conversation_id = c) = 1, 'T163 tempo real lê a própria conversa';
  perform public.mark_conversation_read(c);
  assert (select unread from public.my_conversations() where id = c) = 0, 'T163 lida';
  assert not exists (select 1 from public.notifications where link = '/cliente/mensagens/' || c and read_at is null), 'T163 aviso marcado como lido';
  perform public.send_message(c, 'Não, são de lona.');
  perform public.send_message(c, 'Pode mandar proposta.');
  assert (select count(*) from public.conversation_messages(c)) = 3, 'T163 histórico';
  assert (select count(*) from public.conversation_messages(c) where mine) = 2, 'T163 minhas';
end $$;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
do $$ declare c uuid := (select id from t_ids where k = 'conv'); begin
  assert (select unread from public.my_conversations((select id from t_ids where k = 'chat_biz')) where id = c) = 2, 'T163 lavanderia tem 2 não lidas';
  assert (select count(*) from public.notifications n where n.link = '/app/mensagens/' || c and n.read_at is null and n.user_id = auth.uid()) = 1, 'T163 só 1 aviso para 2 mensagens';
end $$;
-- quem não participa não vê nada
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000005', false);
do $$ declare c uuid := (select id from t_ids where k = 'conv'); begin
  assert (select count(*) from public.messages where conversation_id = c) = 0, 'T163 estranho não lê mensagens';
  assert (select count(*) from public.conversations where id = c) = 0, 'T163 estranho não lê conversa';
  begin perform public.conversation_messages(c); raise exception 'T163 FALHOU estranho histórico';
  exception when insufficient_privilege then null; end;
  begin perform public.send_message(c, 'oi'); raise exception 'T163 FALHOU estranho envia';
  exception when insufficient_privilege then null; end;
  begin insert into public.messages (conversation_id, sender_id, body) values (c, auth.uid(), 'direto'); raise exception 'T163 FALHOU insert direto';
  exception when insufficient_privilege then null; end;
  raise notice 'T163 OK  chat por anúncio: prestador pergunta, cliente responde; não lidas, 1 aviso por conversa; estranhos não leem nem enviam';
end $$;

-- T164: conversa do pedido (cliente e lavanderia do pedido)
select set_config('request.jwt.claim.sub', '18181818-0000-0000-0000-000000000018', false);
do $$ declare c uuid; begin
  c := public.open_order_conversation((select id from t_ids where k = 'chat_order'));
  perform public.send_message(c, 'Quando fica pronto?');
  insert into t_ids values ('conv_order', c);
end $$;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
do $$ declare c uuid := (select id from t_ids where k = 'conv_order'); begin
  assert public.open_order_conversation((select id from t_ids where k = 'chat_order')) = c, 'T164 mesma conversa do pedido';
  perform public.send_message(c, 'Amanhã à tarde.');
  assert exists (select 1 from public.my_conversations((select business_id from public.orders where id = (select id from t_ids where k = 'chat_order'))) where id = c and kind = 'pedido'), 'T164 na caixa da lavanderia';
end $$;
select set_config('request.jwt.claim.sub', '17171717-0000-0000-0000-000000000017', false);
do $$ begin
  begin perform public.open_order_conversation((select id from t_ids where k = 'chat_order')); raise exception 'T164 FALHOU outro cliente';
  exception when insufficient_privilege then null; end;
  begin perform public.open_proposal_conversation((select id from public.proposals limit 1)); raise exception 'T164 FALHOU proposta alheia';
  exception when insufficient_privilege then null; end;
  raise notice 'T164 OK  chat do pedido entre o cliente e a lavanderia; outro cliente não abre';
end $$;

-- T165: bloqueio e denúncia; admin só lê conversa denunciada
select set_config('request.jwt.claim.sub', '17171717-0000-0000-0000-000000000017', false);
do $$ declare c uuid := (select id from t_ids where k = 'conv'); begin
  perform public.set_conversation_blocked(c, true);
  perform public.report_conversation(c, 'Mensagens insistentes fora do assunto');
end $$;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
do $$ declare c uuid := (select id from t_ids where k = 'conv'); begin
  begin perform public.send_message(c, 'Oi?'); raise exception 'T165 FALHOU envia bloqueada';
  exception when insufficient_privilege then null; end;
  begin perform public.set_conversation_blocked(c, false); raise exception 'T165 FALHOU outro desbloqueia';
  exception when insufficient_privilege then null; end;
  begin perform public.admin_chat_reports(); raise exception 'T165 FALHOU dono vê denúncias';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub', '14141414-0000-0000-0000-000000000014', false);
do $$ declare r uuid; begin
  select id into r from public.admin_chat_reports() where conversation_id = (select id from t_ids where k = 'conv');
  assert r is not null, 'T165 admin vê denúncia';
  assert (select count(*) from public.conversation_messages((select id from t_ids where k = 'conv'))) = 3, 'T165 admin lê denunciada';
  begin perform public.conversation_messages((select id from t_ids where k = 'conv_order')); raise exception 'T165 FALHOU admin lê não denunciada';
  exception when insufficient_privilege then null; end;
  perform public.admin_resolve_chat_report(r, false);
  assert (select status from public.admin_chat_reports() where id = r) = 'resolvida', 'T165 resolvida';
end $$;
select set_config('request.jwt.claim.sub', '17171717-0000-0000-0000-000000000017', false);
do $$ declare c uuid := (select id from t_ids where k = 'conv'); begin
  perform public.set_conversation_blocked(c, false);
  perform public.send_message(c, 'Desbloqueei.');
  raise notice 'T165 OK  bloqueio (só quem bloqueou desbloqueia), denúncia para o admin; admin lê só conversa denunciada';
end $$;
reset role;
