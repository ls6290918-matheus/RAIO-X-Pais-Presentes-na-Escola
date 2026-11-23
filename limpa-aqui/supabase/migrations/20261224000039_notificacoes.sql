-- =====================================================================
-- LIMPA AQUI — Fase 1 / Subetapa 3: infraestrutura de notificações (push via FCM)
--  * push_subscriptions: aparelhos que podem receber push (web/PWA agora; Android/iOS no app futuro).
--    O token NUNCA sai do banco para o navegador: tabela só por RPC
--  * notification_preferences: o que cada pessoa quer receber, por categoria e canal
--    (sem linha = padrão: push ligado, marketing desligado; "sistema" é sempre enviado)
--  * notification_deliveries: registro de cada envio (situação, tentativas, id do provedor, erro)
--  * A tabela notifications (avisos do sino) continua igual e vira a fila: cada aviso novo gera,
--    se a pessoa quiser e tiver aparelho, um envio "pendente" e o banco chama a Edge Function
--    notify-send pelo pg_net. A função fala com o FCM com credenciais do servidor (nunca no navegador)
--  * Reenvio a cada minuto (até 3 tentativas) e limpeza diária pelo pg_cron, quando existir
--  * Novos avisos da logística: entregador a caminho, peças coletadas, entregues, corrida cancelada
--  * Enquanto a URL do envio não for configurada, nada sai do banco (desligado por padrão)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Aparelhos
-- ---------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  device_id    text not null check (device_id ~ '^[A-Za-z0-9_-]{8,100}$'),
  platform     text not null check (platform in ('web', 'pwa', 'android', 'ios')),
  token        text not null check (char_length(token) between 20 and 4096),
  device_name  text check (device_name is null or char_length(device_name) <= 80),
  is_active    boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, device_id)
);
create index if not exists push_subscriptions_token_idx on public.push_subscriptions (token);
create index if not exists push_subscriptions_user_active_idx on public.push_subscriptions (user_id) where is_active;
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;

-- ---------------------------------------------------------------------
-- Preferências
-- ---------------------------------------------------------------------
create table if not exists public.notification_preferences (
  user_id    uuid not null references auth.users (id) on delete cascade,
  category   text not null check (category in ('pedidos', 'mensagens', 'pagamentos', 'avaliacoes', 'logistica', 'marketing')),
  push       boolean not null default true,
  email      boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, category)
);
alter table public.notification_preferences enable row level security;
revoke all on public.notification_preferences from anon, authenticated;

-- ---------------------------------------------------------------------
-- Registro de envios
-- ---------------------------------------------------------------------
create table if not exists public.notification_deliveries (
  id                  uuid primary key default gen_random_uuid(),
  notification_id     uuid not null references public.notifications (id) on delete cascade,
  user_id             uuid not null references auth.users (id) on delete cascade,
  notification_type   text not null,
  channel             text not null check (channel in ('push', 'email')),
  status              text not null default 'pendente'
                      check (status in ('pendente', 'enviado', 'parcial', 'falhou', 'sem_dispositivo')),
  attempts            integer not null default 0 check (attempts between 0 and 10),
  provider_message_id text check (provider_message_id is null or char_length(provider_message_id) <= 300),
  error_code          text check (error_code is null or char_length(error_code) <= 120),
  sent_at             timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (notification_id, channel)
);
create index if not exists notification_deliveries_retry_idx on public.notification_deliveries (status, updated_at)
  where status in ('pendente', 'falhou');
create index if not exists notification_deliveries_created_idx on public.notification_deliveries (created_at);
alter table public.notification_deliveries enable row level security;
revoke all on public.notification_deliveries from anon, authenticated;

