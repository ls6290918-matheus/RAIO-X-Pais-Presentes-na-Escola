-- =====================================================================
-- LIMPA AQUI — Avaliações (PRD Fase 3 / seção 10)
--  * O cliente do pedido avalia a lavanderia (pedido entregue) e cada entregador (corrida entregue)
--  * Nota de 1 a 5, critérios opcionais (qualidade, pontualidade, atendimento/estado da entrega) e comentário
--  * Uma avaliação por pedido (lavanderia) e uma por corrida (entregador); dá para corrigir em até 7 dias
--  * A lavanderia responde publicamente; médias públicas por slug (busca, perfil, propostas)
--  * Só entra por RPC; ninguém lê a tabela direto
-- =====================================================================

create table if not exists public.reviews (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders (id) on delete cascade,
  reviewer_id   uuid not null references auth.users (id) on delete cascade,
  target        text not null check (target in ('prestador', 'entregador')),
  business_id   uuid references public.businesses (id) on delete cascade,
  delivery_id   uuid references public.deliveries (id) on delete cascade,
  courier_id    uuid references auth.users (id) on delete set null,
  rating        smallint not null check (rating between 1 and 5),
  quality       smallint check (quality between 1 and 5),
  punctuality   smallint check (punctuality between 1 and 5),
  service       smallint check (service between 1 and 5),
  comment       text check (comment is null or char_length(comment) <= 500),
  reply         text check (reply is null or char_length(reply) <= 500),
  replied_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check ((target = 'prestador' and business_id is not null and delivery_id is null)
      or (target = 'entregador' and delivery_id is not null))
);
create unique index if not exists reviews_order_provider_uq on public.reviews (order_id) where target = 'prestador';
create unique index if not exists reviews_delivery_uq on public.reviews (delivery_id) where target = 'entregador';
create index if not exists reviews_business_idx on public.reviews (business_id, created_at desc) where target = 'prestador';
create index if not exists reviews_courier_idx on public.reviews (courier_id) where target = 'entregador';
alter table public.reviews enable row level security;
revoke all on public.reviews from anon, authenticated;

-- O que o cliente pode avaliar nos seus pedidos
create or replace function public.my_review_status(p_order_ids uuid[])
returns table (order_id uuid, can_review_provider boolean, provider_rating smallint,
               deliveries jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id,
         o.status = 'entregue',
         (select r.rating from public.reviews r where r.order_id = o.id and r.target = 'prestador'),
         coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'leg', d.leg,
                                                        'rating', (select r.rating from public.reviews r where r.delivery_id = d.id and r.target = 'entregador'))
                                    order by d.leg)
                   from public.deliveries d where d.order_id = o.id and d.status = 'entregue' and d.courier_id is not null), '[]'::jsonb)
  from public.orders o
  where o.id = any (coalesce(p_order_ids, '{}')) and o.client_user_id = auth.uid();
$$;

