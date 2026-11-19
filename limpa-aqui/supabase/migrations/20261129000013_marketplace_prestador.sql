-- =====================================================================
-- LIMPA AQUI — Marketplace, Etapa 3: prestador no marketplace e busca pública
--  * businesses: aparecer na busca (só por RPC, com pré-requisitos), descrição pública,
--    coleta/devolução e formas de pagamento aceitas
--  * service_areas: municípios onde o prestador atende
--  * distance_km: distância em linha reta (Haversine), sem extensão extra
--  * RPCs públicas (também sem login): marketplace_municipalities, search_providers, get_public_provider
--    — nunca devolvem rua, número, WhatsApp ou dados internos
-- =====================================================================

alter table public.businesses
  add column if not exists marketplace_visible    boolean not null default false,
  add column if not exists public_description     text check (public_description is null or char_length(public_description) <= 500),
  add column if not exists offers_pickup          boolean not null default false,
  add column if not exists accepts_direct_payment boolean not null default true,
  add column if not exists accepts_app_payment    boolean not null default false;

create index if not exists businesses_visible_idx on public.businesses (municipality_id) where marketplace_visible;

-- Aparecer na busca e aceitar pagamento pelo app só mudam por RPC (o pagamento pelo app chega na Etapa 5b)
create or replace function public.protect_business_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('limpaaqui.internal', true) = 'on' then
    return new;
  end if;
  if new.slug is distinct from old.slug then
    raise exception 'O endereço público não pode ser alterado nesta versão.' using errcode = 'P0001';
  end if;
  if new.next_order_number is distinct from old.next_order_number then
    raise exception 'Numeração de pedidos é controlada pelo sistema.' using errcode = 'P0001';
  end if;
  if new.created_by is distinct from old.created_by or new.id is distinct from old.id then
    raise exception 'Campo protegido.' using errcode = 'P0001';
  end if;
  if new.marketplace_visible is distinct from old.marketplace_visible then
    raise exception 'Use a opção "Aparecer na busca" nas Configurações.' using errcode = 'P0001';
  end if;
  if new.accepts_app_payment is distinct from old.accepts_app_payment then
    raise exception 'O pagamento pelo app ainda não está disponível.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Áreas de atendimento
-- ---------------------------------------------------------------------
create table if not exists public.service_areas (
  business_id     uuid not null references public.businesses (id) on delete cascade,
  municipality_id integer not null references public.municipalities (id),
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  primary key (business_id, municipality_id)
);

create index if not exists service_areas_municipality_idx on public.service_areas (municipality_id) where active;

create or replace function public.service_areas_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.service_areas where business_id = new.business_id) >= 30 then
    raise exception 'No máximo 30 municípios de atendimento.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger service_areas_limit
  before insert on public.service_areas
  for each row execute function public.service_areas_limit();

alter table public.service_areas enable row level security;

create policy service_areas_select_member on public.service_areas
  for select to authenticated using (public.is_business_member(business_id));
create policy service_areas_insert_owner on public.service_areas
  for insert to authenticated with check (public.is_business_owner(business_id));
create policy service_areas_update_owner on public.service_areas
  for update to authenticated using (public.is_business_owner(business_id)) with check (public.is_business_owner(business_id));
create policy service_areas_delete_owner on public.service_areas
  for delete to authenticated using (public.is_business_owner(business_id));

revoke all on public.service_areas from anon, authenticated;
grant select, delete on public.service_areas to authenticated;
grant insert (business_id, municipality_id, active) on public.service_areas to authenticated;
grant update (active) on public.service_areas to authenticated;