-- Endereço da função de envio e segredo da chamada interna (gerado aqui; nunca sai do servidor)
create table if not exists public.notify_dispatch_config (
  id         boolean primary key default true check (id),
  endpoint   text check (endpoint is null or endpoint ~ '^https://'),
  -- 2 UUIDs v4 (gerador criptográfico do próprio Postgres) = 244 bits aleatórios
  secret     text not null default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  enabled    boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.notify_dispatch_config (id) values (true) on conflict (id) do nothing;
alter table public.notify_dispatch_config enable row level security;
revoke all on public.notify_dispatch_config from anon, authenticated;

-- ---------------------------------------------------------------------
-- Categoria de cada tipo de aviso e o que a pessoa quer receber
-- ---------------------------------------------------------------------
create or replace function public.notification_category(p_kind text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_kind = 'mensagem' then 'mensagens'
    when p_kind in ('pix_confirmado', 'repasse_pago', 'plano_ativo') then 'pagamentos'
    when p_kind = 'avaliacao' then 'avaliacoes'
    when p_kind like 'corrida%' then 'logistica'
    when p_kind like 'pedido%' or p_kind like 'proposta%' or p_kind in ('disputa', 'anuncio_encerrado') then 'pedidos'
    when p_kind like 'marketing%' then 'marketing'
    else 'sistema' -- avisos da administração e da conta: sempre enviados
  end;
$$;

create or replace function public.notification_wanted(p_user uuid, p_category text, p_channel text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_category = 'sistema' then true
    else coalesce((select case when p_channel = 'push' then np.push else np.email end
                   from public.notification_preferences np where np.user_id = p_user and np.category = p_category),
                  p_category <> 'marketing')
  end;
$$;

-- ---------------------------------------------------------------------
-- Fila: aviso novo → envio pendente → chamada assíncrona da função de envio
-- ---------------------------------------------------------------------
create or replace function public.notify_dispatch(p_body jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.notify_dispatch_config;
begin
  select * into c from public.notify_dispatch_config where id;
  if c.id is null or not c.enabled or c.endpoint is null or to_regnamespace('net') is null then
    return; -- desligado (ou banco sem pg_net): o envio fica pendente para o reenvio
  end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 5000)'
    using c.endpoint, p_body, jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', c.secret);
end;
$$;

create or replace function public.notifications_enqueue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if public.notification_wanted(new.user_id, public.notification_category(new.kind), 'push')
     and exists (select 1 from public.push_subscriptions s where s.user_id = new.user_id and s.is_active) then
    insert into public.notification_deliveries (notification_id, user_id, notification_type, channel)
    values (new.id, new.user_id, new.kind, 'push')
    on conflict (notification_id, channel) do nothing
    returning id into v_id;
    if v_id is not null then
      perform public.notify_dispatch(jsonb_build_object('delivery_id', v_id));
    end if;
  end if;
  return new;
exception when others then
  raise warning 'fila de notificação falhou: %', sqlerrm;
  return new; -- o aviso no sino nunca deixa de ser gravado
end;
$$;

drop trigger if exists notifications_enqueue on public.notifications;
create trigger notifications_enqueue after insert on public.notifications
  for each row execute function public.notifications_enqueue();

-- ---------------------------------------------------------------------
-- RPCs do usuário: aparelhos e preferências
-- ---------------------------------------------------------------------
create or replace function public.register_device(p_device_id text, p_platform text, p_token text, p_device_name text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Faça login para continuar.' using errcode = '28000';
  end if;
  if p_device_id is null or p_device_id !~ '^[A-Za-z0-9_-]{8,100}$' then
    raise exception 'Aparelho inválido.' using errcode = '22023';
  end if;
  if p_platform is null or p_platform not in ('web', 'pwa', 'android', 'ios') then
    raise exception 'Plataforma inválida.' using errcode = '22023';
  end if;
  if p_token is null or char_length(p_token) not between 20 and 4096 then
    raise exception 'Token de notificação inválido.' using errcode = '22023';
  end if;
  if (select count(*) from public.push_subscriptions where user_id = auth.uid() and is_active) >= 20
     and not exists (select 1 from public.push_subscriptions where user_id = auth.uid() and device_id = p_device_id) then
    raise exception 'Limite de 20 aparelhos. Desative um aparelho antigo.' using errcode = '22023';
  end if;
  -- o token é do aparelho: se outra conta entrou neste aparelho antes, ela deixa de receber aqui
  update public.push_subscriptions set is_active = false, updated_at = now()
   where token = p_token and user_id <> auth.uid() and is_active;
  insert into public.push_subscriptions (user_id, device_id, platform, token, device_name)
  values (auth.uid(), p_device_id, p_platform, p_token, left(nullif(trim(coalesce(p_device_name, '')), ''), 80))
  on conflict (user_id, device_id) do update
     set token = excluded.token, platform = excluded.platform, device_name = coalesce(excluded.device_name, public.push_subscriptions.device_name),
         is_active = true, last_seen_at = now(), updated_at = now();
end;
$$;

create or replace function public.unregister_device(p_device_id text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.push_subscriptions set is_active = false, updated_at = now()
   where user_id = auth.uid() and device_id = p_device_id;
$$;

create or replace function public.my_devices()
returns table (device_id text, platform text, device_name text, is_active boolean, last_seen_at timestamptz, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select s.device_id, s.platform, s.device_name, s.is_active, s.last_seen_at, s.created_at
  from public.push_subscriptions s where s.user_id = auth.uid()
  order by s.is_active desc, s.last_seen_at desc;
$$;

create or replace function public.my_notification_preferences()
returns table (category text, push boolean, email boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select c.category,
         coalesce(np.push, c.category <> 'marketing'),
         coalesce(np.email, c.category <> 'marketing')
  from (values ('pedidos', 1), ('mensagens', 2), ('pagamentos', 3), ('avaliacoes', 4), ('logistica', 5), ('marketing', 6)) as c (category, ord)
  left join public.notification_preferences np on np.user_id = auth.uid() and np.category = c.category
  where auth.uid() is not null
  order by c.ord;
$$;

create or replace function public.set_notification_preference(p_category text, p_push boolean, p_email boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Faça login para continuar.' using errcode = '28000';
  end if;
  if p_category is null or p_category not in ('pedidos', 'mensagens', 'pagamentos', 'avaliacoes', 'logistica', 'marketing') then
    raise exception 'Categoria inválida.' using errcode = '22023';
  end if;
  insert into public.notification_preferences (user_id, category, push, email)
  values (auth.uid(), p_category, coalesce(p_push, true), coalesce(p_email, true))
  on conflict (user_id, category) do update set push = excluded.push, email = excluded.email, updated_at = now();
end;
$$;

-- ---------------------------------------------------------------------
-- RPCs da função de envio (somente service_role)
-- ---------------------------------------------------------------------
create or replace function public.notify_check_secret(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select c.secret = p_secret from public.notify_dispatch_config c where c.id), false);
$$;

-- Dados para enviar um push: o aviso e os tokens ativos (conta a tentativa)
create or replace function public.notify_delivery_payload(p_delivery_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.notification_deliveries;
  n public.notifications;
begin
  select * into d from public.notification_deliveries where id = p_delivery_id for update skip locked;
  if d.id is null or d.status not in ('pendente', 'falhou') or d.attempts >= 3 then
    return null; -- já tratado, em uso por outro envio ou esgotado
  end if;
  select * into n from public.notifications where id = d.notification_id;
  update public.notification_deliveries set attempts = attempts + 1, updated_at = now() where id = d.id;
  return jsonb_build_object(
    'delivery_id', d.id, 'channel', d.channel, 'attempt', d.attempts + 1,
    'notification', jsonb_build_object('id', n.id, 'kind', n.kind, 'title', n.title, 'body', n.body, 'link', n.link),
    'tokens', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'token', s.token, 'platform', s.platform))
                        from public.push_subscriptions s where s.user_id = d.user_id and s.is_active), '[]'::jsonb));
end;
$$;

-- Resultado do envio; tokens recusados pelo FCM são desativados
create or replace function public.notify_delivery_result(
  p_delivery_id uuid, p_status text, p_message_id text default null, p_error text default null, p_invalid_tokens uuid[] default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.notification_deliveries;
begin
  if p_status not in ('enviado', 'parcial', 'falhou', 'sem_dispositivo') then
    raise exception 'Situação inválida.' using errcode = '22023';
  end if;
  update public.notification_deliveries
     set status = p_status, provider_message_id = left(p_message_id, 300), error_code = left(p_error, 120),
         sent_at = case when p_status in ('enviado', 'parcial') then now() else sent_at end, updated_at = now()
   where id = p_delivery_id
  returning * into d;
  if coalesce(array_length(p_invalid_tokens, 1), 0) > 0 then
    update public.push_subscriptions set is_active = false, updated_at = now() where id = any (p_invalid_tokens);
  end if;
  -- falha definitiva que não é de token: avisa a administração (no máximo 1 aviso por hora)
  if d.id is not null and p_status = 'falhou' and d.attempts >= 3 then
    perform public.admin_alert_once('falha_push', 'Falha no envio de notificações',
                                    'O push falhou depois de 3 tentativas: ' || coalesce(left(p_error, 80), 'erro desconhecido'), '/admin');
  end if;
end;
$$;

-- Aviso de problema para os admins, sem repetir dentro de 1 hora
create or replace function public.admin_alert_once(p_kind text, p_title text, p_body text, p_link text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.notifications n join public.user_roles r on r.user_id = n.user_id and r.role = 'admin'
             where n.kind = p_kind and n.created_at > now() - interval '1 hour') then
    return;
  end if;
  perform public.notify_admins(p_kind, p_title, p_body, p_link);
end;
$$;

-- Envios a tentar de novo (pendentes antigos ou falhos com tentativas sobrando)
create or replace function public.notify_pending_deliveries(p_limit integer default 100)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select d.id from public.notification_deliveries d
  where d.status in ('pendente', 'falhou') and d.attempts < 3 and d.updated_at < now() - interval '1 minute'
    and d.created_at > now() - interval '1 day'
  order by d.created_at
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
$$;

-- Rotina do pg_cron: pede à função para reenviar; limpeza diária
create or replace function public.notifications_retry_dispatch()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.notification_deliveries d
             where d.status in ('pendente', 'falhou') and d.attempts < 3 and d.updated_at < now() - interval '1 minute'
               and d.created_at > now() - interval '1 day') then
    perform public.notify_dispatch(jsonb_build_object('retry', true));
  end if;
end;
$$;

create or replace function public.notifications_cleanup()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.notification_deliveries where created_at < now() - interval '90 days';
  delete from public.push_subscriptions where not is_active and updated_at < now() - interval '180 days';
$$;

do $outer$
begin
  if to_regnamespace('cron') is not null then
    perform cron.schedule('limpaaqui-notify-retry', '* * * * *', 'select public.notifications_retry_dispatch()');
    perform cron.schedule('limpaaqui-notify-cleanup', '17 4 * * *', 'select public.notifications_cleanup()');
  else
    raise notice 'pg_cron não disponível: reenvio e limpeza automáticos ficam desligados.';
  end if;
end
$outer$;

-- Admin: situação dos envios nos últimos 7 dias
create or replace function public.admin_notification_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_role('admin') then
    raise exception 'Somente a administração da plataforma pode fazer isso.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'dispatch_enabled', coalesce((select c.enabled and c.endpoint is not null from public.notify_dispatch_config c where c.id), false),
    'devices_active', (select count(*) from public.push_subscriptions where is_active),
    'users_with_devices', (select count(distinct user_id) from public.push_subscriptions where is_active),
    'last_7_days', coalesce((select jsonb_object_agg(status, n) from (
        select status, count(*) n from public.notification_deliveries where created_at > now() - interval '7 days' group by status) x), '{}'::jsonb),
    'top_errors', coalesce((select jsonb_agg(jsonb_build_object('error', error_code, 'count', n)) from (
        select error_code, count(*) n from public.notification_deliveries
        where error_code is not null and created_at > now() - interval '7 days' group by error_code order by n desc limit 5) x), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------
-- Novos avisos da logística (cliente, lavanderia e entregador)
-- ---------------------------------------------------------------------
create or replace function public.deliveries_progress_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  begin
    select * into o from public.orders where id = new.order_id;
    if new.status = 'aceita' then
      if new.leg = 'pickup' then
        perform public.notify(o.client_user_id, 'corrida_aceita', 'Entregador a caminho',
                              'Um entregador vai buscar as peças do pedido nº ' || o.number || '.', '/cliente/pedidos');
      else
        perform public.notify_business(new.business_id, 'corrida_aceita', 'Entregador a caminho da lavanderia',
                                       'Vai retirar o pedido nº ' || o.number || ' para devolver ao cliente.', '/app/pedidos/' || o.id);
      end if;
    elsif new.status = 'coletada' then
      if new.leg = 'pickup' then
        perform public.notify(o.client_user_id, 'corrida_coletada', 'Peças coletadas',
                              'As peças do pedido nº ' || o.number || ' estão a caminho da lavanderia.', '/cliente/pedidos');
        perform public.notify_business(new.business_id, 'corrida_coletada', 'Peças a caminho',
                                       'O entregador coletou as peças do pedido nº ' || o.number || '.', '/app/pedidos/' || o.id);
      else
        perform public.notify(o.client_user_id, 'corrida_coletada', 'Seu pedido saiu para entrega',
                              'O pedido nº ' || o.number || ' está a caminho.', '/cliente/pedidos');
      end if;
    elsif new.status = 'entregue' and new.leg = 'pickup' then
      perform public.notify_business(new.business_id, 'corrida_entregue', 'Peças entregues na lavanderia',
                                     'Pedido nº ' || o.number || ': confira as peças recebidas.', '/app/pedidos/' || o.id);
    elsif new.status = 'cancelada' and old.courier_id is not null then
      perform public.notify(old.courier_id, 'corrida_cancelada', 'Corrida cancelada',
                            'A corrida do pedido nº ' || o.number || ' foi cancelada.', '/entregas');
    end if;
    -- devolução entregue: o aviso "pedido entregue" já sai pela mudança do pedido (orders_notify)
  exception when others then
    raise warning 'aviso da corrida falhou: %', sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists deliveries_progress_notify on public.deliveries;
create trigger deliveries_progress_notify after update of status on public.deliveries
  for each row execute function public.deliveries_progress_notify();

-- ---------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------
revoke all on function public.notification_category(text) from public, anon, authenticated;
revoke all on function public.notification_wanted(uuid, text, text) from public, anon, authenticated;
revoke all on function public.notify_dispatch(jsonb) from public, anon, authenticated;
revoke all on function public.notifications_enqueue() from public, anon, authenticated;
revoke all on function public.admin_alert_once(text, text, text, text) from public, anon, authenticated;
revoke all on function public.notifications_retry_dispatch() from public, anon, authenticated;
revoke all on function public.notifications_cleanup() from public, anon, authenticated;
revoke all on function public.deliveries_progress_notify() from public, anon, authenticated;
revoke all on function public.notify_check_secret(text) from public, anon, authenticated;
revoke all on function public.notify_delivery_payload(uuid) from public, anon, authenticated;
revoke all on function public.notify_delivery_result(uuid, text, text, text, uuid[]) from public, anon, authenticated;
revoke all on function public.notify_pending_deliveries(integer) from public, anon, authenticated;
revoke all on function public.register_device(text, text, text, text) from public, anon;
revoke all on function public.unregister_device(text) from public, anon;
revoke all on function public.my_devices() from public, anon;
revoke all on function public.my_notification_preferences() from public, anon;
revoke all on function public.set_notification_preference(text, boolean, boolean) from public, anon;
revoke all on function public.admin_notification_stats() from public, anon;
grant execute on function public.register_device(text, text, text, text) to authenticated;
grant execute on function public.unregister_device(text) to authenticated;
grant execute on function public.my_devices() to authenticated;
grant execute on function public.my_notification_preferences() to authenticated;
grant execute on function public.set_notification_preference(text, boolean, boolean) to authenticated;
grant execute on function public.admin_notification_stats() to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.notify_check_secret(text) to service_role;
    grant execute on function public.notify_delivery_payload(uuid) to service_role;
    grant execute on function public.notify_delivery_result(uuid, text, text, text, uuid[]) to service_role;
    grant execute on function public.notify_pending_deliveries(integer) to service_role;
  end if;
end $$;
