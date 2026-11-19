-- =====================================================================
-- LIMPA AQUI — Marketplace, Etapa 6: logística opcional com entregadores
--  * couriers / courier_areas: cadastro do entregador (veículo, 4 últimos dígitos do CPF, municípios)
--    — a aprovação continua no perfil "entregador" (user_roles), feita pelo admin
--  * delivery_zones: tarifa por município (base, por km, mínimo, fator de rota), editável pelo admin
--  * deliveries: corridas independentes de coleta (pickup) e devolução (return); entregadores podem ser diferentes
--  * contratação com "entregador": só se o município tem tarifa ativa e entregador aprovado; o cliente vê o valor antes
--  * a corrida de coleta nasce com o pedido; a de devolução, quando a lavanderia marca "pronto"
--  * pagamento da corrida (pagamento direto): o cliente paga ao entregador; registrado no livro-razão
-- =====================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'vehicle_type') then
    create type public.vehicle_type as enum ('bicicleta', 'moto', 'carro');
  end if;
  if not exists (select 1 from pg_type where typname = 'delivery_leg') then
    create type public.delivery_leg as enum ('pickup', 'return');
  end if;
  if not exists (select 1 from pg_type where typname = 'delivery_status') then
    create type public.delivery_status as enum ('disponivel', 'aceita', 'coletada', 'entregue', 'cancelada');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Entregadores
