-- =====================================================================
-- LIMPA AQUI — Marketplace, Etapa 1: perfis, administrador e geografia
--  * user_roles: uma conta pode ter vários perfis (anunciante, prestador, entregador, admin)
--  * states / municipalities: estados e municípios (código IBGE); semente com os 92 do RJ
--  * businesses / customers ganham municipality_id (preenchido pela cidade/UF);
--    businesses ganha provider_type (autônomo ou empresa), derivado do assistente
-- O papel de admin NÃO é concedido por esta migration nem por nenhuma tela:
-- é dado manualmente no banco (insert em user_roles) a contas escolhidas pelo dono da plataforma.
-- =====================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type public.user_role as enum ('anunciante', 'prestador', 'entregador', 'admin');
  end if;
  if not exists (select 1 from pg_type where typname = 'role_status') then
    create type public.role_status as enum ('ativo', 'pendente', 'suspenso');
  end if;
  if not exists (select 1 from pg_type where typname = 'municipality_status') then
    create type public.municipality_status as enum ('cadastrado', 'ativo', 'suspenso');
  end if;
  if not exists (select 1 from pg_type where typname = 'provider_type') then
    create type public.provider_type as enum ('autonomo', 'empresa');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Perfis
-- ---------------------------------------------------------------------
create table if not exists public.user_roles (
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        public.user_role not null,
  status      public.role_status not null default 'ativo',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  decided_by  uuid references auth.users (id) on delete set null,
  primary key (user_id, role)
);

alter table public.user_roles enable row level security;

-- Papel ativo da pessoa logada
create or replace function public.has_role(p_role public.user_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles r
    where r.user_id = auth.uid() and r.role = p_role and r.status = 'ativo'
  );
$$;

-- Cada um vê os próprios perfis; o admin vê todos
create policy user_roles_select on public.user_roles
  for select to authenticated using (user_id = auth.uid() or public.has_role('admin'));

revoke all on public.user_roles from anon, authenticated;
grant select on public.user_roles to authenticated;

-- add_my_role: a pessoa acrescenta um perfil à própria conta.
-- Anunciante e prestador ficam ativos na hora; entregador fica pendente até o admin aprovar.
-- Admin nunca pode ser pedido por aqui. Perfil suspenso continua suspenso.
create or replace function public.add_my_role(p_role public.user_role)
returns public.role_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_status public.role_status;
begin
  if v_user is null then
    raise exception 'Faça login para continuar.' using errcode = '28000';
  end if;
  if p_role = 'admin' then
    raise exception 'Este perfil não pode ser escolhido.' using errcode = '42501';
  end if;
  insert into public.user_roles (user_id, role, status)
  values (v_user, p_role, case when p_role = 'entregador' then 'pendente' else 'ativo' end::public.role_status)
  on conflict (user_id, role) do nothing;
  select status into v_status from public.user_roles where user_id = v_user and role = p_role;
  return v_status;
end;
$$;

-- Quem entra numa lavanderia (dono ou funcionário) passa a ter o perfil de prestador
create or replace function public.member_gets_provider_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_roles (user_id, role, status) values (new.user_id, 'prestador', 'ativo')
  on conflict (user_id, role) do nothing;
  return new;
end;
$$;

drop trigger if exists business_members_provider_role on public.business_members;
create trigger business_members_provider_role
  after insert on public.business_members
  for each row execute function public.member_gets_provider_role();

-- Contas que já existem: todo membro de lavanderia vira prestador
insert into public.user_roles (user_id, role, status)
select distinct m.user_id, 'prestador'::public.user_role, 'ativo'::public.role_status
from public.business_members m
on conflict (user_id, role) do nothing;

-- ---------------------------------------------------------------------
-- Geografia
-- ---------------------------------------------------------------------
create table if not exists public.states (
  id    smallint primary key,            -- código IBGE da UF (RJ = 33)
  uf    char(2) not null unique check (uf ~ '^[A-Z]{2}$'),
  name  text not null
);

create table if not exists public.municipalities (
  id          integer primary key,        -- código IBGE do município (7 dígitos)
  state_id    smallint not null references public.states (id),
  name        text not null,
  name_key    text not null,              -- nome sem acento e em minúsculas, para casar com a cidade digitada
  status      public.municipality_status not null default 'cadastrado',
  lat         double precision check (lat is null or lat between -90 and 90),
  lng         double precision check (lng is null or lng between -180 and 180),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id) on delete set null,
  check (id between 1000000 and 9999999),
  unique (state_id, name_key)
);

