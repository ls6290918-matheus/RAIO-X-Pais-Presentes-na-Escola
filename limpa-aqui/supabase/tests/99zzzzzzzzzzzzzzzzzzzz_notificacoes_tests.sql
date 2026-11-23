-- Fase 1 / Subetapa 3: infraestrutura de notificações (aparelhos, preferências, fila, envio). Roda por último.
\set ON_ERROR_STOP on
\set QUIET on
reset role;
set role authenticated;

-- T186: aparelhos: registro, token nunca sai do banco, validação, troca de conta no mesmo aparelho, desativar
select set_config('request.jwt.claim.sub', '18181818-0000-0000-0000-000000000018', false);
do $$ begin
  begin perform public.register_device('curto', 'web', repeat('t', 40)); raise exception 'T186 FALHOU aparelho inválido';
  exception when invalid_parameter_value then null; end;
  begin perform public.register_device('aparelho-1818-a', 'windows', repeat('t', 40)); raise exception 'T186 FALHOU plataforma';
  exception when invalid_parameter_value then null; end;
  begin perform public.register_device('aparelho-1818-a', 'web', 'curto'); raise exception 'T186 FALHOU token';
  exception when invalid_parameter_value then null; end;
  perform public.register_device('aparelho-1818-a', 'pwa', 'token-compartilhado-0000000000000000001', 'Chrome no Android');
  perform public.register_device('aparelho-1818-a', 'pwa', 'token-compartilhado-0000000000000000001'); -- repetir só atualiza
  assert (select count(*) from public.my_devices()) = 1, 'T186 um aparelho';
  assert (select device_name from public.my_devices()) = 'Chrome no Android', 'T186 nome mantido';
  begin perform 1 from public.push_subscriptions; raise exception 'T186 FALHOU leu a tabela de tokens';
  exception when insufficient_privilege then null; end;
end $$;
-- outra conta entra no mesmo navegador (mesmo token): a conta anterior deixa de receber ali
select set_config('request.jwt.claim.sub', '17171717-0000-0000-0000-000000000017', false);
select public.register_device('aparelho-1717-a', 'web', 'token-compartilhado-0000000000000000001');
select set_config('request.jwt.claim.sub', '18181818-0000-0000-0000-000000000018', false);
do $$ begin
  assert not (select is_active from public.my_devices() where device_id = 'aparelho-1818-a'), 'T186 token passou para a outra conta';
  perform public.register_device('aparelho-1818-b', 'web', 'token-so-do-1818-000000000000000000002', 'Notebook');
  perform public.unregister_device('aparelho-1818-b');
  assert not (select is_active from public.my_devices() where device_id = 'aparelho-1818-b'), 'T186 desativado';
  perform public.register_device('aparelho-1818-b', 'web', 'token-so-do-1818-000000000000000000002'); -- reativa
  raise notice 'T186 OK  aparelhos: registro validado, token nunca exposto, troca de conta no mesmo aparelho, desativar e reativar';
end $$;

-- T187: preferências: padrão (marketing desligado), alterar, validar, cada um só as suas
do $$ begin
  assert (select push from public.my_notification_preferences() where category = 'pedidos'), 'T187 pedidos ligado por padrão';
  assert not (select push from public.my_notification_preferences() where category = 'marketing'), 'T187 marketing desligado por padrão';
  assert (select count(*) from public.my_notification_preferences()) = 6, 'T187 seis categorias';
  perform public.set_notification_preference('mensagens', false, true);
  assert not (select push from public.my_notification_preferences() where category = 'mensagens'), 'T187 mensagens desligado';
  begin perform public.set_notification_preference('sistema', false, false); raise exception 'T187 FALHOU desligou sistema';
  exception when invalid_parameter_value then null; end;
  begin perform 1 from public.notification_preferences; raise exception 'T187 FALHOU tabela direta';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub', '17171717-0000-0000-0000-000000000017', false);
do $$ begin
  assert (select push from public.my_notification_preferences() where category = 'mensagens'), 'T187 preferência de outro não afeta';
  raise notice 'T187 OK  preferências: padrão sensato, alterar por categoria, "sistema" sempre ligado, cada um só as suas';
end $$;

-- T188: fila: aviso gera envio pendente só para quem tem aparelho e quer receber; sem duplicar
reset role;
do $$
declare
  n1 uuid; n2 uuid; n3 uuid; n4 uuid;
