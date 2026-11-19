-- =====================================================================
-- LIMPA AQUI — Marketplace, Etapa 2: anunciante (quem contrata)
--  * user_addresses: endereços da própria conta (até 10), um principal, município calculado
--  * orders.client_user_id: liga o pedido à conta de quem contratou (preenchido na Etapa 4, na contratação)
--  * my_orders(): o anunciante vê os próprios pedidos, sem notas internas, custos ou dados de outros clientes
-- =====================================================================

create table if not exists public.user_addresses (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  label           text not null default 'Casa' check (char_length(trim(label)) between 1 and 30),
  street          text check (street is null or char_length(street) <= 120),
  street_number   text check (street_number is null or char_length(street_number) <= 20),
  complement      text check (complement is null or char_length(complement) <= 80),
  neighborhood    text check (neighborhood is null or char_length(neighborhood) <= 80),
  city            text not null check (char_length(city) between 2 and 80),
  state           char(2) not null check (state ~ '^[A-Z]{2}$'),
  postal_code     text check (postal_code is null or postal_code ~ '^[0-9]{8}$'),
  lat             double precision check (lat is null or lat between -90 and 90),
  lng             double precision check (lng is null or lng between -180 and 180),
  place_id        text check (place_id is null or char_length(place_id) <= 300),
  municipality_id integer references public.municipalities (id),
  is_default      boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists user_addresses_user_idx on public.user_addresses (user_id, created_at);
create unique index if not exists user_addresses_one_default on public.user_addresses (user_id) where is_default;

create trigger user_addresses_updated_at
  before update on public.user_addresses
  for each row execute function public.set_updated_at();

-- Município sempre calculado pela cidade/UF (mesma regra de lavanderias e clientes)
create trigger user_addresses_set_municipality
  before insert or update of city, state, municipality_id on public.user_addresses
  for each row execute function public.set_municipality();

-- Limite de 10 endereços; o primeiro vira o principal
create or replace function public.user_addresses_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  select count(*) into n from public.user_addresses where user_id = new.user_id;
  if n >= 10 then
    raise exception 'Você já tem 10 endereços. Apague um antes de cadastrar outro.' using errcode = 'P0001';
  end if;
  new.is_default := (n = 0);
  return new;
end;
$$;

create trigger user_addresses_limit
  before insert on public.user_addresses
  for each row execute function public.user_addresses_before_insert();

-- Apagou o principal: o mais antigo que sobrou vira principal
create or replace function public.user_addresses_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.is_default then
    update public.user_addresses set is_default = true
     where id = (select id from public.user_addresses where user_id = old.user_id order by created_at limit 1);
  end if;
  return old;
end;
$$;

create trigger user_addresses_promote_default
  after delete on public.user_addresses
  for each row execute function public.user_addresses_after_delete();

alter table public.user_addresses enable row level security;

create policy user_addresses_select_own on public.user_addresses
  for select to authenticated using (user_id = auth.uid());
create policy user_addresses_insert_own on public.user_addresses
  for insert to authenticated with check (user_id = auth.uid());
create policy user_addresses_update_own on public.user_addresses
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy user_addresses_delete_own on public.user_addresses
  for delete to authenticated using (user_id = auth.uid());

revoke all on public.user_addresses from anon, authenticated;
grant select, delete on public.user_addresses to authenticated;
grant insert (label, street, street_number, complement, neighborhood, city, state, postal_code, lat, lng, place_id)
  on public.user_addresses to authenticated;
grant update (label, street, street_number, complement, neighborhood, city, state, postal_code, lat, lng, place_id)
  on public.user_addresses to authenticated;

-- Escolher o endereço principal
create or replace function public.set_default_address(p_address_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.user_addresses where id = p_address_id and user_id = auth.uid()) then
    raise exception 'Endereço não encontrado.' using errcode = 'P0001';
  end if;
  update public.user_addresses set is_default = false where user_id = auth.uid() and is_default and id <> p_address_id;
  update public.user_addresses set is_default = true where id = p_address_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Pedidos do anunciante
-- ---------------------------------------------------------------------
alter table public.orders
  add column if not exists client_user_id uuid references auth.users (id) on delete set null;

create index if not exists orders_client_user_idx on public.orders (client_user_id, created_at desc) where client_user_id is not null;

-- O que o anunciante vê dos próprios pedidos: lavanderia, situação, itens e valores.
-- Nunca as notas internas, custos ou o cadastro do cliente na lavanderia.
create or replace function public.my_orders()
returns table (
  id uuid, number integer, status public.order_status, created_at timestamptz, due_date date,
  total numeric, paid boolean, business_name text, business_whatsapp text, items jsonb
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
                   from public.order_items i where i.order_id = o.id and i.business_id = o.business_id), '[]'::jsonb)
  from public.orders o
  join public.businesses b on b.id = o.business_id
  where o.client_user_id = auth.uid()
  order by o.created_at desc
  limit 200;
$$;

revoke all on function public.set_default_address(uuid) from public, anon;
revoke all on function public.my_orders() from public, anon;
revoke all on function public.user_addresses_before_insert() from public, anon, authenticated;
revoke all on function public.user_addresses_after_delete() from public, anon, authenticated;
grant execute on function public.set_default_address(uuid) to authenticated;
grant execute on function public.my_orders() to authenticated;

insert into public.reserved_slugs (slug) values ('cliente') on conflict do nothing;