-- Categorias para o filtro da busca pública (só código e nome; a tabela continua fechada a visitantes)
create or replace function public.public_categories()
returns table (code text, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.code, c.name from public.service_categories c order by c.sort;
$$;

-- ---------------------------------------------------------------------
-- Distância em linha reta (km)
-- ---------------------------------------------------------------------
create or replace function public.distance_km(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision
language sql
immutable
set search_path = ''
as $$
  select case when lat1 is null or lng1 is null or lat2 is null or lng2 is null then null
  else 6371 * 2 * asin(sqrt(
         power(sin(radians(lat2 - lat1) / 2), 2) +
         cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
  end;
$$;

-- ---------------------------------------------------------------------
-- O que falta para aparecer na busca (lista vazia = pode aparecer)
-- ---------------------------------------------------------------------
create or replace function public.marketplace_requirements(p_business_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  b public.businesses;
  missing text[] := '{}';
begin
  if not public.is_business_member(p_business_id) then
    raise exception 'Lavanderia não encontrada.' using errcode = 'P0001';
  end if;
  select * into b from public.businesses where id = p_business_id;
  if b.municipality_id is null then
    missing := array_append(missing, 'Endereço com cidade do estado do RJ (Configurações > endereço)');
  end if;
  if not exists (select 1 from public.services s where s.business_id = p_business_id and s.active
                 and (s.price > 0 or s.pricing_unit = 'orcamento')) then
    missing := array_append(missing, 'Pelo menos 1 serviço ativo com preço (menu Serviços)');
  end if;
  if not exists (select 1 from public.service_areas a where a.business_id = p_business_id and a.active) then
    missing := array_append(missing, 'Pelo menos 1 município de atendimento');
  end if;
  if not (b.accepts_direct_payment or b.accepts_app_payment) then
    missing := array_append(missing, 'Pelo menos 1 forma de pagamento');
  end if;
  return missing;
end;
$$;

create or replace function public.set_marketplace_visible(p_business_id uuid, p_visible boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  missing text[];
begin
  if not public.is_business_owner(p_business_id) then
    raise exception 'Somente o dono da lavanderia pode fazer isso.' using errcode = '42501';
  end if;
  if p_visible then
    missing := public.marketplace_requirements(p_business_id);
    if cardinality(missing) > 0 then
      raise exception 'Para aparecer na busca falta: %.', array_to_string(missing, '; ') using errcode = 'P0001';
    end if;
  end if;
  perform set_config('limpaaqui.internal', 'on', true);
  update public.businesses set marketplace_visible = p_visible where id = p_business_id;
  perform set_config('limpaaqui.internal', 'off', true);
end;
$$;

-- ---------------------------------------------------------------------
-- Busca pública
-- ---------------------------------------------------------------------
-- Prestador que pode aparecer: visível, com serviço ativo e forma de pagamento
create or replace function public.provider_listable(b public.businesses)
returns boolean
language sql
stable
set search_path = ''
as $$
  select b.marketplace_visible
     and (b.accepts_direct_payment or b.accepts_app_payment)
     and exists (select 1 from public.services s where s.business_id = b.id and s.active
                 and (s.price > 0 or s.pricing_unit = 'orcamento'));
$$;

-- Atende o município: área de atendimento ativa ou sede
create or replace function public.provider_serves(p_business_id uuid, p_home integer, p_municipality_id integer)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_home = p_municipality_id
      or exists (select 1 from public.service_areas a
                 where a.business_id = p_business_id and a.municipality_id = p_municipality_id and a.active);
$$;

-- Municípios com operação ativa E pelo menos 1 prestador que atende lá
create or replace function public.marketplace_municipalities()
returns table (id integer, name text, providers bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.name, count(b.id)
  from public.municipalities m
  join public.businesses b
    on public.provider_listable(b) and public.provider_serves(b.id, b.municipality_id, m.id)
  where m.status = 'ativo'
  group by m.id
  order by m.name;
$$;

create or replace function public.search_providers(
  p_municipality_id integer,
  p_category text default null,
  p_lat double precision default null,
  p_lng double precision default null
)
returns table (
  id uuid, name text, slug text, provider_type public.provider_type, logo_path text, public_description text,
  neighborhood text, municipality_name text, categories text[], min_price numeric, services_count bigint,
  offers_pickup boolean, accepts_direct_payment boolean, accepts_app_payment boolean, distance_km numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select b.id, b.name, b.slug, b.provider_type, b.logo_path, b.public_description,
         b.neighborhood, hm.name,
         coalesce((select array_agg(c.name order by c.sort)
                   from public.business_categories bc join public.service_categories c on c.code = bc.category_code
                   where bc.business_id = b.id and bc.active), '{}'),
         (select min(s.price) from public.services s where s.business_id = b.id and s.active and s.price > 0),
         (select count(*) from public.services s where s.business_id = b.id and s.active),
         b.offers_pickup, b.accepts_direct_payment, b.accepts_app_payment,
         round(public.distance_km(p_lat, p_lng, b.lat, b.lng)::numeric, 1)
  from public.businesses b
  join public.municipalities m on m.id = p_municipality_id and m.status = 'ativo'
  left join public.municipalities hm on hm.id = b.municipality_id
  where public.provider_listable(b)
    and public.provider_serves(b.id, b.municipality_id, p_municipality_id)
    and (p_category is null
         or exists (select 1 from public.business_categories bc where bc.business_id = b.id and bc.active and bc.category_code = p_category)
         or exists (select 1 from public.services s where s.business_id = b.id and s.active and s.category_code = p_category))
  order by public.distance_km(p_lat, p_lng, b.lat, b.lng) nulls last, b.name
  limit 100;
$$;

-- Perfil público de um prestador visível (null se não existir ou não estiver visível)
create or replace function public.get_public_provider(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', b.id, 'name', b.name, 'slug', b.slug, 'provider_type', b.provider_type, 'logo_path', b.logo_path,
    'public_description', b.public_description, 'neighborhood', b.neighborhood, 'municipality_name', hm.name,
    'opening_hours', b.opening_hours, 'offers_pickup', b.offers_pickup,
    'accepts_direct_payment', b.accepts_direct_payment, 'accepts_app_payment', b.accepts_app_payment,
    'categories', coalesce((select jsonb_agg(c.name order by c.sort)
                            from public.business_categories bc join public.service_categories c on c.code = bc.category_code
                            where bc.business_id = b.id and bc.active), '[]'::jsonb),
    'services', coalesce((select jsonb_agg(jsonb_build_object('name', s.name, 'description', s.description, 'price', s.price,
                                                              'pricing_unit', s.pricing_unit, 'category', c.name) order by c.sort nulls last, s.name)
                          from public.services s left join public.service_categories c on c.code = s.category_code
                          where s.business_id = b.id and s.active), '[]'::jsonb),
    'areas', coalesce((select jsonb_agg(m.name order by m.name)
                       from public.service_areas a join public.municipalities m on m.id = a.municipality_id
                       where a.business_id = b.id and a.active), '[]'::jsonb)
  )
  from public.businesses b
  left join public.municipalities hm on hm.id = b.municipality_id
  where b.slug = lower(trim(p_slug)) and public.provider_listable(b);
$$;

-- Painel do admin: quantos estão visíveis no marketplace em cada município
drop function if exists public.admin_municipality_overview(smallint);
create function public.admin_municipality_overview(p_state_id smallint default 33)
returns table (id integer, name text, status public.municipality_status, providers bigint, companies bigint, visible bigint)
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
  select m.id, m.name, m.status,
         count(b.id) filter (where b.provider_type = 'autonomo'),
         count(b.id) filter (where b.provider_type = 'empresa'),
         (select count(*) from public.businesses v
          where public.provider_listable(v) and public.provider_serves(v.id, v.municipality_id, m.id))
  from public.municipalities m
  left join public.businesses b on b.municipality_id = m.id
  where m.state_id = p_state_id
  group by m.id
  order by m.name;
end;
$$;

revoke all on function public.admin_municipality_overview(smallint) from public, anon;
revoke all on function public.marketplace_requirements(uuid) from public, anon;
revoke all on function public.set_marketplace_visible(uuid, boolean) from public, anon;
revoke all on function public.service_areas_limit() from public, anon, authenticated;
revoke all on function public.provider_listable(public.businesses) from public, anon, authenticated;
revoke all on function public.provider_serves(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.marketplace_municipalities() from public;
revoke all on function public.search_providers(integer, text, double precision, double precision) from public;
revoke all on function public.get_public_provider(text) from public;
grant execute on function public.admin_municipality_overview(smallint) to authenticated;
grant execute on function public.marketplace_requirements(uuid) to authenticated;
grant execute on function public.set_marketplace_visible(uuid, boolean) to authenticated;
grant execute on function public.marketplace_municipalities() to anon, authenticated;
grant execute on function public.search_providers(integer, text, double precision, double precision) to anon, authenticated;
grant execute on function public.get_public_provider(text) to anon, authenticated;
revoke all on function public.public_categories() from public;
grant execute on function public.public_categories() to anon, authenticated;

insert into public.reserved_slugs (slug) values ('p'), ('buscar') on conflict do nothing;
