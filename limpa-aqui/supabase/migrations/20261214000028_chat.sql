-- =====================================================================
-- LIMPA AQUI — Chat (PRD Fase 2): conversas entre cliente e prestador
--  * Uma conversa por anúncio + prestador, ou uma por pedido do marketplace
--  * Só os participantes leem (cliente e membros da lavanderia); o admin só lê conversas denunciadas
--  * Mensagens com texto e/ou imagem (bucket privado chat-images); entram só por RPC
--  * Bloqueio (qualquer lado) e denúncia (vai para o admin)
--  * Tempo real: a tabela messages entra na publicação do Supabase Realtime (respeita a RLS)
--  * Aviso no sino para o outro lado (no máximo um aviso não lido por conversa)
-- =====================================================================

create table if not exists public.conversations (
  id               uuid primary key default gen_random_uuid(),
  listing_id       uuid references public.listings (id) on delete cascade,
  order_id         uuid references public.orders (id) on delete cascade,
  client_user_id   uuid not null references auth.users (id) on delete cascade,
  business_id      uuid not null references public.businesses (id) on delete cascade,
  blocked_by       uuid references auth.users (id) on delete set null,
  blocked_at       timestamptz,
  last_message_at  timestamptz,
  created_at       timestamptz not null default now(),
  check (num_nonnulls(listing_id, order_id) = 1)
);
create unique index if not exists conversations_listing_uq on public.conversations (listing_id, business_id) where listing_id is not null;
create unique index if not exists conversations_order_uq on public.conversations (order_id) where order_id is not null;
create index if not exists conversations_client_idx on public.conversations (client_user_id, last_message_at desc);
create index if not exists conversations_business_idx on public.conversations (business_id, last_message_at desc);

create table if not exists public.messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  sender_id        uuid not null references auth.users (id) on delete cascade,
  body             text check (body is null or char_length(body) between 1 and 2000),
  image_path       text check (image_path is null or char_length(image_path) <= 200),
  created_at       timestamptz not null default now(),
  check (body is not null or image_path is not null)
);
create index if not exists messages_conversation_idx on public.messages (conversation_id, created_at desc);
create index if not exists messages_sender_recent_idx on public.messages (sender_id, created_at desc);