create index if not exists municipalities_status_idx on public.municipalities (state_id, status);

-- Normaliza nome de cidade: minúsculas, sem acento, espaços simples
create or replace function public.city_key(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(regexp_replace(
    translate(lower(trim(coalesce(p, ''))),
      'áàâãäéèêëíìîïóòôõöúùûüçñ''`´',
      'aaaaaeeeeiiiiooooouuuucn   '),
    '\s+', ' ', 'g'), '');
$$;

insert into public.states (id, uf, name) values (33, 'RJ', 'Rio de Janeiro')
on conflict (id) do nothing;

insert into public.municipalities (id, state_id, name, name_key)
select v.id, v.state_id, v.name, public.city_key(v.name)
from (values
  (3300100, 33, 'Angra dos Reis'),
  (3300159, 33, 'Aperibé'),
  (3300209, 33, 'Araruama'),
  (3300225, 33, 'Areal'),
  (3300233, 33, 'Armação dos Búzios'),
  (3300258, 33, 'Arraial do Cabo'),
  (3300407, 33, 'Barra Mansa'),
  (3300308, 33, 'Barra do Piraí'),
  (3300456, 33, 'Belford Roxo'),
  (3300506, 33, 'Bom Jardim'),
  (3300605, 33, 'Bom Jesus do Itabapoana'),
  (3300704, 33, 'Cabo Frio'),
  (3300803, 33, 'Cachoeiras de Macacu'),
  (3300902, 33, 'Cambuci'),
  (3301009, 33, 'Campos dos Goytacazes'),
  (3301108, 33, 'Cantagalo'),
  (3300936, 33, 'Carapebus'),
  (3301157, 33, 'Cardoso Moreira'),
  (3301207, 33, 'Carmo'),
  (3301306, 33, 'Casimiro de Abreu'),
  (3300951, 33, 'Comendador Levy Gasparian'),
  (3301405, 33, 'Conceição de Macabu'),
  (3301504, 33, 'Cordeiro'),
  (3301603, 33, 'Duas Barras'),
  (3301702, 33, 'Duque de Caxias'),
  (3301801, 33, 'Engenheiro Paulo de Frontin'),
  (3301850, 33, 'Guapimirim'),
  (3301876, 33, 'Iguaba Grande'),
  (3301900, 33, 'Itaboraí'),
  (3302007, 33, 'Itaguaí'),
  (3302056, 33, 'Italva'),
  (3302106, 33, 'Itaocara'),
  (3302205, 33, 'Itaperuna'),
  (3302254, 33, 'Itatiaia'),
  (3302270, 33, 'Japeri'),
  (3302304, 33, 'Laje do Muriaé'),
  (3302403, 33, 'Macaé'),
  (3302452, 33, 'Macuco'),
  (3302502, 33, 'Magé'),
  (3302601, 33, 'Mangaratiba'),
  (3302700, 33, 'Maricá'),
  (3302809, 33, 'Mendes'),
  (3302858, 33, 'Mesquita'),
  (3302908, 33, 'Miguel Pereira'),
  (3303005, 33, 'Miracema'),
  (3303104, 33, 'Natividade'),
  (3303203, 33, 'Nilópolis'),
  (3303302, 33, 'Niterói'),
  (3303401, 33, 'Nova Friburgo'),
  (3303500, 33, 'Nova Iguaçu'),
  (3303609, 33, 'Paracambi'),
  (3303807, 33, 'Paraty'),
  (3303708, 33, 'Paraíba do Sul'),
  (3303856, 33, 'Paty do Alferes'),
  (3303906, 33, 'Petrópolis'),
  (3303955, 33, 'Pinheiral'),
  (3304003, 33, 'Piraí'),
  (3304102, 33, 'Porciúncula'),
  (3304110, 33, 'Porto Real'),
  (3304128, 33, 'Quatis'),
  (3304144, 33, 'Queimados'),
  (3304151, 33, 'Quissamã'),
  (3304201, 33, 'Resende'),
  (3304300, 33, 'Rio Bonito'),
  (3304409, 33, 'Rio Claro'),
  (3304508, 33, 'Rio das Flores'),
  (3304524, 33, 'Rio das Ostras'),
  (3304557, 33, 'Rio de Janeiro'),
  (3304607, 33, 'Santa Maria Madalena'),
  (3304706, 33, 'Santo Antônio de Pádua'),
  (3305406, 33, 'Sapucaia'),
  (3305505, 33, 'Saquarema'),
  (3305554, 33, 'Seropédica'),
  (3305604, 33, 'Silva Jardim'),
  (3305703, 33, 'Sumidouro'),
  (3304805, 33, 'São Fidélis'),
  (3304755, 33, 'São Francisco de Itabapoana'),
  (3304904, 33, 'São Gonçalo'),
  (3305133, 33, 'São José de Ubá'),
  (3305158, 33, 'São José do Vale do Rio Preto'),
  (3305000, 33, 'São João da Barra'),
  (3305109, 33, 'São João de Meriti'),
  (3305208, 33, 'São Pedro da Aldeia'),
  (3305307, 33, 'São Sebastião do Alto'),
  (3305752, 33, 'Tanguá'),
  (3305802, 33, 'Teresópolis'),
  (3305901, 33, 'Trajano de Moraes'),
  (3306008, 33, 'Três Rios'),
  (3306107, 33, 'Valença'),
  (3306156, 33, 'Varre-Sai'),
  (3306206, 33, 'Vassouras'),
  (3306305, 33, 'Volta Redonda')
) as v (id, state_id, name)
on conflict (id) do nothing;

alter table public.states enable row level security;
alter table public.municipalities enable row level security;

-- Catálogo público: qualquer pessoa (inclusive sem conta) lê estados e municípios
create policy states_select_all on public.states for select to anon, authenticated using (true);
create policy municipalities_select_all on public.municipalities for select to anon, authenticated using (true);
revoke all on public.states, public.municipalities from anon, authenticated;
grant select on public.states, public.municipalities to anon, authenticated;

-- Município a partir da cidade e UF digitadas (null se não reconhecer)
create or replace function public.find_municipality(p_city text, p_uf text)
returns integer
language sql
stable
set search_path = ''
as $$
  select m.id
  from public.municipalities m
  join public.states s on s.id = m.state_id
  where s.uf = upper(trim(coalesce(p_uf, ''))) and m.name_key = public.city_key(p_city);
$$;

-- ---------------------------------------------------------------------
-- businesses / customers: município e tipo de prestador
-- ---------------------------------------------------------------------
alter table public.businesses
  add column if not exists municipality_id integer references public.municipalities (id),
  add column if not exists provider_type   public.provider_type;
alter table public.customers
  add column if not exists municipality_id integer references public.municipalities (id);

create index if not exists businesses_municipality_idx on public.businesses (municipality_id);
create index if not exists customers_municipality_idx on public.customers (municipality_id);

-- Município sempre calculado pela cidade/UF (não dá para escolher um município que não bate com o endereço)
create or replace function public.set_municipality()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.municipality_id := public.find_municipality(new.city, new.state);
  return new;
end;
$$;

drop trigger if exists businesses_set_municipality on public.businesses;
create trigger businesses_set_municipality
  before insert or update of city, state, municipality_id on public.businesses
  for each row execute function public.set_municipality();
drop trigger if exists customers_set_municipality on public.customers;
create trigger customers_set_municipality
  before insert or update of city, state, municipality_id on public.customers
  for each row execute function public.set_municipality();

-- Tipo de prestador derivado da resposta "situação" do assistente
create or replace function public.provider_type_of(p_business_id uuid)
returns public.provider_type
language sql
stable
set search_path = ''
as $$
  select case p.situation
           when 'comecar_em_casa' then 'autonomo'
           when 'autonomo' then 'autonomo'
           when 'lavanderia' then 'empresa'
           when 'empresa_limpeza' then 'empresa'
         end::public.provider_type
  from public.onboarding_profiles p
  where p.business_id = p_business_id
  order by p.updated_at desc nulls last
  limit 1;
$$;

create or replace function public.set_provider_type()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.provider_type := coalesce(public.provider_type_of(new.id),
                                case when tg_op = 'UPDATE' then old.provider_type end);
  return new;
end;
$$;

drop trigger if exists businesses_set_provider_type on public.businesses;
create trigger businesses_set_provider_type
  before insert or update of provider_type on public.businesses
  for each row execute function public.set_provider_type();

-- Quando o assistente é concluído (ou refeito), recalcula o tipo da lavanderia
create or replace function public.onboarding_sync_provider_type()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.business_id is not null then
    perform set_config('limpaaqui.internal', 'on', true);
    update public.businesses set provider_type = public.provider_type_of(new.business_id) where id = new.business_id;
    perform set_config('limpaaqui.internal', 'off', true);
  end if;
  return new;
end;
$$;

drop trigger if exists onboarding_profiles_provider_type on public.onboarding_profiles;
create trigger onboarding_profiles_provider_type
  after insert or update of business_id, situation on public.onboarding_profiles
  for each row execute function public.onboarding_sync_provider_type();

-- Preenche o que já existe
select set_config('limpaaqui.internal', 'on', true);
update public.businesses set municipality_id = municipality_id, provider_type = provider_type;
update public.customers set municipality_id = municipality_id;
select set_config('limpaaqui.internal', 'off', true);

-- ---------------------------------------------------------------------
-- Administração (só quem tem o perfil admin ativo)
-- ---------------------------------------------------------------------
create or replace function public.admin_set_municipality_status(p_municipality_id integer, p_status public.municipality_status)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_role('admin') then
    raise exception 'Somente a administração da plataforma pode fazer isso.' using errcode = '42501';
  end if;
  update public.municipalities
     set status = p_status, updated_at = now(), updated_by = auth.uid()
   where id = p_municipality_id;
  if not found then
    raise exception 'Município não encontrado.' using errcode = 'P0001';
  end if;
end;
$$;

-- Lista pessoas de um perfil (ex.: entregadores aguardando aprovação), com nome e e-mail
create or replace function public.admin_list_role(p_role public.user_role)
returns table (user_id uuid, full_name text, email text, status public.role_status, created_at timestamptz, updated_at timestamptz)
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
  select r.user_id, p.full_name, u.email::text, r.status, r.created_at, r.updated_at
  from public.user_roles r
  join auth.users u on u.id = r.user_id
  left join public.profiles p on p.id = r.user_id
  where r.role = p_role
  order by (r.status = 'pendente') desc, r.created_at desc
  limit 500;
end;
$$;

-- Aprova, suspende ou reativa um perfil (nunca o de admin)
create or replace function public.admin_set_role_status(p_user_id uuid, p_role public.user_role, p_status public.role_status)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_role('admin') then
    raise exception 'Somente a administração da plataforma pode fazer isso.' using errcode = '42501';
  end if;
  if p_role = 'admin' then
    raise exception 'O perfil de administrador não é alterado por aqui.' using errcode = '42501';
  end if;
  update public.user_roles
     set status = p_status, updated_at = now(), decided_by = auth.uid()
   where user_id = p_user_id and role = p_role;
  if not found then
    raise exception 'Perfil não encontrado.' using errcode = 'P0001';
  end if;
end;
$$;

-- Resumo por município para o painel (cadastros que já existem em cada um)
create or replace function public.admin_municipality_overview(p_state_id smallint default 33)
returns table (id integer, name text, status public.municipality_status, providers bigint, companies bigint)
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
         count(b.id) filter (where b.provider_type = 'empresa')
  from public.municipalities m
  left join public.businesses b on b.municipality_id = m.id
  where m.state_id = p_state_id
  group by m.id
  order by m.name;
end;
$$;

revoke all on function public.has_role(public.user_role) from public;
revoke all on function public.add_my_role(public.user_role) from public, anon;
revoke all on function public.admin_set_municipality_status(integer, public.municipality_status) from public, anon;
revoke all on function public.admin_list_role(public.user_role) from public, anon;
revoke all on function public.admin_set_role_status(uuid, public.user_role, public.role_status) from public, anon;
revoke all on function public.admin_municipality_overview(smallint) from public, anon;
revoke all on function public.member_gets_provider_role() from public, anon, authenticated;
revoke all on function public.onboarding_sync_provider_type() from public, anon, authenticated;
grant execute on function public.has_role(public.user_role) to anon, authenticated;
grant execute on function public.add_my_role(public.user_role) to authenticated;
grant execute on function public.admin_set_municipality_status(integer, public.municipality_status) to authenticated;
grant execute on function public.admin_list_role(public.user_role) to authenticated;
grant execute on function public.admin_set_role_status(uuid, public.user_role, public.role_status) to authenticated;
grant execute on function public.admin_municipality_overview(smallint) to authenticated;

insert into public.reserved_slugs (slug) values ('admin'), ('conta'), ('comecar'), ('buscar'), ('entregas')
on conflict do nothing;
