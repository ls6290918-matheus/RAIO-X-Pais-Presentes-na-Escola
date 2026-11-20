-- =====================================================================
-- LIMPA AQUI — Etapa 5 (home do cliente) e PRD Fase 2 (anúncio completo)
--  * Banners da home, cadastrados pelo admin (sem banner ativo, o espaço não aparece)
--  * Anúncio ganha quantidade, prazo desejado e até 5 fotos (bucket privado)
--    - fotos visíveis só a quem pode ver o anúncio: o cliente, o admin, quem já mandou proposta
--      e donos de prestadores que atendem a cidade enquanto o anúncio está aberto
-- Só acrescenta: create_listing e as telas atuais continuam iguais.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Banners
-- ---------------------------------------------------------------------
create table if not exists public.banners (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (char_length(trim(title)) between 2 and 60),
  subtitle    text check (subtitle is null or char_length(subtitle) <= 120),
  image_path  text check (image_path is null or char_length(image_path) <= 200),
  link_path   text check (link_path is null or (link_path ~ '^/[A-Za-z0-9/_?=&.%-]*$' and char_length(link_path) <= 200)),
  tone        text not null default 'petroleo' check (tone in ('petroleo', 'agua', 'claro')),
  active      boolean not null default true,
  starts_at   timestamptz,
  ends_at     timestamptz,
  sort        integer not null default 0,
  created_at  timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
alter table public.banners enable row level security;
revoke all on public.banners from anon, authenticated;

-- Banners no ar agora (visitantes e logados); nada de dados internos
create or replace function public.public_banners()
returns table (id uuid, title text, subtitle text, image_path text, link_path text, tone text)
language sql
stable
security definer
set search_path = ''
as $$
  select b.id, b.title, b.subtitle, b.image_path, b.link_path, b.tone
  from public.banners b
  where b.active and (b.starts_at is null or b.starts_at <= now()) and (b.ends_at is null or b.ends_at > now())
  order by b.sort, b.created_at desc
  limit 10;
$$;

create or replace function public.admin_banners()
returns setof public.banners
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_role('admin') then
    raise exception 'Somente a administração da plataforma pode fazer isso.' using errcode = '42501';
  end if;
  return query select * from public.banners order by sort, created_at desc;
end;
$$;

create or replace function public.admin_upsert_banner(
  p_id uuid, p_title text, p_subtitle text, p_link_path text, p_tone text, p_active boolean,
  p_starts_at timestamptz default null, p_ends_at timestamptz default null, p_sort integer default 0, p_image_path text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.has_role('admin') then
    raise exception 'Somente a administração da plataforma pode fazer isso.' using errcode = '42501';
  end if;
  if p_link_path is not null and p_link_path !~ '^/' then
    raise exception 'O link precisa ser uma página do Limpa Aqui (começando com /).' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.banners (title, subtitle, link_path, tone, active, starts_at, ends_at, sort, image_path)
    values (trim(p_title), nullif(trim(p_subtitle), ''), nullif(trim(p_link_path), ''), coalesce(p_tone, 'petroleo'), coalesce(p_active, true),
            p_starts_at, p_ends_at, coalesce(p_sort, 0), nullif(p_image_path, ''))
    returning id into v_id;
  else
    update public.banners
       set title = trim(p_title), subtitle = nullif(trim(p_subtitle), ''), link_path = nullif(trim(p_link_path), ''),
           tone = coalesce(p_tone, tone), active = coalesce(p_active, active), starts_at = p_starts_at, ends_at = p_ends_at,
           sort = coalesce(p_sort, sort), image_path = nullif(p_image_path, '')
     where id = p_id
     returning id into v_id;
    if v_id is null then
      raise exception 'Banner não encontrado.' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.admin_delete_banner(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_role('admin') then
    raise exception 'Somente a administração da plataforma pode fazer isso.' using errcode = '42501';
  end if;
  delete from public.banners where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Anúncio: quantidade, prazo desejado e fotos
-- ---------------------------------------------------------------------
alter table public.listings add column if not exists quantity integer;
alter table public.listings add column if not exists desired_date date;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'listings_quantity_check') then
    alter table public.listings add constraint listings_quantity_check check (quantity is null or quantity between 1 and 500);
  end if;
end $$;

-- Quem pode ver um anúncio (e as fotos dele)
create or replace function public.can_see_listing(p_listing_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.listings l
    where l.id = p_listing_id
      and (
        l.user_id = auth.uid()
        or public.has_role('admin')
        or exists (select 1 from public.proposals p join public.business_members bm on bm.business_id = p.business_id
                    where p.listing_id = l.id and bm.user_id = auth.uid())
        or (l.status = 'aberto' and exists (
              select 1 from public.business_members bm join public.businesses b on b.id = bm.business_id
              where bm.user_id = auth.uid() and bm.role = 'owner'
                and public.provider_serves(b.id, b.municipality_id, l.municipality_id)))
      )
  );
$$;

create table if not exists public.listing_photos (
  id          uuid primary key default gen_random_uuid(),
  listing_id  uuid not null references public.listings (id) on delete cascade,
  path        text not null unique check (char_length(path) <= 200),
  created_at  timestamptz not null default now()
);
create index if not exists listing_photos_listing_idx on public.listing_photos (listing_id, created_at);
alter table public.listing_photos enable row level security;
revoke all on public.listing_photos from anon, authenticated;
grant select, insert, delete on public.listing_photos to authenticated;

drop policy if exists listing_photos_read on public.listing_photos;
create policy listing_photos_read on public.listing_photos for select to authenticated using (public.can_see_listing(listing_id));
drop policy if exists listing_photos_insert on public.listing_photos;
create policy listing_photos_insert on public.listing_photos for insert to authenticated
  with check (
    split_part(path, '/', 1) = listing_id::text
    and exists (select 1 from public.listings l where l.id = listing_id and l.user_id = auth.uid() and l.status = 'aberto')
  );
drop policy if exists listing_photos_delete on public.listing_photos;
create policy listing_photos_delete on public.listing_photos for delete to authenticated
  using (exists (select 1 from public.listings l where l.id = listing_id and l.user_id = auth.uid()));

-- No máximo 5 fotos por anúncio
create or replace function public.listing_photos_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.listing_photos where listing_id = new.listing_id) >= 5 then
    raise exception 'Cada anúncio pode ter até 5 fotos.' using errcode = '22023';
  end if;
  return new;
end;
$$;
drop trigger if exists listing_photos_limit on public.listing_photos;
create trigger listing_photos_limit before insert on public.listing_photos
  for each row execute function public.listing_photos_limit();

-- Quantidade e prazo (só o dono, com o anúncio aberto)
create or replace function public.set_listing_details(p_listing_id uuid, p_quantity integer, p_desired_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.listings where id = p_listing_id and user_id = auth.uid()) then
    raise exception 'Anúncio não encontrado.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.listings where id = p_listing_id and status = 'aberto') then
    raise exception 'Este anúncio não está mais aberto.' using errcode = '22023';
  end if;
  if p_desired_date is not null and p_desired_date < (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'O prazo desejado não pode ser no passado.' using errcode = '22023';
  end if;
  update public.listings set quantity = p_quantity, desired_date = p_desired_date where id = p_listing_id;
end;
$$;

-- Quantidade, prazo e fotos de vários anúncios de uma vez (só dos que a pessoa pode ver)
create or replace function public.listing_extras(p_ids uuid[])
returns table (listing_id uuid, quantity integer, desired_date date, photos text[])
language sql
stable
security definer
set search_path = ''
as $$
  select l.id, l.quantity, l.desired_date,
         coalesce((select array_agg(ph.path order by ph.created_at) from public.listing_photos ph where ph.listing_id = l.id), '{}')
  from public.listings l
  where l.id = any (coalesce(p_ids, '{}')) and public.can_see_listing(l.id);
$$;

-- ---------------------------------------------------------------------
-- Storage: fotos dos anúncios (privado) e imagens dos banners (público)
-- ---------------------------------------------------------------------
do $outer$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'Storage não disponível neste banco; buckets não criados.';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('listing-photos', 'listing-photos', false, 3145728, array['image/jpeg', 'image/webp'])
  on conflict (id) do update set public = false, file_size_limit = 3145728, allowed_mime_types = array['image/jpeg', 'image/webp'];
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('banners', 'banners', true, 2097152, array['image/jpeg', 'image/webp', 'image/png'])
  on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg', 'image/webp', 'image/png'];

  execute 'drop policy if exists listing_photos_obj_read on storage.objects';
  execute 'drop policy if exists listing_photos_obj_write on storage.objects';
  execute 'drop policy if exists listing_photos_obj_remove on storage.objects';
  execute 'drop policy if exists banners_obj_write on storage.objects';
  execute 'drop policy if exists banners_obj_remove on storage.objects';

  execute $p$
    create policy listing_photos_obj_read on storage.objects for select to authenticated
      using (bucket_id = 'listing-photos' and public.can_see_listing(public.business_of_path(name)))
  $p$;
  execute $p$
    create policy listing_photos_obj_write on storage.objects for insert to authenticated
      with check (bucket_id = 'listing-photos' and exists (
        select 1 from public.listings l where l.id = public.business_of_path(name) and l.user_id = auth.uid() and l.status = 'aberto'))
  $p$;
  execute $p$
    create policy listing_photos_obj_remove on storage.objects for delete to authenticated
      using (bucket_id = 'listing-photos' and exists (
        select 1 from public.listings l where l.id = public.business_of_path(name) and l.user_id = auth.uid()))
  $p$;
  execute $p$
    create policy banners_obj_write on storage.objects for insert to authenticated
      with check (bucket_id = 'banners' and public.has_role('admin'))
  $p$;
  execute $p$
    create policy banners_obj_remove on storage.objects for delete to authenticated
      using (bucket_id = 'banners' and public.has_role('admin'))
  $p$;
end
$outer$;

revoke all on function public.public_banners() from public;
revoke all on function public.admin_banners() from public, anon;
revoke all on function public.admin_upsert_banner(uuid, text, text, text, text, boolean, timestamptz, timestamptz, integer, text) from public, anon;
revoke all on function public.admin_delete_banner(uuid) from public, anon;
revoke all on function public.can_see_listing(uuid) from public, anon;
revoke all on function public.set_listing_details(uuid, integer, date) from public, anon;
revoke all on function public.listing_extras(uuid[]) from public, anon;
grant execute on function public.public_banners() to anon, authenticated;
grant execute on function public.admin_banners() to authenticated;
grant execute on function public.admin_upsert_banner(uuid, text, text, text, text, boolean, timestamptz, timestamptz, integer, text) to authenticated;
grant execute on function public.admin_delete_banner(uuid) to authenticated;
grant execute on function public.can_see_listing(uuid) to authenticated;
grant execute on function public.set_listing_details(uuid, integer, date) to authenticated;
grant execute on function public.listing_extras(uuid[]) to authenticated;