-- ---------------------------------------------------------------------
create table if not exists public.couriers (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  vehicle    public.vehicle_type not null,
  cpf_last4  char(4) not null check (cpf_last4 ~ '^[0-9]{4}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger couriers_updated_at
  before update on public.couriers
  for each row execute function public.set_updated_at();

create table if not exists public.courier_areas (
  user_id         uuid not null references public.couriers (user_id) on delete cascade,
  municipality_id integer not null references public.municipalities (id),
  active          boolean not null default true,
  primary key (user_id, municipality_id)
);

create index if not exists courier_areas_municipality_idx on public.courier_areas (municipality_id) where active;

alter table public.couriers enable row level security;
alter table public.courier_areas enable row level security;
create policy couriers_select on public.couriers for select to authenticated using (user_id = auth.uid() or public.has_role('admin'));
create policy courier_areas_select on public.courier_areas for select to authenticated using (user_id = auth.uid() or public.has_role('admin'));
revoke all on public.couriers, public.courier_areas from anon, authenticated;
grant select on public.couriers, public.courier_areas to authenticated;

-- Entregador (pendente ou aprovado) salva o próprio cadastro
create or replace function public.save_courier_profile(
  p_vehicle public.vehicle_type, p_cpf_last4 text, p_phone text, p_municipalities integer[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
begin
  if v_user is null or not exists (select 1 from public.user_roles where user_id = v_user and role = 'entregador' and status <> 'suspenso') then
    raise exception 'Ative o perfil "Fazer entregas" na sua conta.' using errcode = '42501';
  end if;
  if p_cpf_last4 is null or p_cpf_last4 !~ '^[0-9]{4}$' then
    raise exception 'Informe os 4 últimos números do CPF.' using errcode = '22023';
  end if;
  if char_length(v_phone) not between 10 and 11 then
    raise exception 'Informe seu WhatsApp com DDD.' using errcode = '22023';
  end if;
  if p_municipalities is null or cardinality(p_municipalities) = 0 or cardinality(p_municipalities) > 15 then
    raise exception 'Escolha de 1 a 15 municípios onde você faz entregas.' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_municipalities) x where not exists (select 1 from public.municipalities m where m.id = x)) then
    raise exception 'Município inválido.' using errcode = '22023';
  end if;

  insert into public.couriers (user_id, vehicle, cpf_last4) values (v_user, p_vehicle, p_cpf_last4)
  on conflict (user_id) do update set vehicle = excluded.vehicle, cpf_last4 = excluded.cpf_last4;
  update public.profiles set phone = v_phone where id = v_user;
  delete from public.courier_areas where user_id = v_user and municipality_id <> all (p_municipalities);
  insert into public.courier_areas (user_id, municipality_id)
  select v_user, x from unnest(p_municipalities) x on conflict do nothing;
end;
$$;

-- ---------------------------------------------------------------------
-- Tarifas por município (admin)
-- ---------------------------------------------------------------------
create table if not exists public.delivery_zones (
  municipality_id integer primary key references public.municipalities (id),
  base_fee        numeric(8, 2) not null check (base_fee between 0 and 500),
  price_per_km    numeric(8, 2) not null check (price_per_km between 0 and 50),
  min_fee         numeric(8, 2) not null default 0 check (min_fee between 0 and 500),
  road_factor     numeric(4, 2) not null default 1.30 check (road_factor between 1 and 3),
  max_km          numeric(6, 1) not null default 30 check (max_km between 1 and 200),
  active          boolean not null default true,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users (id) on delete set null
);

alter table public.delivery_zones enable row level security;
create policy delivery_zones_select_admin on public.delivery_zones for select to authenticated using (public.has_role('admin'));
revoke all on public.delivery_zones from anon, authenticated;
grant select on public.delivery_zones to authenticated;

-- Município tem logística: tarifa ativa e pelo menos 1 entregador aprovado que atende lá
create or replace function public.municipality_has_logistics(p_municipality_id integer)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.delivery_zones z where z.municipality_id = p_municipality_id and z.active)
     and exists (select 1 from public.courier_areas a
                 join public.user_roles r on r.user_id = a.user_id and r.role = 'entregador' and r.status = 'ativo'
                 where a.municipality_id = p_municipality_id and a.active);
$$;

-- Cotação de uma perna (coleta ou devolução) entre o cliente e a lavanderia
create or replace function public.delivery_quote_core(p_business public.businesses, p_addr public.user_addresses)
returns table (available boolean, reason text, distance_km numeric, fee numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  z public.delivery_zones;
  d numeric;
begin
  select * into z from public.delivery_zones where municipality_id = p_addr.municipality_id and active;
  if z.municipality_id is null or not public.municipality_has_logistics(p_addr.municipality_id) then
    return query select false, 'Ainda não há entregadores do Limpa Aqui no seu município.'::text, null::numeric, null::numeric;
    return;
  end if;
  if p_addr.lat is null or p_addr.lng is null then
    return query select false, 'Marque seu endereço no mapa (busca do Google no cadastro de endereço) para calcular a entrega.'::text, null::numeric, null::numeric;
    return;
  end if;
  if p_business.lat is null or p_business.lng is null then
    return query select false, 'Este prestador ainda não marcou o endereço no mapa.'::text, null::numeric, null::numeric;
    return;
  end if;
  d := round((public.distance_km(p_addr.lat, p_addr.lng, p_business.lat, p_business.lng) * z.road_factor)::numeric, 1);
  if d > z.max_km then
    return query select false, 'A distância passa do limite de entrega do município.'::text, d, null::numeric;
    return;
  end if;
  return query select true, null::text, d, greatest(z.min_fee, round(z.base_fee + z.price_per_km * d, 2));
end;
$$;

-- Cotação para a tela de contratar (valor por perna; o pedido tem coleta + devolução)
create or replace function public.quote_delivery(p_business_id uuid, p_address_id uuid)
returns table (available boolean, reason text, distance_km numeric, fee_per_leg numeric, total numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  b public.businesses;
  a public.user_addresses;
  q record;
begin
  select * into a from public.user_addresses where id = p_address_id and user_id = auth.uid();
  select * into b from public.businesses where id = p_business_id;
  if a.id is null or b.id is null or not public.provider_listable(b) then
    return query select false, 'Endereço ou prestador não encontrado.'::text, null::numeric, null::numeric, null::numeric;
    return;
  end if;
  select * into q from public.delivery_quote_core(b, a);
  return query select q.available, q.reason, q.distance_km, q.fee, case when q.available then q.fee * 2 end;
end;
$$;

-- Cotação para aceitar uma proposta (endereço do anúncio x prestador da proposta)
create or replace function public.quote_proposal_delivery(p_proposal_id uuid)
returns table (available boolean, reason text, distance_km numeric, fee_per_leg numeric, total numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p public.proposals;
  l public.listings;
  b public.businesses;
  a public.user_addresses;
  q record;
begin
  select * into p from public.proposals x where x.id = p_proposal_id;
  select * into l from public.listings x where x.id = p.listing_id;
  if p.id is null or l.user_id is distinct from auth.uid() then
    return query select false, 'Proposta não encontrada.'::text, null::numeric, null::numeric, null::numeric;
    return;
  end if;
  select * into b from public.businesses x where x.id = p.business_id;
  select * into a from public.user_addresses x where x.id = l.address_id;
  if a.id is null then
    return query select false, 'O endereço deste anúncio foi apagado.'::text, null::numeric, null::numeric, null::numeric;
    return;
  end if;
  select * into q from public.delivery_quote_core(b, a);
  return query select q.available, q.reason, q.distance_km, q.fee, case when q.available then q.fee * 2 end;
end;
$$;

-- ---------------------------------------------------------------------
-- Corridas
-- ---------------------------------------------------------------------
alter table public.orders
  add column if not exists delivery_fee_total numeric(10, 2) not null default 0 check (delivery_fee_total >= 0),
  add column if not exists delivery_fee_leg   numeric(10, 2);

create table if not exists public.deliveries (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null references public.orders (id) on delete cascade,
  business_id        uuid not null references public.businesses (id) on delete cascade,
  leg                public.delivery_leg not null,
  municipality_id    integer not null references public.municipalities (id),
  courier_id         uuid references auth.users (id) on delete set null,
  origin_label       text not null,
  origin_address     text not null,
  origin_neighborhood text,
  origin_lat         double precision,
  origin_lng         double precision,
  dest_label         text not null,
  dest_address       text not null,
  dest_neighborhood  text,
  dest_lat           double precision,
  dest_lng           double precision,
  distance_km        numeric(6, 1) not null,
  delivery_fee       numeric(10, 2) not null check (delivery_fee >= 0),
  courier_earnings   numeric(10, 2) not null check (courier_earnings >= 0),
  status             public.delivery_status not null default 'disponivel',
  accepted_at        timestamptz,
  picked_at          timestamptz,
  completed_at       timestamptz,
  canceled_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index if not exists deliveries_one_active_leg on public.deliveries (order_id, leg) where status <> 'cancelada';
create index if not exists deliveries_open_idx on public.deliveries (municipality_id, created_at) where status = 'disponivel';
create index if not exists deliveries_courier_idx on public.deliveries (courier_id, created_at desc);

create trigger deliveries_updated_at
  before update on public.deliveries
  for each row execute function public.set_updated_at();

alter table public.deliveries enable row level security;
-- lavanderia, cliente do pedido, entregador da corrida e admin; corridas livres só pela RPC (sem endereço exato)
create policy deliveries_select on public.deliveries for select to authenticated
  using (courier_id = auth.uid() or public.is_business_member(business_id) or public.has_role('admin')
         or exists (select 1 from public.orders o where o.id = order_id and o.client_user_id = auth.uid()));
revoke all on public.deliveries from anon, authenticated;
grant select on public.deliveries to authenticated;

create or replace function public.address_text(p_street text, p_number text, p_complement text, p_neighborhood text, p_city text, p_state text)
returns text
language sql
immutable
set search_path = ''
as $$
  select concat_ws(' - ',
    nullif(concat_ws(', ', nullif(trim(coalesce(p_street, '')), ''), nullif(trim(coalesce(p_number, '')), '')), ''),
    nullif(trim(coalesce(p_complement, '')), ''),
    nullif(trim(coalesce(p_neighborhood, '')), ''),
    nullif(concat_ws('/', nullif(trim(coalesce(p_city, '')), ''), nullif(trim(coalesce(p_state, '')), '')), ''));
$$;

-- Cria uma perna para o pedido (interna)
create or replace function public.create_delivery_leg(p_order_id uuid, p_leg public.delivery_leg)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  b public.businesses;
  c public.customers;
  cli text;
  biz text;
  v_id uuid;
begin
  select * into o from public.orders where id = p_order_id;
  select * into b from public.businesses where id = o.business_id;
  select * into c from public.customers where id = o.customer_id;
  cli := public.address_text(c.street, c.street_number, c.complement, c.neighborhood, c.city, c.state);
  biz := public.address_text(b.street, b.street_number, b.complement, b.neighborhood, b.city, b.state);
  insert into public.deliveries (order_id, business_id, leg, municipality_id,
                                 origin_label, origin_address, origin_neighborhood, origin_lat, origin_lng,
                                 dest_label, dest_address, dest_neighborhood, dest_lat, dest_lng,
                                 distance_km, delivery_fee, courier_earnings)
  select o.id, o.business_id, p_leg, c.municipality_id,
         case when p_leg = 'pickup' then 'Cliente: ' || c.name else b.name end,
         case when p_leg = 'pickup' then cli else biz end,
         case when p_leg = 'pickup' then c.neighborhood else b.neighborhood end,
         case when p_leg = 'pickup' then c.lat else b.lat end,
         case when p_leg = 'pickup' then c.lng else b.lng end,
         case when p_leg = 'pickup' then b.name else 'Cliente: ' || c.name end,
         case when p_leg = 'pickup' then biz else cli end,
         case when p_leg = 'pickup' then b.neighborhood else c.neighborhood end,
         case when p_leg = 'pickup' then b.lat else c.lat end,
         case when p_leg = 'pickup' then b.lng else c.lng end,
         coalesce(round((public.distance_km(c.lat, c.lng, b.lat, b.lng) *
                         coalesce((select z.road_factor from public.delivery_zones z where z.municipality_id = c.municipality_id), 1.3))::numeric, 1), 0),
         o.delivery_fee_leg, o.delivery_fee_leg
  returning id into v_id;
  perform public.ledger_add('corrida_criada', o.id, o.business_id, o.payment_mode, o.delivery_fee_leg, jsonb_build_object('leg', p_leg, 'delivery_id', v_id));
  return v_id;
end;
$$;

-- Pedido muda: "pronto" cria a devolução; cancelado cancela as corridas que não terminaram
create or replace function public.order_logistics()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.logistics_mode is distinct from 'entregador' then
    return new;
  end if;
  if new.status = 'pronto' and old.status <> 'pronto'
     and not exists (select 1 from public.deliveries d where d.order_id = new.id and d.leg = 'return' and d.status <> 'cancelada') then
    perform public.create_delivery_leg(new.id, 'return');
  end if;
  if new.status = 'cancelado' and old.status <> 'cancelado' then
    update public.deliveries set status = 'cancelada', canceled_at = now()
     where order_id = new.id and status in ('disponivel', 'aceita');
  end if;
  return new;
end;
$$;

create trigger orders_logistics
  after update of status on public.orders
  for each row execute function public.order_logistics();

-- ---------------------------------------------------------------------
-- Entregador: corridas livres, aceitar, avançar, desistir
-- ---------------------------------------------------------------------
create or replace function public.courier_available_deliveries()
returns table (id uuid, leg public.delivery_leg, municipality_name text, origin_neighborhood text, dest_neighborhood text,
               distance_km numeric, delivery_fee numeric, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_role('entregador') then
    raise exception 'Seu cadastro de entregador ainda não foi aprovado.' using errcode = '42501';
  end if;
  return query
  select d.id, d.leg, m.name, d.origin_neighborhood, d.dest_neighborhood, d.distance_km, d.delivery_fee, d.created_at
  from public.deliveries d
  join public.municipalities m on m.id = d.municipality_id
  where d.status = 'disponivel'
    and exists (select 1 from public.courier_areas a where a.user_id = auth.uid() and a.municipality_id = d.municipality_id and a.active)
  order by d.created_at
  limit 50;
end;
$$;

create or replace function public.accept_delivery(p_delivery_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.deliveries;
begin
  if not public.has_role('entregador') then
    raise exception 'Seu cadastro de entregador ainda não foi aprovado.' using errcode = '42501';
  end if;
  select * into d from public.deliveries where id = p_delivery_id for update;
  if d.id is null or not exists (select 1 from public.courier_areas a where a.user_id = auth.uid() and a.municipality_id = d.municipality_id and a.active) then
    raise exception 'Corrida não encontrada.' using errcode = 'P0001';
  end if;
  if d.status <> 'disponivel' then
    raise exception 'Outra pessoa já pegou esta corrida.' using errcode = 'P0001';
  end if;
  update public.deliveries set status = 'aceita', courier_id = auth.uid(), accepted_at = now() where id = d.id;
end;
$$;

create or replace function public.release_delivery(p_delivery_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.deliveries set status = 'disponivel', courier_id = null, accepted_at = null
   where id = p_delivery_id and courier_id = auth.uid() and status = 'aceita';
  if not found then
    raise exception 'Só dá para desistir de corrida aceita e ainda não coletada.' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.advance_delivery(p_delivery_id uuid, p_status public.delivery_status)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.deliveries;
  o public.orders;
begin
  select * into d from public.deliveries where id = p_delivery_id for update;
  if d.id is null or d.courier_id is distinct from auth.uid() then
    raise exception 'Corrida não encontrada.' using errcode = 'P0001';
  end if;
  if not ((d.status = 'aceita' and p_status = 'coletada') or (d.status = 'coletada' and p_status = 'entregue')) then
    raise exception 'Mudança de situação não permitida.' using errcode = 'P0001';
  end if;
  update public.deliveries
     set status = p_status,
         picked_at = case when p_status = 'coletada' then now() else picked_at end,
         completed_at = case when p_status = 'entregue' then now() else completed_at end
   where id = d.id;

  if p_status = 'entregue' then
    select * into o from public.orders where id = d.order_id;
    perform public.ledger_add('corrida_concluida', d.order_id, d.business_id, o.payment_mode, d.delivery_fee,
                              jsonb_build_object('leg', d.leg, 'delivery_id', d.id, 'courier_earnings', d.courier_earnings));
    -- devolução entregue: o pedido está entregue ao cliente
    if d.leg = 'return' and o.status = 'pronto' then
      perform set_config('limpaaqui.internal', 'on', true);
      update public.orders set status = 'entregue', delivered_at = now() where id = o.id;
      perform set_config('limpaaqui.internal', 'off', true);
    end if;
  end if;
end;
$$;

-- Corridas do entregador, com endereços completos e contatos (só depois de aceitar)
create or replace function public.my_deliveries()
returns table (id uuid, leg public.delivery_leg, status public.delivery_status, order_number integer,
               origin_label text, origin_address text, origin_lat double precision, origin_lng double precision, origin_phone text,
               dest_label text, dest_address text, dest_lat double precision, dest_lng double precision, dest_phone text,
               distance_km numeric, delivery_fee numeric, courier_earnings numeric, payment_mode public.payment_mode,
               accepted_at timestamptz, completed_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id, d.leg, d.status, o.number,
         d.origin_label, d.origin_address, d.origin_lat, d.origin_lng,
         case when d.leg = 'pickup' then coalesce(c.whatsapp, p.phone) else b.whatsapp end,
         d.dest_label, d.dest_address, d.dest_lat, d.dest_lng,
         case when d.leg = 'pickup' then b.whatsapp else coalesce(c.whatsapp, p.phone) end,
         d.distance_km, d.delivery_fee, d.courier_earnings, o.payment_mode, d.accepted_at, d.completed_at
  from public.deliveries d
  join public.orders o on o.id = d.order_id
  join public.businesses b on b.id = d.business_id
  join public.customers c on c.id = o.customer_id
  left join public.profiles p on p.id = o.client_user_id
  where d.courier_id = auth.uid()
  order by (d.status in ('aceita', 'coletada')) desc, d.created_at desc
  limit 100;
$$;

-- Corridas de um pedido (lavanderia e cliente)
create or replace function public.order_deliveries(p_order_id uuid)
returns table (id uuid, leg public.delivery_leg, status public.delivery_status, courier_name text, delivery_fee numeric,
               accepted_at timestamptz, picked_at timestamptz, completed_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o public.orders;
begin
  select * into o from public.orders x where x.id = p_order_id;
  if o.id is null or not (public.is_business_member(o.business_id) or o.client_user_id = auth.uid() or public.has_role('admin')) then
    raise exception 'Pedido não encontrado.' using errcode = 'P0001';
  end if;
  return query
  select d.id, d.leg, d.status, split_part(coalesce(p.full_name, ''), ' ', 1), d.delivery_fee, d.accepted_at, d.picked_at, d.completed_at
  from public.deliveries d left join public.profiles p on p.id = d.courier_id
  where d.order_id = o.id
  order by d.created_at;
end;
$$;

-- ---------------------------------------------------------------------
-- Admin: tarifas e entregadores
-- ---------------------------------------------------------------------
create or replace function public.admin_upsert_delivery_zone(
  p_municipality_id integer, p_base_fee numeric, p_price_per_km numeric, p_min_fee numeric default 0,
  p_road_factor numeric default 1.30, p_max_km numeric default 30, p_active boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_role('admin') then
    raise exception 'Somente a administração da plataforma pode fazer isso.' using errcode = '42501';
  end if;
  insert into public.delivery_zones (municipality_id, base_fee, price_per_km, min_fee, road_factor, max_km, active, updated_by)
  values (p_municipality_id, p_base_fee, p_price_per_km, coalesce(p_min_fee, 0), coalesce(p_road_factor, 1.30), coalesce(p_max_km, 30), coalesce(p_active, true), auth.uid())
  on conflict (municipality_id) do update
    set base_fee = excluded.base_fee, price_per_km = excluded.price_per_km, min_fee = excluded.min_fee,
        road_factor = excluded.road_factor, max_km = excluded.max_km, active = excluded.active,
        updated_at = now(), updated_by = auth.uid();
  perform public.ledger_add('tarifa_entrega_alterada', null, null, null, 0,
                            jsonb_build_object('municipality', p_municipality_id, 'base', p_base_fee, 'per_km', p_price_per_km,
                                               'min', p_min_fee, 'active', p_active));
end;
$$;

create or replace function public.admin_logistics_overview()
returns table (municipality_id integer, name text, status public.municipality_status, has_zone boolean, zone_active boolean,
               base_fee numeric, price_per_km numeric, min_fee numeric, road_factor numeric, max_km numeric,
               couriers_approved bigint, has_logistics boolean, open_deliveries bigint)
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
  select m.id, m.name, m.status, z.municipality_id is not null, coalesce(z.active, false),
         z.base_fee, z.price_per_km, z.min_fee, z.road_factor, z.max_km,
         (select count(*) from public.courier_areas a join public.user_roles r on r.user_id = a.user_id and r.role = 'entregador' and r.status = 'ativo'
          where a.municipality_id = m.id and a.active),
         public.municipality_has_logistics(m.id),
         (select count(*) from public.deliveries d where d.municipality_id = m.id and d.status = 'disponivel')
  from public.municipalities m
  left join public.delivery_zones z on z.municipality_id = m.id
  where m.state_id = 33
  order by m.name;
end;
$$;

create or replace function public.admin_couriers()
returns table (user_id uuid, full_name text, email text, phone text, vehicle public.vehicle_type, cpf_last4 text,
               areas text[], status public.role_status, created_at timestamptz, completed bigint)
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
  select r.user_id, p.full_name, u.email::text, p.phone, c.vehicle, c.cpf_last4::text,
         coalesce((select array_agg(m.name order by m.name) from public.courier_areas a join public.municipalities m on m.id = a.municipality_id
                   where a.user_id = r.user_id and a.active), '{}'),
         r.status, r.created_at,
         (select count(*) from public.deliveries d where d.courier_id = r.user_id and d.status = 'entregue')
  from public.user_roles r
  join auth.users u on u.id = r.user_id
  left join public.profiles p on p.id = r.user_id
  left join public.couriers c on c.user_id = r.user_id
  where r.role = 'entregador'
  order by (r.status = 'pendente') desc, r.created_at desc
  limit 500;
end;
$$;

-- ---------------------------------------------------------------------
-- Contratação: agora aceita "entregador" (com cotação) — mesma função da Etapa 4, com a logística
-- ---------------------------------------------------------------------
create or replace function public.marketplace_place_order(
  p_business_id uuid, p_address_id uuid, p_items jsonb, p_custom_name text, p_custom_price numeric,
  p_due_days integer, p_payment public.payment_mode, p_logistics public.logistics_mode, p_pickup_ok boolean,
  p_notes text, p_listing_id uuid, p_proposal_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user     uuid := auth.uid();
  b          public.businesses;
  v_addr     public.user_addresses;
  v_prof     public.profiles;
  v_customer uuid;
  v_number   integer;
  v_order    uuid;
  v_tz       text;
  v_default  integer;
  v_res      record;
  v_total    numeric;
  v_days     integer;
  v_quote    record;
  v_fee      numeric;
begin
  if v_user is null then
    raise exception 'Faça login para continuar.' using errcode = '28000';
  end if;
  select * into b from public.businesses where id = p_business_id;
  if b.id is null or not public.provider_listable(b) then
    raise exception 'Este prestador não está recebendo pedidos pelo Limpa Aqui no momento.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.business_members bm where bm.business_id = b.id and bm.user_id = v_user) then
    raise exception 'Você não pode contratar a sua própria lavanderia.' using errcode = 'P0001';
  end if;

  select * into v_addr from public.user_addresses where id = p_address_id and user_id = v_user;
  if v_addr.id is null then
    raise exception 'Escolha um dos seus endereços.' using errcode = 'P0001';
  end if;
  if v_addr.municipality_id is null
     or not exists (select 1 from public.municipalities m where m.id = v_addr.municipality_id and m.status = 'ativo')
     or not public.provider_serves(b.id, b.municipality_id, v_addr.municipality_id) then
    raise exception 'Este prestador não atende o município desse endereço.' using errcode = 'P0001';
  end if;

  select * into v_prof from public.profiles where id = v_user;
  if v_prof.phone is null then
    raise exception 'Informe seu WhatsApp na sua área de cliente para o prestador falar com você.' using errcode = 'P0001';
  end if;

  if p_payment = 'app' then
    raise exception 'O pagamento pelo app chega em breve. Por enquanto, pague direto ao prestador.' using errcode = 'P0001';
  end if;
  if p_payment is null or (p_payment = 'direto' and not b.accepts_direct_payment) then
    raise exception 'Este prestador não aceita essa forma de pagamento.' using errcode = 'P0001';
  end if;
  if p_logistics is null or (p_logistics = 'prestador' and not p_pickup_ok) then
    raise exception 'Este prestador não faz coleta e entrega.' using errcode = 'P0001';
  end if;
  if p_logistics = 'entregador' then
    select * into v_quote from public.delivery_quote_core(b, v_addr);
    if not v_quote.available then
      raise exception '%', v_quote.reason using errcode = 'P0001';
    end if;
    v_fee := v_quote.fee;
  end if;
  if p_notes is not null and char_length(p_notes) > 500 then
    raise exception 'Observações muito longas (máximo de 500 caracteres).' using errcode = '22023';
  end if;

  select id into v_customer from public.customers where business_id = b.id and user_id = v_user;
  if v_customer is null then
    select id into v_customer from public.customers where business_id = b.id and whatsapp = v_prof.phone and user_id is null;
  end if;
  if v_customer is null then
    insert into public.customers (business_id, name, whatsapp, user_id)
    values (b.id, coalesce(v_prof.full_name, 'Cliente Limpa Aqui'),
            case when exists (select 1 from public.customers c where c.business_id = b.id and c.whatsapp = v_prof.phone)
                 then null else v_prof.phone end,
            v_user)
    returning id into v_customer;
  end if;
  update public.customers
     set user_id = v_user, street = v_addr.street, street_number = v_addr.street_number, complement = v_addr.complement,
         neighborhood = v_addr.neighborhood, city = v_addr.city, state = v_addr.state, postal_code = v_addr.postal_code,
         lat = v_addr.lat, lng = v_addr.lng, place_id = v_addr.place_id
   where id = v_customer;

  select s.timezone, s.default_due_days into v_tz, v_default from public.business_settings s where s.business_id = b.id;

  perform set_config('limpaaqui.internal', 'on', true);
  update public.businesses set next_order_number = next_order_number + 1 where id = b.id
  returning next_order_number - 1 into v_number;
  perform set_config('limpaaqui.internal', 'off', true);

  insert into public.orders (business_id, number, customer_id, due_date, notes, created_by, delivery_type, status,
                             origin, client_user_id, payment_mode, logistics_mode, listing_id, proposal_id,
                             delivery_fee_leg, delivery_fee_total)
  values (b.id, v_number, v_customer, current_date, nullif(trim(coalesce(p_notes, '')), ''), v_user,
          case when p_logistics in ('prestador', 'entregador') then 'entrega' else 'retirada' end::public.delivery_type, 'recebido',
          'marketplace', v_user, p_payment, p_logistics, p_listing_id, p_proposal_id,
          v_fee,
          coalesce(v_fee * 2, 0))
  returning id into v_order;

  if p_items is not null then
    if exists (select 1 from jsonb_array_elements(p_items) it
               join public.services s on s.id = nullif(it ->> 'service_id', '')::uuid and s.business_id = b.id
               where s.pricing_unit = 'orcamento') then
      raise exception 'Serviços sob orçamento são contratados por anúncio: publique o que precisa e receba a proposta.' using errcode = 'P0001';
    end if;
    select * into v_res from public.insert_order_items(
      b.id, v_order,
      (select jsonb_agg(it - 'unit_price') from jsonb_array_elements(p_items) it), v_default);
    v_total := v_res.total;
    v_days := v_res.max_days;
  else
    insert into public.order_items (business_id, order_id, service_name, quantity, unit_price, position)
    values (b.id, v_order, left(p_custom_name, 80), 1, p_custom_price, 0);
    v_total := p_custom_price;
    v_days := p_due_days;
  end if;

  update public.orders
     set total = v_total,
         due_date = (now() at time zone coalesce(v_tz, 'America/Sao_Paulo'))::date + coalesce(v_days, v_default, 3)
   where id = v_order;

  if p_logistics = 'entregador' then
    perform public.create_delivery_leg(v_order, 'pickup');
  end if;
  return v_order;
end;
$$;

-- Meus pedidos: com a taxa de entrega
drop function if exists public.my_orders();
create function public.my_orders()
returns table (
  id uuid, number integer, status public.order_status, created_at timestamptz, due_date date,
  total numeric, paid boolean, business_name text, business_whatsapp text, items jsonb,
  payment_mode public.payment_mode, logistics_mode public.logistics_mode, delivery_fee_total numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.number, o.status, o.created_at, o.due_date, o.total, o.paid,
         b.name, b.whatsapp,
         coalesce((select jsonb_agg(jsonb_build_object('name', i.service_name, 'quantity', i.quantity, 'unit_price', i.unit_price)
                                    order by i.position)
                   from public.order_items i where i.order_id = o.id and i.business_id = o.business_id), '[]'::jsonb),
         o.payment_mode, o.logistics_mode, o.delivery_fee_total
  from public.orders o
  join public.businesses b on b.id = o.business_id
  where o.client_user_id = auth.uid()
  order by o.created_at desc
  limit 200;
$$;

revoke all on function public.save_courier_profile(public.vehicle_type, text, text, integer[]) from public, anon;
revoke all on function public.municipality_has_logistics(integer) from public, anon, authenticated;
revoke all on function public.delivery_quote_core(public.businesses, public.user_addresses) from public, anon, authenticated;
revoke all on function public.quote_delivery(uuid, uuid) from public, anon;
revoke all on function public.create_delivery_leg(uuid, public.delivery_leg) from public, anon, authenticated;
revoke all on function public.order_logistics() from public, anon, authenticated;
revoke all on function public.courier_available_deliveries() from public, anon;
revoke all on function public.accept_delivery(uuid) from public, anon;
revoke all on function public.release_delivery(uuid) from public, anon;
revoke all on function public.advance_delivery(uuid, public.delivery_status) from public, anon;
revoke all on function public.my_deliveries() from public, anon;
revoke all on function public.order_deliveries(uuid) from public, anon;
revoke all on function public.admin_upsert_delivery_zone(integer, numeric, numeric, numeric, numeric, numeric, boolean) from public, anon;
revoke all on function public.admin_logistics_overview() from public, anon;
revoke all on function public.admin_couriers() from public, anon;
revoke all on function public.my_orders() from public, anon;
revoke all on function public.marketplace_place_order(uuid, uuid, jsonb, text, numeric, integer, public.payment_mode, public.logistics_mode, boolean, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.save_courier_profile(public.vehicle_type, text, text, integer[]) to authenticated;
grant execute on function public.quote_delivery(uuid, uuid) to authenticated;
revoke all on function public.quote_proposal_delivery(uuid) from public, anon;
grant execute on function public.quote_proposal_delivery(uuid) to authenticated;
grant execute on function public.courier_available_deliveries() to authenticated;
grant execute on function public.accept_delivery(uuid) to authenticated;
grant execute on function public.release_delivery(uuid) to authenticated;
grant execute on function public.advance_delivery(uuid, public.delivery_status) to authenticated;
grant execute on function public.my_deliveries() to authenticated;
grant execute on function public.order_deliveries(uuid) to authenticated;
grant execute on function public.admin_upsert_delivery_zone(integer, numeric, numeric, numeric, numeric, numeric, boolean) to authenticated;
grant execute on function public.admin_logistics_overview() to authenticated;
grant execute on function public.admin_couriers() to authenticated;
grant execute on function public.my_orders() to authenticated;
