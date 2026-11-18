-- =====================================================================
-- LIMPA AQUI — Fase 1, Etapa 1: Fundação
-- Perfis, lavanderias, membros, configurações, RLS e RPCs de onboarding
-- =====================================================================

-- ---------------------------------------------------------------------
-- Utilitário: updated_at automático
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'business_role') then
    create type public.business_role as enum ('owner', 'staff');
  end if;
end$$;

-- ---------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text check (full_name is null or char_length(full_name) between 2 and 120),
  phone       text check (phone is null or phone ~ '^[0-9]{10,13}$'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Cria o perfil automaticamente quando um usuário se cadastra
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- reserved_slugs: palavras que não podem ser endereço público
-- ---------------------------------------------------------------------
create table if not exists public.reserved_slugs (
  slug text primary key
);

insert into public.reserved_slugs (slug) values
  ('app'), ('login'), ('cadastro'), ('rastrear'), ('onboarding'), ('admin'),
  ('api'), ('recuperar-senha'), ('redefinir-senha'), ('encontre'), ('planos'),
  ('termos'), ('privacidade'), ('www'), ('suporte'), ('ajuda'), ('blog'),
  ('limpaaqui'), ('limpa-aqui'), ('auth'), ('static'), ('assets')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- businesses
-- ---------------------------------------------------------------------
create table if not exists public.businesses (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null check (char_length(trim(name)) between 2 and 80),
  slug               text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$' and slug !~ '--'),
  phone              text check (phone is null or phone ~ '^[0-9]{10,13}$'),
  whatsapp           text check (whatsapp is null or whatsapp ~ '^[0-9]{10,13}$'),
  city               text check (city is null or char_length(city) <= 80),
  state              char(2) check (state is null or state ~ '^[A-Z]{2}$'),
  neighborhood       text check (neighborhood is null or char_length(neighborhood) <= 80),
  next_order_number  integer not null default 1 check (next_order_number > 0),
  created_by         uuid not null references auth.users (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create trigger businesses_updated_at
  before update on public.businesses
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- business_members
-- ---------------------------------------------------------------------
create table if not exists public.business_members (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  role         public.business_role not null default 'staff',
  created_at   timestamptz not null default now(),
  unique (business_id, user_id)
);

create index if not exists business_members_user_idx on public.business_members (user_id);

-- ---------------------------------------------------------------------
-- business_settings
-- ---------------------------------------------------------------------
create table if not exists public.business_settings (
  business_id       uuid primary key references public.businesses (id) on delete cascade,
  default_due_days  integer not null default 3 check (default_due_days between 1 and 60),
  timezone          text not null default 'America/Sao_Paulo',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger business_settings_updated_at
  before update on public.business_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Funções de acesso (usadas pelas políticas RLS)
-- ---------------------------------------------------------------------
create or replace function public.is_business_member(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.business_members m
    where m.business_id = p_business_id
      and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_business_owner(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.business_members m
    where m.business_id = p_business_id
      and m.user_id = auth.uid()
      and m.role = 'owner'
  );
$$;

-- ---------------------------------------------------------------------
-- Proteção: campos que o usuário não pode alterar em businesses
-- (slug, numeração e autor só mudam por função do servidor)
-- ---------------------------------------------------------------------
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
  return new;
end;
$$;

create trigger businesses_protect_columns
  before update on public.businesses
  for each row execute function public.protect_business_columns();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.profiles          enable row level security;
alter table public.businesses        enable row level security;
alter table public.business_members  enable row level security;
alter table public.business_settings enable row level security;
alter table public.reserved_slugs    enable row level security;

-- profiles: cada um vê e edita só o próprio perfil
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = auth.uid());
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- businesses: membros leem; só o dono edita; criação apenas via RPC
create policy businesses_select_member on public.businesses
  for select to authenticated using (public.is_business_member(id));
create policy businesses_update_owner on public.businesses
  for update to authenticated
  using (public.is_business_owner(id))
  with check (public.is_business_owner(id));

-- business_members: membros veem a equipe da própria lavanderia; escrita só via RPC
create policy business_members_select_member on public.business_members
  for select to authenticated using (public.is_business_member(business_id));

-- business_settings: membros leem; dono edita
create policy business_settings_select_member on public.business_settings
  for select to authenticated using (public.is_business_member(business_id));
create policy business_settings_update_owner on public.business_settings
  for update to authenticated
  using (public.is_business_owner(business_id))
  with check (public.is_business_owner(business_id));

-- reserved_slugs: sem políticas = ninguém lê/escreve diretamente (só funções)

-- Privilégios explícitos (defesa em profundidade)
revoke all on public.profiles, public.businesses, public.business_members,
              public.business_settings, public.reserved_slugs from anon;
revoke insert, delete on public.businesses, public.business_members, public.business_settings from authenticated;
revoke insert, delete on public.profiles from authenticated;
revoke all on public.reserved_slugs from authenticated;
grant select, update on public.profiles, public.businesses, public.business_settings to authenticated;
grant select on public.business_members to authenticated;

-- ---------------------------------------------------------------------
-- RPC: verificar disponibilidade de slug
-- Retorna 'ok' | 'invalid' | 'reserved' | 'taken'
-- ---------------------------------------------------------------------
create or replace function public.check_slug_available(p_slug text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_slug text := lower(trim(coalesce(p_slug, '')));
begin
  if v_slug !~ '^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$' or v_slug ~ '--' then
    return 'invalid';
  end if;
  if exists (select 1 from public.reserved_slugs r where r.slug = v_slug) then
    return 'reserved';
  end if;
  if exists (select 1 from public.businesses b where b.slug = v_slug) then
    return 'taken';
  end if;
  return 'ok';
end;
$$;

-- ---------------------------------------------------------------------
-- RPC: criar lavanderia (transação única: empresa + dono + configurações)
-- ---------------------------------------------------------------------
create or replace function public.create_business(
  p_name          text,
  p_slug          text,
  p_whatsapp      text default null,
  p_city          text default null,
  p_state         text default null,
  p_neighborhood  text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user   uuid := auth.uid();
  v_slug   text := lower(trim(coalesce(p_slug, '')));
  v_status text;
  v_id     uuid;
begin
  if v_user is null then
    raise exception 'Faça login para continuar.' using errcode = '28000';
  end if;

  -- Fase 1: um usuário administra uma única lavanderia
  if exists (select 1 from public.business_members m where m.user_id = v_user) then
    raise exception 'Você já possui uma lavanderia cadastrada.' using errcode = 'P0001';
  end if;

  if char_length(trim(coalesce(p_name, ''))) < 2 then
    raise exception 'Informe o nome da lavanderia.' using errcode = '22023';
  end if;

  v_status := public.check_slug_available(v_slug);
  if v_status = 'invalid' then
    raise exception 'Endereço inválido: use de 3 a 40 letras minúsculas, números e hífens.' using errcode = '22023';
  elsif v_status = 'reserved' then
    raise exception 'Este endereço é reservado pelo sistema. Escolha outro.' using errcode = '22023';
  elsif v_status = 'taken' then
    raise exception 'Este endereço já está em uso. Escolha outro.' using errcode = '23505';
  end if;

  insert into public.businesses (name, slug, whatsapp, city, state, neighborhood, created_by)
  values (
    trim(p_name),
    v_slug,
    nullif(regexp_replace(coalesce(p_whatsapp, ''), '\D', '', 'g'), ''),
    nullif(trim(coalesce(p_city, '')), ''),
    nullif(upper(trim(coalesce(p_state, ''))), ''),
    nullif(trim(coalesce(p_neighborhood, '')), ''),
    v_user
  )
  returning id into v_id;

  insert into public.business_members (business_id, user_id, role)
  values (v_id, v_user, 'owner');

  insert into public.business_settings (business_id) values (v_id);

  return v_id;
end;
$$;

revoke all on function public.create_business(text, text, text, text, text, text) from public, anon;
grant execute on function public.create_business(text, text, text, text, text, text) to authenticated;

revoke all on function public.check_slug_available(text) from public, anon;
grant execute on function public.check_slug_available(text) to authenticated;

revoke all on function public.is_business_member(uuid) from public, anon;
revoke all on function public.is_business_owner(uuid) from public, anon;
grant execute on function public.is_business_member(uuid) to authenticated;
grant execute on function public.is_business_owner(uuid) to authenticated;

revoke all on function public.handle_new_user() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Diagnóstico: tabelas do schema public sem RLS (deve retornar vazio)
-- Uso: select * from public.tables_without_rls();
-- ---------------------------------------------------------------------
create or replace function public.tables_without_rls()
returns table (table_name text)
language sql
stable
set search_path = ''
as $$
  select c.relname::text
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and not c.relrowsecurity;
$$;

revoke all on function public.tables_without_rls() from public, anon, authenticated;
