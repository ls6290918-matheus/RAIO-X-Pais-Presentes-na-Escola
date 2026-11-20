-- =====================================================================
-- LIMPA AQUI — Fase 1 do PRD Mestre: fundação
--  * Categorias gerenciadas pelo admin (ativar/desativar, nome, grupo, unidades, ordem)
--    + categorias do PRD que faltavam (tapetes, higienização de calçados)
--  * Perfil de quem trabalha de casa: equipamentos, capacidade por dia e experiência
-- Só acrescenta: nada existente muda de comportamento (categorias atuais seguem ativas).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Categorias
-- ---------------------------------------------------------------------
alter table public.service_categories add column if not exists active boolean not null default true;

insert into public.service_categories (code, name, group_code, pricing_units, sort) values
  ('higienizacao_calcados', 'Higienização de calçados', 'calcados', '{par}',              55),
  ('lavagem_tapetes',       'Lavagem de tapetes',       'casa',     '{m2,peca,orcamento}', 85)
on conflict (code) do nothing;

-- Busca pública: só categorias ativas
create or replace function public.public_categories()
returns table (code text, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.code, c.name from public.service_categories c where c.active order by c.sort;
$$;

-- Anúncio novo só em categoria ativa (os já publicados continuam valendo)
create or replace function public.listings_category_active()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.service_categories c where c.code = new.category_code and c.active) then
    raise exception 'Esta categoria não está disponível no momento.' using errcode = '22023';
  end if;
  return new;
end;
$$;
drop trigger if exists listings_category_active on public.listings;
create trigger listings_category_active before insert on public.listings
  for each row execute function public.listings_category_active();

create or replace function public.admin_categories()
returns table (code text, name text, description text, group_code text, pricing_units public.pricing_unit[], sort integer,
               active boolean, businesses bigint, services bigint, listings bigint)
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
  select c.code, c.name, c.description, c.group_code, c.pricing_units, c.sort, c.active,
         (select count(*) from public.business_categories bc where bc.category_code = c.code),
         (select count(*) from public.services s where s.category_code = c.code),
         (select count(*) from public.listings l where l.category_code = c.code)
  from public.service_categories c
  order by c.sort, c.name;
end;
$$;

-- Cria ou altera uma categoria. O código não muda depois de criado (é usado em serviços e anúncios).
create or replace function public.admin_upsert_category(
  p_code text, p_name text, p_group_code text, p_pricing_units public.pricing_unit[],
  p_sort integer default null, p_active boolean default true, p_description text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := lower(trim(coalesce(p_code, '')));
begin
  if not public.has_role('admin') then
    raise exception 'Somente a administração da plataforma pode fazer isso.' using errcode = '42501';
  end if;
  if v_code !~ '^[a-z][a-z0-9_]{1,39}$' then
    raise exception 'Código inválido: use letras minúsculas, números e _ (ex.: lavagem_tapetes).' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(p_name, ''))) not between 2 and 60 then
    raise exception 'O nome precisa ter de 2 a 60 caracteres.' using errcode = '22023';
  end if;
  if p_group_code is null or p_group_code not in ('roupas', 'calcados', 'casa', 'estofados', 'acessorios', 'outros') then
    raise exception 'Grupo inválido.' using errcode = '22023';
  end if;
  if p_pricing_units is null or cardinality(p_pricing_units) = 0 then
    raise exception 'Escolha pelo menos uma forma de cobrança.' using errcode = '22023';
  end if;
  insert into public.service_categories (code, name, description, group_code, pricing_units, sort, active)
  values (v_code, trim(p_name), nullif(trim(p_description), ''), p_group_code, p_pricing_units,
          coalesce(p_sort, (select coalesce(max(sort), 0) + 10 from public.service_categories)), coalesce(p_active, true))
  on conflict (code) do update
    set name = excluded.name, description = excluded.description, group_code = excluded.group_code,
        pricing_units = excluded.pricing_units, sort = coalesce(p_sort, public.service_categories.sort), active = excluded.active;
end;
$$;

-- ---------------------------------------------------------------------
-- Perfil de trabalho (autônomo / quem trabalha de casa)
-- ---------------------------------------------------------------------
alter table public.businesses add column if not exists equipment text[] not null default '{}';
alter table public.businesses add column if not exists daily_capacity integer;
alter table public.businesses add column if not exists experience text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'businesses_equipment_check') then
    alter table public.businesses add constraint businesses_equipment_check check (
      equipment <@ array['maquina_lavar', 'tanquinho', 'secadora', 'centrifuga', 'ferro_passar', 'vaporizador',
                         'extratora', 'aspirador', 'kit_tenis', 'varal_amplo']::text[]);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'businesses_daily_capacity_check') then
    alter table public.businesses add constraint businesses_daily_capacity_check check (daily_capacity is null or daily_capacity between 1 and 1000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'businesses_experience_check') then
    alter table public.businesses add constraint businesses_experience_check check (experience is null or char_length(experience) <= 300);
  end if;
end $$;

create or replace function public.set_work_profile(p_business_id uuid, p_equipment text[], p_daily_capacity integer, p_experience text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_business_owner(p_business_id) then
    raise exception 'Somente o dono pode alterar o perfil de trabalho.' using errcode = '42501';
  end if;
  update public.businesses
     set equipment = coalesce((select array_agg(distinct e) from unnest(coalesce(p_equipment, '{}')) e), '{}'),
         daily_capacity = p_daily_capacity,
         experience = nullif(trim(coalesce(p_experience, '')), '')
   where id = p_business_id;
end;
$$;

revoke all on function public.admin_categories() from public, anon;
revoke all on function public.admin_upsert_category(text, text, text, public.pricing_unit[], integer, boolean, text) from public, anon;
revoke all on function public.set_work_profile(uuid, text[], integer, text) from public, anon;
revoke all on function public.public_categories() from public;
grant execute on function public.admin_categories() to authenticated;
grant execute on function public.admin_upsert_category(text, text, text, public.pricing_unit[], integer, boolean, text) to authenticated;
grant execute on function public.set_work_profile(uuid, text[], integer, text) to authenticated;
grant execute on function public.public_categories() to anon, authenticated;