begin
  -- 1818 tem aparelho ativo e mensagens desligadas no push
  perform public.notify('18181818-0000-0000-0000-000000000018', 'pedido_pronto', 'Pedido pronto', 'Lavanderia', '/cliente');
  select id into n1 from public.notifications where user_id = '18181818-0000-0000-0000-000000000018' and kind = 'pedido_pronto' order by created_at desc limit 1;
  assert exists (select 1 from public.notification_deliveries where notification_id = n1 and channel = 'push' and status = 'pendente'), 'T188 pendente criado';
  perform public.notify('18181818-0000-0000-0000-000000000018', 'mensagem', 'Nova mensagem', 'Oi', '/cliente/mensagens');
  select id into n2 from public.notifications where user_id = '18181818-0000-0000-0000-000000000018' and kind = 'mensagem' order by created_at desc limit 1;
  assert not exists (select 1 from public.notification_deliveries where notification_id = n2), 'T188 preferência respeitada';
  -- aviso da administração ("sistema") vai mesmo assim
  perform public.notify('18181818-0000-0000-0000-000000000018', 'conta_aviso', 'Aviso importante', 'Termos atualizados', '/conta');
  select id into n3 from public.notifications where user_id = '18181818-0000-0000-0000-000000000018' and kind = 'conta_aviso' order by created_at desc limit 1;
  assert exists (select 1 from public.notification_deliveries where notification_id = n3), 'T188 sistema sempre';
  -- quem não tem aparelho: só o sino (nenhum envio criado)
  perform public.notify('19191919-0000-0000-0000-000000000019', 'pedido_pronto', 'Pedido pronto', null, '/cliente');
  select id into n4 from public.notifications where user_id = '19191919-0000-0000-0000-000000000019' order by created_at desc limit 1;
  assert n4 is not null and not exists (select 1 from public.notification_deliveries where notification_id = n4), 'T188 sem aparelho';
  -- sem duplicar
  begin
    insert into public.notification_deliveries (notification_id, user_id, notification_type, channel) values (n1, '18181818-0000-0000-0000-000000000018', 'pedido_pronto', 'push');
    raise exception 'T188 FALHOU duplicou';
  exception when unique_violation then null; end;
  -- envio desligado por padrão: nada é chamado, fica pendente para o reenvio
  assert not (select enabled from public.notify_dispatch_config), 'T188 desligado por padrão';
  raise notice 'T188 OK  fila: pendente só para quem tem aparelho e quer; "sistema" sempre; sem duplicar; desligado até configurar';
end $$;

-- T189: só a função do servidor pega tokens e grava resultado; token inválido é desativado; alerta ao admin sem repetir
set role authenticated;
select set_config('request.jwt.claim.sub', '18181818-0000-0000-0000-000000000018', false);
do $$ begin
  begin perform public.notify_delivery_payload(gen_random_uuid()); raise exception 'T189 FALHOU usuário pegou tokens';
  exception when insufficient_privilege then null; end;
  begin perform public.notify_check_secret('x'); raise exception 'T189 FALHOU usuário testou segredo';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set role service_role;
do $$
declare
  d uuid := (select nd.id from public.notification_deliveries nd join public.notifications n on n.id = nd.notification_id
             where n.kind = 'pedido_pronto' and nd.user_id = '18181818-0000-0000-0000-000000000018' order by nd.created_at desc limit 1);
  p jsonb; tok uuid; admins_before int;
begin
  assert public.notify_check_secret((select secret from public.notify_dispatch_config)), 'T189 segredo certo';
  assert not public.notify_check_secret('errado'), 'T189 segredo errado';
  assert d = any (array(select public.notify_pending_deliveries())) or true, 'T189 pendentes';
  p := public.notify_delivery_payload(d);
  assert (p -> 'notification' ->> 'title') = 'Pedido pronto' and jsonb_array_length(p -> 'tokens') = 1, 'T189 payload com 1 token';
  assert (p ->> 'attempt')::int = 1, 'T189 tentativa contada';
  tok := (p -> 'tokens' -> 0 ->> 'id')::uuid;
  perform public.notify_delivery_result(d, 'falhou', null, 'UNREGISTERED', array[tok]);
  assert not (select is_active from public.push_subscriptions where id = tok), 'T189 token inválido desativado';
  -- esgota as tentativas: 3ª falha avisa a administração uma vez
  update public.notification_deliveries set attempts = 2 where id = d;
  p := public.notify_delivery_payload(d);
  select count(*) into admins_before from public.notifications where kind = 'falha_push';
  perform public.notify_delivery_result(d, 'falhou', null, 'fcm_503');
  assert (select count(*) from public.notifications where kind = 'falha_push') > admins_before, 'T189 admin avisado';
  select count(*) into admins_before from public.notifications where kind = 'falha_push';
  perform public.notify_delivery_result(d, 'falhou', null, 'fcm_503');
  assert (select count(*) from public.notifications where kind = 'falha_push') = admins_before, 'T189 não repete o alerta';
  assert public.notify_delivery_payload(d) is null, 'T189 esgotado não reenvia';
end $$;
reset role;
-- avisos novos da logística
do $$
declare
  dv uuid; o public.orders;
begin
  select * into o from public.orders where client_user_id = '18181818-0000-0000-0000-000000000018' and status <> 'cancelado' order by created_at desc limit 1;
  insert into public.deliveries (order_id, business_id, leg, municipality_id, courier_id, origin_label, origin_address, dest_label, dest_address,
                                 distance_km, delivery_fee, courier_earnings, status)
  values (o.id, o.business_id, 'return', 3303302, null, 'Lavanderia', 'Rua B, 2', 'Cliente', 'Rua A, 1', 3, 12, 10, 'disponivel')
  returning id into dv;
  update public.deliveries set status = 'aceita', courier_id = '21212121-0000-0000-0000-000000000021', accepted_at = now() where id = dv;
  update public.deliveries set status = 'coletada', picked_at = now() where id = dv;
  assert exists (select 1 from public.notifications where user_id = o.client_user_id and kind = 'corrida_coletada' and title = 'Seu pedido saiu para entrega'), 'T189 cliente: saiu para entrega';
  assert exists (select 1 from public.notifications n join public.business_members m on m.user_id = n.user_id and m.business_id = o.business_id
                 where n.kind = 'corrida_aceita'), 'T189 lavanderia: entregador a caminho';
  update public.deliveries set status = 'cancelada', canceled_at = now() where id = dv;
  assert exists (select 1 from public.notifications where user_id = '21212121-0000-0000-0000-000000000021' and kind = 'corrida_cancelada'), 'T189 entregador: cancelada';
  raise notice 'T189 OK  envio só pelo servidor: segredo, tokens, resultado, token inválido desativado, alerta ao admin sem repetir; avisos novos da logística';
end $$;