create or replace function public.submit_review(
  p_order_id uuid, p_rating integer, p_comment text default null,
  p_quality integer default null, p_punctuality integer default null, p_service integer default null,
  p_delivery_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  d public.deliveries;
  v_id uuid;
  v_existing public.reviews;
  v_comment text := nullif(trim(coalesce(p_comment, '')), '');
begin
  select * into o from public.orders where id = p_order_id;
  if o.id is null or o.client_user_id is distinct from auth.uid() then
    raise exception 'Só quem contratou o pedido pode avaliar.' using errcode = '42501';
  end if;
  if p_rating is null or p_rating not between 1 and 5 then
    raise exception 'Escolha de 1 a 5 estrelas.' using errcode = '22023';
  end if;
  if p_delivery_id is null then
    if o.status <> 'entregue' then
      raise exception 'Você pode avaliar quando o pedido for entregue.' using errcode = '22023';
    end if;
    select * into v_existing from public.reviews where order_id = o.id and target = 'prestador';
  else
    select * into d from public.deliveries where id = p_delivery_id and order_id = o.id;
    if d.id is null or d.status <> 'entregue' or d.courier_id is null then
      raise exception 'Você pode avaliar o entregador depois que a corrida for concluída.' using errcode = '22023';
    end if;
    select * into v_existing from public.reviews where delivery_id = d.id and target = 'entregador';
  end if;
  if v_existing.id is not null then
    if v_existing.created_at < now() - interval '7 days' then
      raise exception 'A avaliação só pode ser alterada em até 7 dias.' using errcode = '22023';
    end if;
    update public.reviews set rating = p_rating, quality = p_quality, punctuality = p_punctuality, service = p_service,
                              comment = left(v_comment, 500), updated_at = now()
     where id = v_existing.id;
    return v_existing.id;
  end if;
  insert into public.reviews (order_id, reviewer_id, target, business_id, delivery_id, courier_id, rating, quality, punctuality, service, comment)
  values (o.id, auth.uid(), case when p_delivery_id is null then 'prestador' else 'entregador' end,
          case when p_delivery_id is null then o.business_id end, d.id, d.courier_id,
          p_rating, p_quality, p_punctuality, p_service, left(v_comment, 500))
  returning id into v_id;
  begin
    if p_delivery_id is null then
      perform public.notify_business(o.business_id, 'avaliacao', 'Nova avaliação: ' || repeat('★', p_rating),
                                     coalesce(left(v_comment, 120), 'Pedido nº ' || o.number), '/app/avaliacoes', true);
    end if;
  exception when others then null;
  end;
  return v_id;
end;
$$;

-- Médias públicas por slug (busca, perfil e propostas)
create or replace function public.provider_ratings(p_slugs text[])
returns table (slug text, rating numeric, reviews bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select b.slug, round(avg(r.rating)::numeric, 1), count(r.id)
  from public.businesses b
  join public.reviews r on r.business_id = b.id and r.target = 'prestador'
  where b.slug = any (coalesce(p_slugs, '{}')) and b.marketplace_visible
  group by b.slug;
$$;

-- Avaliações públicas de um prestador (sem dados pessoais: só o primeiro nome)
create or replace function public.public_reviews(p_slug text)
returns table (id uuid, rating smallint, comment text, author text, created_at timestamptz, reply text, replied_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.rating, r.comment,
         coalesce(nullif(split_part(trim(p.full_name), ' ', 1), ''), 'Cliente'), r.created_at, r.reply, r.replied_at
  from public.reviews r
  join public.businesses b on b.id = r.business_id and b.slug = p_slug and b.marketplace_visible
  left join public.profiles p on p.id = r.reviewer_id
  where r.target = 'prestador'
  order by r.created_at desc
  limit 30;
$$;

-- Painel do prestador: todas as avaliações com médias por critério
create or replace function public.business_reviews(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_business_member(p_business_id) then
    raise exception 'Somente a equipe da lavanderia vê as avaliações.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'summary', (select jsonb_build_object(
                  'count', count(*), 'rating', round(avg(rating)::numeric, 1),
                  'quality', round(avg(quality)::numeric, 1), 'punctuality', round(avg(punctuality)::numeric, 1), 'service', round(avg(service)::numeric, 1),
                  'stars', jsonb_build_object('5', count(*) filter (where rating = 5), '4', count(*) filter (where rating = 4), '3', count(*) filter (where rating = 3),
                                              '2', count(*) filter (where rating = 2), '1', count(*) filter (where rating = 1)))
                from public.reviews where business_id = p_business_id and target = 'prestador'),
    'items', coalesce((select jsonb_agg(x order by x.created_at desc) from (
                select r.id, r.rating, r.quality, r.punctuality, r.service, r.comment, r.reply, r.replied_at, r.created_at,
                       o.number as order_number, coalesce(nullif(split_part(trim(p.full_name), ' ', 1), ''), 'Cliente') as author
                from public.reviews r join public.orders o on o.id = r.order_id left join public.profiles p on p.id = r.reviewer_id
                where r.business_id = p_business_id and r.target = 'prestador'
                order by r.created_at desc limit 200) x), '[]'::jsonb)
  );
end;
$$;

create or replace function public.reply_review(p_review_id uuid, p_reply text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.reviews;
begin
  select * into r from public.reviews where id = p_review_id and target = 'prestador';
  if r.id is null or not public.is_business_owner(r.business_id) then
    raise exception 'Somente o dono da lavanderia responde avaliações.' using errcode = '42501';
  end if;
  update public.reviews set reply = left(nullif(trim(coalesce(p_reply, '')), ''), 500),
                            replied_at = case when nullif(trim(coalesce(p_reply, '')), '') is null then null else now() end
   where id = r.id;
end;
$$;

-- Nota do entregador (para o painel dele)
create or replace function public.courier_rating()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('rating', round(avg(r.rating)::numeric, 1), 'count', count(*))
  from public.reviews r where r.courier_id = auth.uid() and r.target = 'entregador';
$$;

revoke all on function public.my_review_status(uuid[]) from public, anon;
revoke all on function public.submit_review(uuid, integer, text, integer, integer, integer, uuid) from public, anon;
revoke all on function public.provider_ratings(text[]) from public;
revoke all on function public.public_reviews(text) from public;
revoke all on function public.business_reviews(uuid) from public, anon;
revoke all on function public.reply_review(uuid, text) from public, anon;
revoke all on function public.courier_rating() from public, anon;
grant execute on function public.my_review_status(uuid[]) to authenticated;
grant execute on function public.submit_review(uuid, integer, text, integer, integer, integer, uuid) to authenticated;
grant execute on function public.provider_ratings(text[]) to anon, authenticated;
grant execute on function public.public_reviews(text) to anon, authenticated;
grant execute on function public.business_reviews(uuid) to authenticated;
grant execute on function public.reply_review(uuid, text) to authenticated;
grant execute on function public.courier_rating() to authenticated;