create table if not exists public.conversation_reads (
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  last_read_at     timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create table if not exists public.chat_reports (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  reporter_id      uuid not null references auth.users (id) on delete cascade,
  reason           text not null check (char_length(trim(reason)) between 5 and 500),
  status           text not null default 'aberta' check (status in ('aberta', 'resolvida')),
  resolved_by      uuid references auth.users (id) on delete set null,
  resolved_at      timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists chat_reports_open_idx on public.chat_reports (created_at desc) where status = 'aberta';

-- ---------------------------------------------------------------------
-- Quem participa
-- ---------------------------------------------------------------------
create or replace function public.is_conversation_participant(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.conversations c
    where c.id = p_conversation_id
      and (c.client_user_id = auth.uid() or public.is_business_member(c.business_id))
  );
$$;

-- Admin lê só conversas com denúncia
create or replace function public.can_read_conversation(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_conversation_participant(p_conversation_id)
      or (public.has_role('admin') and exists (select 1 from public.chat_reports r where r.conversation_id = p_conversation_id));
$$;

alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.conversation_reads enable row level security;
alter table public.chat_reports enable row level security;
revoke all on public.conversations, public.messages, public.conversation_reads, public.chat_reports from anon, authenticated;
-- leitura direta só para o tempo real (a tela usa as RPCs abaixo)
grant select on public.conversations, public.messages to authenticated;
drop policy if exists conversations_read on public.conversations;
create policy conversations_read on public.conversations for select to authenticated using (public.is_conversation_participant(id));
drop policy if exists messages_read on public.messages;
create policy messages_read on public.messages for select to authenticated using (public.is_conversation_participant(conversation_id));

-- ---------------------------------------------------------------------
-- Abrir conversa
-- ---------------------------------------------------------------------
-- Por anúncio: o cliente fala com quem mandou proposta; o prestador que vê o anúncio pode perguntar ao cliente
create or replace function public.open_listing_conversation(p_listing_id uuid, p_business_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.listings;
  v_id uuid;
begin
  select * into l from public.listings where id = p_listing_id;
  if l.id is null then
    raise exception 'Anúncio não encontrado.' using errcode = 'P0002';
  end if;
  if l.user_id = auth.uid() then
    if not exists (select 1 from public.proposals p where p.listing_id = l.id and p.business_id = p_business_id) then
      raise exception 'Você conversa com quem mandou proposta para o seu anúncio.' using errcode = '42501';
    end if;
  elsif not (public.is_business_member(p_business_id) and public.can_see_listing(l.id)) then
    raise exception 'Você não pode conversar sobre este anúncio.' using errcode = '42501';
  end if;
  insert into public.conversations (listing_id, client_user_id, business_id)
  values (l.id, l.user_id, p_business_id)
  on conflict (listing_id, business_id) where listing_id is not null do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.conversations where listing_id = l.id and business_id = p_business_id;
  end if;
  return v_id;
end;
$$;

-- Pela proposta (atalho da tela do anúncio): o cliente conversa com quem mandou a proposta
create or replace function public.open_proposal_conversation(p_proposal_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_listing uuid;
  v_business uuid;
begin
  select p.listing_id, p.business_id into v_listing, v_business
  from public.proposals p join public.listings l on l.id = p.listing_id
  where p.id = p_proposal_id and l.user_id = auth.uid();
  if v_listing is null then
    raise exception 'Proposta não encontrada.' using errcode = '42501';
  end if;
  return public.open_listing_conversation(v_listing, v_business);
end;
$$;

-- Por pedido do marketplace: o cliente e a lavanderia do pedido
create or replace function public.open_order_conversation(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  v_id uuid;
begin
  select * into o from public.orders where id = p_order_id;
  if o.id is null or not (o.client_user_id = auth.uid() or public.is_business_member(o.business_id)) then
    raise exception 'Pedido não encontrado.' using errcode = '42501';
  end if;
  if o.client_user_id is null then
    raise exception 'Este pedido não foi feito pelo Limpa Aqui: fale com o cliente pelo WhatsApp.' using errcode = '22023';
  end if;
  insert into public.conversations (order_id, client_user_id, business_id)
  values (o.id, o.client_user_id, o.business_id)
  on conflict (order_id) where order_id is not null do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.conversations where order_id = o.id;
  end if;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Mensagens
-- ---------------------------------------------------------------------
create or replace function public.send_message(p_conversation_id uuid, p_body text, p_image_path text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.conversations;
  v_body text := nullif(trim(coalesce(p_body, '')), '');
  v_id uuid;
  v_client_side boolean;
  v_link text;
  v_from text;
begin
  select * into c from public.conversations where id = p_conversation_id;
  if c.id is null or not public.is_conversation_participant(c.id) then
    raise exception 'Conversa não encontrada.' using errcode = '42501';
  end if;
  if c.blocked_at is not null then
    raise exception 'Esta conversa foi bloqueada.' using errcode = '42501';
  end if;
  if v_body is null and p_image_path is null then
    raise exception 'Escreva uma mensagem.' using errcode = '22023';
  end if;
  if p_image_path is not null and split_part(p_image_path, '/', 1) <> c.id::text then
    raise exception 'Imagem inválida.' using errcode = '22023';
  end if;
  if (select count(*) from public.messages m where m.sender_id = auth.uid() and m.created_at > now() - interval '1 minute') >= 20 then
    raise exception 'Muitas mensagens seguidas. Aguarde um pouco.' using errcode = '54000';
  end if;

  insert into public.messages (conversation_id, sender_id, body, image_path)
  values (c.id, auth.uid(), left(v_body, 2000), p_image_path)
  returning id into v_id;
  update public.conversations set last_message_at = now() where id = c.id;
  insert into public.conversation_reads (conversation_id, user_id, last_read_at) values (c.id, auth.uid(), now())
  on conflict (conversation_id, user_id) do update set last_read_at = now();

  -- aviso para o outro lado (um só aviso não lido por conversa)
  v_client_side := c.client_user_id = auth.uid();
  begin
    if v_client_side then
      v_link := '/app/mensagens/' || c.id;
      select coalesce(split_part(nullif(trim(p.full_name), ''), ' ', 1), 'Cliente') into v_from from public.profiles p where p.id = auth.uid();
      if not exists (select 1 from public.notifications n join public.business_members bm on bm.user_id = n.user_id
                      where bm.business_id = c.business_id and n.link = v_link and n.read_at is null) then
        perform public.notify_business(c.business_id, 'mensagem', 'Nova mensagem de ' || coalesce(v_from, 'cliente'),
                                       left(coalesce(v_body, '📷 Foto'), 120), v_link, false);
      end if;
    else
      v_link := '/cliente/mensagens/' || c.id;
      select b.name into v_from from public.businesses b where b.id = c.business_id;
      if not exists (select 1 from public.notifications n where n.user_id = c.client_user_id and n.link = v_link and n.read_at is null) then
        perform public.notify(c.client_user_id, 'mensagem', 'Nova mensagem de ' || coalesce(v_from, 'prestador'),
                              left(coalesce(v_body, '📷 Foto'), 120), v_link);
      end if;
    end if;
  exception when others then
    null; -- o aviso nunca impede a mensagem
  end;
  return v_id;
end;
$$;

-- Últimas mensagens (paginação para trás)
create or replace function public.conversation_messages(p_conversation_id uuid, p_before timestamptz default null)
returns table (id uuid, sender_id uuid, mine boolean, body text, image_path text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_read_conversation(p_conversation_id) then
    raise exception 'Conversa não encontrada.' using errcode = '42501';
  end if;
  return query
  select m.id, m.sender_id, m.sender_id = auth.uid(), m.body, m.image_path, m.created_at
  from public.messages m
  where m.conversation_id = p_conversation_id and (p_before is null or m.created_at < p_before)
  order by m.created_at desc
  limit 50;
end;
$$;

create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_conversation_participant(p_conversation_id) then
    raise exception 'Conversa não encontrada.' using errcode = '42501';
  end if;
  insert into public.conversation_reads (conversation_id, user_id, last_read_at) values (p_conversation_id, auth.uid(), now())
  on conflict (conversation_id, user_id) do update set last_read_at = now();
  update public.notifications set read_at = now()
   where user_id = auth.uid() and read_at is null and kind = 'mensagem'
     and link in ('/app/mensagens/' || p_conversation_id, '/cliente/mensagens/' || p_conversation_id);
end;
$$;

-- Caixa de entrada: como cliente (p_business_id nulo) ou como lavanderia
create or replace function public.my_conversations(p_business_id uuid default null)
returns table (id uuid, kind text, subject text, counterpart text, listing_id uuid, order_id uuid,
               last_message text, last_message_at timestamptz, last_mine boolean, unread bigint, blocked boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_business_id is not null and not public.is_business_member(p_business_id) then
    raise exception 'Somente a equipe da lavanderia vê estas conversas.' using errcode = '42501';
  end if;
  return query
  select c.id,
         case when c.order_id is not null then 'pedido' else 'anuncio' end,
         case when c.order_id is not null then 'Pedido nº ' || o.number else l.title end,
         case when p_business_id is null then b.name
              else coalesce(nullif(split_part(trim(pr.full_name), ' ', 1), ''), 'Cliente') end,
         c.listing_id, c.order_id,
         lm.body_preview, c.last_message_at, lm.sender_id = auth.uid(),
         (select count(*) from public.messages m
           where m.conversation_id = c.id and m.sender_id <> auth.uid()
             and m.created_at > coalesce((select r.last_read_at from public.conversation_reads r where r.conversation_id = c.id and r.user_id = auth.uid()), '-infinity')),
         c.blocked_at is not null
  from public.conversations c
  join public.businesses b on b.id = c.business_id
  left join public.orders o on o.id = c.order_id
  left join public.listings l on l.id = c.listing_id
  left join public.profiles pr on pr.id = c.client_user_id
  left join lateral (select coalesce(m.body, '📷 Foto') as body_preview, m.sender_id from public.messages m
                      where m.conversation_id = c.id order by m.created_at desc limit 1) lm on true
  where (p_business_id is null and c.client_user_id = auth.uid())
     or (p_business_id is not null and c.business_id = p_business_id)
  order by coalesce(c.last_message_at, c.created_at) desc
  limit 200;
end;
$$;

-- Total de não lidas (para a bolinha da aba)
create or replace function public.unread_messages(p_business_id uuid default null)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(x.unread), 0)::bigint from public.my_conversations(p_business_id) x where not x.blocked;
$$;

-- Bloquear / desbloquear (quem bloqueou desbloqueia)
create or replace function public.set_conversation_blocked(p_conversation_id uuid, p_blocked boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.conversations;
begin
  select * into c from public.conversations where id = p_conversation_id;
  if c.id is null or not public.is_conversation_participant(c.id) then
    raise exception 'Conversa não encontrada.' using errcode = '42501';
  end if;
  if p_blocked then
    update public.conversations set blocked_by = auth.uid(), blocked_at = now() where id = c.id and blocked_at is null;
  else
    if c.blocked_by is distinct from auth.uid() then
      raise exception 'Só quem bloqueou pode desbloquear.' using errcode = '42501';
    end if;
    update public.conversations set blocked_by = null, blocked_at = null where id = c.id;
  end if;
end;
$$;

create or replace function public.report_conversation(p_conversation_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.is_conversation_participant(p_conversation_id) then
    raise exception 'Conversa não encontrada.' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Conte em poucas palavras o que aconteceu.' using errcode = '22023';
  end if;
  insert into public.chat_reports (conversation_id, reporter_id, reason) values (p_conversation_id, auth.uid(), left(trim(p_reason), 500))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.admin_chat_reports()
returns table (id uuid, conversation_id uuid, reason text, status text, created_at timestamptz, reporter text,
               client_name text, business_name text, subject text, messages bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_role('admin') then
    raise exception 'Somente a administração da plataforma pode fazer isso.' using errcode = '42501';
  end if;
  return query
  select r.id, r.conversation_id, r.reason, r.status, r.created_at,
         coalesce(rp.full_name, 'Usuário'), coalesce(cp.full_name, 'Cliente'), b.name,
         case when c.order_id is not null then 'Pedido nº ' || o.number else l.title end,
         (select count(*) from public.messages m where m.conversation_id = c.id)
  from public.chat_reports r
  join public.conversations c on c.id = r.conversation_id
  join public.businesses b on b.id = c.business_id
  left join public.orders o on o.id = c.order_id
  left join public.listings l on l.id = c.listing_id
  left join public.profiles rp on rp.id = r.reporter_id
  left join public.profiles cp on cp.id = c.client_user_id
  order by (r.status = 'aberta') desc, r.created_at desc
  limit 200;
end;
$$;

create or replace function public.admin_resolve_chat_report(p_report_id uuid, p_block boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conv uuid;
begin
  if not public.has_role('admin') then
    raise exception 'Somente a administração da plataforma pode fazer isso.' using errcode = '42501';
  end if;
  update public.chat_reports set status = 'resolvida', resolved_by = auth.uid(), resolved_at = now()
   where id = p_report_id returning conversation_id into v_conv;
  if v_conv is not null and p_block then
    update public.conversations set blocked_by = auth.uid(), blocked_at = now() where id = v_conv and blocked_at is null;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Imagens (bucket privado) e tempo real
-- ---------------------------------------------------------------------
do $outer$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'Storage não disponível neste banco; bucket do chat não criado.';
  else
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('chat-images', 'chat-images', false, 3145728, array['image/jpeg', 'image/webp'])
    on conflict (id) do update set public = false, file_size_limit = 3145728, allowed_mime_types = array['image/jpeg', 'image/webp'];
    execute 'drop policy if exists chat_images_read on storage.objects';
    execute 'drop policy if exists chat_images_write on storage.objects';
    execute $p$
      create policy chat_images_read on storage.objects for select to authenticated
        using (bucket_id = 'chat-images' and public.can_read_conversation(public.business_of_path(name)))
    $p$;
    execute $p$
      create policy chat_images_write on storage.objects for insert to authenticated
        with check (bucket_id = 'chat-images' and public.is_conversation_participant(public.business_of_path(name)))
    $p$;
  end if;

  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
    execute 'alter publication supabase_realtime add table public.messages';
  end if;
end
$outer$;

revoke all on function public.is_conversation_participant(uuid) from public, anon;
revoke all on function public.can_read_conversation(uuid) from public, anon;
revoke all on function public.open_listing_conversation(uuid, uuid) from public, anon;
revoke all on function public.open_order_conversation(uuid) from public, anon;
revoke all on function public.open_proposal_conversation(uuid) from public, anon;
revoke all on function public.send_message(uuid, text, text) from public, anon;
revoke all on function public.conversation_messages(uuid, timestamptz) from public, anon;
revoke all on function public.mark_conversation_read(uuid) from public, anon;
revoke all on function public.my_conversations(uuid) from public, anon;
revoke all on function public.unread_messages(uuid) from public, anon;
revoke all on function public.set_conversation_blocked(uuid, boolean) from public, anon;
revoke all on function public.report_conversation(uuid, text) from public, anon;
revoke all on function public.admin_chat_reports() from public, anon;
revoke all on function public.admin_resolve_chat_report(uuid, boolean) from public, anon;
grant execute on function public.is_conversation_participant(uuid) to authenticated;
grant execute on function public.can_read_conversation(uuid) to authenticated;
grant execute on function public.open_listing_conversation(uuid, uuid) to authenticated;
grant execute on function public.open_order_conversation(uuid) to authenticated;
grant execute on function public.open_proposal_conversation(uuid) to authenticated;
grant execute on function public.send_message(uuid, text, text) to authenticated;
grant execute on function public.conversation_messages(uuid, timestamptz) to authenticated;
grant execute on function public.mark_conversation_read(uuid) to authenticated;
grant execute on function public.my_conversations(uuid) to authenticated;
grant execute on function public.unread_messages(uuid) to authenticated;
grant execute on function public.set_conversation_blocked(uuid, boolean) to authenticated;
grant execute on function public.report_conversation(uuid, text) to authenticated;
grant execute on function public.admin_chat_reports() to authenticated;
grant execute on function public.admin_resolve_chat_report(uuid, boolean) to authenticated;
