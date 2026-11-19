-- =====================================================================
-- LIMPA AQUI — Marketplace, Etapa 4: anúncios, propostas e contratação
--  * listings: o cliente anuncia o que precisa (endereço exato fica com ele; prestador vê só bairro/município)
--  * proposals: prestador visível que atende o município manda preço, prazo e mensagem
--  * contratação sempre por RPC: aceitar proposta (accept_proposal) ou contratar pelo perfil (hire_services)
--    → nasce um pedido em orders (origin = marketplace), visível no painel da lavanderia e em "Meus pedidos"
--  * pagamento: por enquanto só direto ao prestador (pelo app chega na Etapa 5b)
--  * logística: sem logística (cliente leva e busca) ou o próprio prestador busca e entrega;
--    corridas com entregadores chegam na Etapa 6
-- =====================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'listing_status') then
    create type public.listing_status as enum ('aberto', 'contratado', 'cancelado');
  end if;
  if not exists (select 1 from pg_type where typname = 'proposal_status') then
    create type public.proposal_status as enum ('enviada', 'aceita', 'recusada', 'retirada');
  end if;
  if not exists (select 1 from pg_type where typname = 'payment_mode') then
    create type public.payment_mode as enum ('direto', 'app');
  end if;
  if not exists (select 1 from pg_type where typname = 'logistics_mode') then
    create type public.logistics_mode as enum ('sem_logistica', 'prestador', 'entregador');
  end if;
  if not exists (select 1 from pg_type where typname = 'order_origin') then
    create type public.order_origin as enum ('balcao', 'marketplace');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Anúncios
-- ---------------------------------------------------------------------
create table if not exists public.listings (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  category_code     text not null references public.service_categories (code),
  title             text not null check (char_length(trim(title)) between 5 and 80),
  description       text check (description is null or char_length(description) <= 1000),
  address_id        uuid references public.user_addresses (id) on delete set null,
  neighborhood      text,
  municipality_id   integer not null references public.municipalities (id),
  wants_pickup      boolean not null default false,
  status            public.listing_status not null default 'aberto',
  expires_at        timestamptz not null default now() + interval '14 days',
  hired_proposal_id uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists listings_user_idx on public.listings (user_id, created_at desc);
create index if not exists listings_open_idx on public.listings (municipality_id, created_at desc) where status = 'aberto';

create trigger listings_updated_at
  before update on public.listings
  for each row execute function public.set_updated_at();

alter table public.listings enable row level security;
create policy listings_select_own on public.listings for select to authenticated using (user_id = auth.uid());
revoke all on public.listings from anon, authenticated;
grant select on public.listings to authenticated;

-- ---------------------------------------------------------------------
-- Propostas
-- ---------------------------------------------------------------------
create table if not exists public.proposals (
  id            uuid primary key default gen_random_uuid(),
  listing_id    uuid not null references public.listings (id) on delete cascade,
  business_id   uuid not null references public.businesses (id) on delete cascade,
  price         numeric(10, 2) not null check (price > 0 and price <= 99999),
  due_days      integer not null check (due_days between 1 and 60),
  message       text check (message is null or char_length(message) <= 500),
  offers_pickup boolean not null default false,
  status        public.proposal_status not null default 'enviada',
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (listing_id, business_id)
);

create index if not exists proposals_business_idx on public.proposals (business_id, created_at desc);

create trigger proposals_updated_at
  before update on public.proposals
  for each row execute function public.set_updated_at();

alter table public.listings
  add constraint listings_hired_proposal_fk foreign key (hired_proposal_id) references public.proposals (id) on delete set null;

alter table public.proposals enable row level security;
-- a lavanderia vê as próprias propostas; quem anunciou vê as recebidas (com nome do prestador pela RPC)
create policy proposals_select on public.proposals for select to authenticated
  using (public.is_business_member(business_id)
         or exists (select 1 from public.listings l where l.id = listing_id and l.user_id = auth.uid()));
revoke all on public.proposals from anon, authenticated;
grant select on public.proposals to authenticated;

-- ---------------------------------------------------------------------
-- Pedidos e clientes: origem, modalidade e vínculo com a conta
-- ---------------------------------------------------------------------
alter table public.orders
  add column if not exists origin         public.order_origin not null default 'balcao',
  add column if not exists payment_mode   public.payment_mode,
  add column if not exists logistics_mode public.logistics_mode,
  add column if not exists listing_id     uuid,
  add column if not exists proposal_id    uuid;

-- Verificação no fim da operação: ao apagar a conta do cliente, anúncio, proposta e vínculo do pedido
-- são apagados/limpos na mesma cascata sem uma verificação atropelar a outra
alter table public.orders
  add constraint orders_listing_id_fkey foreign key (listing_id) references public.listings (id)
    on delete set null deferrable initially deferred,
  add constraint orders_proposal_id_fkey foreign key (proposal_id) references public.proposals (id)
    on delete set null deferrable initially deferred;

alter table public.customers
  add column if not exists user_id uuid references auth.users (id) on delete set null;
create unique index if not exists customers_business_user_uq on public.customers (business_id, user_id) where user_id is not null;

-- ---------------------------------------------------------------------
-- Cliente: publicar e cancelar anúncio
-- ---------------------------------------------------------------------
create or replace function public.create_listing(
  p_category text, p_title text, p_description text, p_address_id uuid, p_wants_pickup boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_addr public.user_addresses;
  v_id   uuid;
begin
  if v_user is null then
    raise exception 'Faça login para continuar.' using errcode = '28000';
  end if;
  if not public.has_role('anunciante') then
    raise exception 'Ative o perfil "Contratar serviços" na sua conta.' using errcode = '42501';
  end if;
  select * into v_addr from public.user_addresses where id = p_address_id and user_id = v_user;
  if v_addr.id is null then
    raise exception 'Escolha um dos seus endereços.' using errcode = 'P0001';
  end if;
  if v_addr.municipality_id is null then
    raise exception 'Por enquanto o Limpa Aqui atende só o estado do Rio de Janeiro.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.listings where user_id = v_user and status = 'aberto' and expires_at > now()) >= 10 then
    raise exception 'Você já tem 10 anúncios abertos. Encerre algum antes de publicar outro.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.service_categories where code = p_category) then
    raise exception 'Escolha o tipo de serviço.' using errcode = '22023';
  end if;

  insert into public.listings (user_id, category_code, title, description, address_id, neighborhood, municipality_id, wants_pickup)
  values (v_user, p_category, trim(p_title), nullif(trim(coalesce(p_description, '')), ''), v_addr.id,
          v_addr.neighborhood, v_addr.municipality_id, coalesce(p_wants_pickup, false))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.cancel_listing(p_listing_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.listings set status = 'cancelado'
   where id = p_listing_id and user_id = auth.uid() and status = 'aberto';
  if not found then
    raise exception 'Anúncio não encontrado ou já encerrado.' using errcode = 'P0001';
  end if;
  update public.proposals set status = 'recusada' where listing_id = p_listing_id and status = 'enviada';
end;
$$;

-- Anúncios do cliente com a contagem de propostas
create or replace function public.my_listings()
returns table (id uuid, category_name text, title text, description text, neighborhood text, municipality_name text,
               wants_pickup boolean, status public.listing_status, expired boolean, created_at timestamptz, expires_at timestamptz,
               proposals bigint, order_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id, c.name, l.title, l.description, l.neighborhood, m.name, l.wants_pickup, l.status,
         l.status = 'aberto' and l.expires_at <= now(), l.created_at, l.expires_at,
         (select count(*) from public.proposals p where p.listing_id = l.id and p.status in ('enviada', 'aceita')),
         (select o.id from public.orders o where o.listing_id = l.id limit 1)
  from public.listings l
  join public.service_categories c on c.code = l.category_code
  join public.municipalities m on m.id = l.municipality_id
  where l.user_id = auth.uid()
  order by l.created_at desc
  limit 100;
$$;

-- Propostas recebidas num anúncio (só para quem anunciou)
create or replace function public.listing_proposals(p_listing_id uuid)
returns table (id uuid, business_name text, business_slug text, provider_type public.provider_type, logo_path text,
               price numeric, due_days integer, message text, offers_pickup boolean, accepts_direct_payment boolean,
               status public.proposal_status, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.listings l where l.id = p_listing_id and l.user_id = auth.uid()) then
    raise exception 'Anúncio não encontrado.' using errcode = 'P0001';
  end if;
  return query
  select p.id, b.name, b.slug, b.provider_type, b.logo_path, p.price, p.due_days, p.message, p.offers_pickup,
         b.accepts_direct_payment, p.status, p.created_at
  from public.proposals p
  join public.businesses b on b.id = p.business_id
  where p.listing_id = p_listing_id and p.status <> 'retirada'
  order by (p.status = 'aceita') desc, p.price, p.created_at;
end;
$$;

-- ---------------------------------------------------------------------
-- Prestador: oportunidades e propostas
-- ---------------------------------------------------------------------
create or replace function public.provider_open_listings(p_business_id uuid)
returns table (id uuid, category_code text, category_name text, title text, description text, neighborhood text,
               municipality_name text, wants_pickup boolean, created_at timestamptz, expires_at timestamptz,
               proposals bigint, my_proposal_id uuid, my_status public.proposal_status, my_price numeric, my_due_days integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_business_owner(p_business_id) then
    raise exception 'Somente o dono da lavanderia vê as oportunidades.' using errcode = '42501';
  end if;
  return query
  select l.id, l.category_code, c.name, l.title, l.description, l.neighborhood, m.name, l.wants_pickup,
         l.created_at, l.expires_at,
         (select count(*) from public.proposals x where x.listing_id = l.id and x.status = 'enviada'),
         p.id, p.status, p.price, p.due_days
  from public.listings l
  join public.businesses b on b.id = p_business_id
  join public.service_categories c on c.code = l.category_code
  join public.municipalities m on m.id = l.municipality_id and m.status = 'ativo'
  left join public.proposals p on p.listing_id = l.id and p.business_id = p_business_id
  where l.status = 'aberto' and l.expires_at > now()
    and public.provider_serves(b.id, b.municipality_id, l.municipality_id)
    and not exists (select 1 from public.business_members bm where bm.business_id = b.id and bm.user_id = l.user_id)
  order by l.created_at desc
  limit 100;
end;
$$;

create or replace function public.send_proposal(
  p_listing_id uuid, p_business_id uuid, p_price numeric, p_due_days integer, p_message text default null,
  p_offers_pickup boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.businesses;
  l public.listings;
  v_id uuid;
begin
  if not public.is_business_owner(p_business_id) then
    raise exception 'Somente o dono da lavanderia pode enviar propostas.' using errcode = '42501';
  end if;
  select * into b from public.businesses where id = p_business_id;
  if not public.provider_listable(b) then
    raise exception 'Ligue "Aparecer na busca" nas Configurações para enviar propostas.' using errcode = 'P0001';
  end if;
  select * into l from public.listings where id = p_listing_id for update;
  if l.id is null or l.status <> 'aberto' or l.expires_at <= now()
     or not exists (select 1 from public.municipalities m where m.id = l.municipality_id and m.status = 'ativo')
     or not public.provider_serves(b.id, b.municipality_id, l.municipality_id) then
    raise exception 'Este anúncio não está disponível para a sua lavanderia.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.business_members bm where bm.business_id = b.id and bm.user_id = l.user_id) then
    raise exception 'Você não pode enviar proposta para o próprio anúncio.' using errcode = 'P0001';
  end if;
  if coalesce(p_offers_pickup, false) and not b.offers_pickup then
    raise exception 'Ative "Faço coleta e devolução" nas Configurações para oferecer coleta.' using errcode = 'P0001';
  end if;
  if p_price is null or p_price <= 0 or p_price > 99999 then
    raise exception 'Informe um valor válido.' using errcode = '22023';
  end if;
  if p_due_days is null or p_due_days < 1 or p_due_days > 60 then
    raise exception 'Prazo entre 1 e 60 dias.' using errcode = '22023';
  end if;

  insert into public.proposals (listing_id, business_id, price, due_days, message, offers_pickup, created_by)
  values (l.id, b.id, round(p_price, 2), p_due_days, nullif(trim(coalesce(p_message, '')), ''), coalesce(p_offers_pickup, false), auth.uid())
  on conflict (listing_id, business_id) do update
    set price = excluded.price, due_days = excluded.due_days, message = excluded.message,
        offers_pickup = excluded.offers_pickup, status = 'enviada'
    where public.proposals.status in ('enviada', 'retirada')
  returning id into v_id;
  if v_id is null then
    raise exception 'Esta proposta já foi respondida.' using errcode = 'P0001';
  end if;
  return v_id;
end;
$$;

create or replace function public.withdraw_proposal(p_proposal_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid;
begin
  select business_id into v_business from public.proposals where id = p_proposal_id;
  if v_business is null or not public.is_business_owner(v_business) then
    raise exception 'Proposta não encontrada.' using errcode = 'P0001';
  end if;
  update public.proposals set status = 'retirada' where id = p_proposal_id and status = 'enviada';
  if not found then
    raise exception 'Só dá para retirar proposta que ainda não foi respondida.' using errcode = 'P0001';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Contratação → pedido (interna; chamada só pelas RPCs abaixo)
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
  if p_logistics = 'entregador' then
    raise exception 'Coleta por entregadores do Limpa Aqui chega em breve.' using errcode = 'P0001';
  end if;
  if p_logistics is null or (p_logistics = 'prestador' and not p_pickup_ok) then
    raise exception 'Este prestador não faz coleta e entrega.' using errcode = 'P0001';
  end if;
  if p_notes is not null and char_length(p_notes) > 500 then
    raise exception 'Observações muito longas (máximo de 500 caracteres).' using errcode = '22023';
  end if;

  -- Ficha do cliente na lavanderia: a mesma conta, ou o mesmo WhatsApp já cadastrado no balcão
  select id into v_customer from public.customers where business_id = b.id and user_id = v_user;
  if v_customer is null then
    select id into v_customer from public.customers where business_id = b.id and whatsapp = v_prof.phone and user_id is null;
  end if;
  if v_customer is null then
    -- o WhatsApp é único por lavanderia: se já for de outra ficha, a nova fica sem (o contato vem da conta)
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
                             origin, client_user_id, payment_mode, logistics_mode, listing_id, proposal_id)
  values (b.id, v_number, v_customer, current_date, nullif(trim(coalesce(p_notes, '')), ''), v_user,
          case when p_logistics = 'prestador' then 'entrega' else 'retirada' end::public.delivery_type, 'recebido',
          'marketplace', v_user, p_payment, p_logistics, p_listing_id, p_proposal_id)
  returning id into v_order;

  if p_items is not null then
    if exists (select 1 from jsonb_array_elements(p_items) it
               join public.services s on s.id = nullif(it ->> 'service_id', '')::uuid and s.business_id = b.id
               where s.pricing_unit = 'orcamento') then
      raise exception 'Serviços sob orçamento são contratados por anúncio: publique o que precisa e receba a proposta.' using errcode = 'P0001';
    end if;
    -- o preço é sempre o do catálogo
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
  return v_order;
end;
$$;

-- Aceitar uma proposta: vira pedido; as outras propostas são recusadas
create or replace function public.accept_proposal(
  p_proposal_id uuid, p_logistics public.logistics_mode default 'sem_logistica',
  p_payment public.payment_mode default 'direto', p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.proposals;
  l public.listings;
  v_order uuid;
begin
  select * into p from public.proposals where id = p_proposal_id for update;
  select * into l from public.listings where id = p.listing_id for update;
  if p.id is null or l.user_id is distinct from auth.uid() then
    raise exception 'Proposta não encontrada.' using errcode = 'P0001';
  end if;
  if l.status <> 'aberto' or l.expires_at <= now() then
    raise exception 'Este anúncio já foi encerrado.' using errcode = 'P0001';
  end if;
  if p.status <> 'enviada' then
    raise exception 'Esta proposta não está mais disponível.' using errcode = 'P0001';
  end if;
  if l.address_id is null then
    raise exception 'O endereço deste anúncio foi apagado. Publique o anúncio de novo.' using errcode = 'P0001';
  end if;

  v_order := public.marketplace_place_order(p.business_id, l.address_id, null, l.title, p.price, p.due_days,
                                            p_payment, p_logistics, p.offers_pickup, p_notes, l.id, p.id);

  update public.proposals set status = 'aceita' where id = p.id;
  update public.proposals set status = 'recusada' where listing_id = l.id and id <> p.id and status = 'enviada';
  update public.listings set status = 'contratado', hired_proposal_id = p.id where id = l.id;
  return v_order;
end;
$$;

-- Contratar direto pelo perfil do prestador (serviços do catálogo, preço do catálogo)
create or replace function public.hire_services(
  p_business_id uuid, p_items jsonb, p_address_id uuid,
  p_logistics public.logistics_mode default 'sem_logistica', p_payment public.payment_mode default 'direto',
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pickup boolean;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Escolha pelo menos um serviço.' using errcode = '22023';
  end if;
  select offers_pickup into v_pickup from public.businesses where id = p_business_id;
  return public.marketplace_place_order(p_business_id, p_address_id, p_items, null, null, null,
                                        p_payment, p_logistics, coalesce(v_pickup, false), p_notes, null, null);
end;
$$;

-- Perfil público agora traz o id de cada serviço (para contratar)
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
    'services', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'description', s.description, 'price', s.price,
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

-- Meus pedidos: agora com a modalidade de pagamento e a logística
drop function if exists public.my_orders();
create function public.my_orders()
returns table (
  id uuid, number integer, status public.order_status, created_at timestamptz, due_date date,
  total numeric, paid boolean, business_name text, business_whatsapp text, items jsonb,
  payment_mode public.payment_mode, logistics_mode public.logistics_mode
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
         o.payment_mode, o.logistics_mode
  from public.orders o
  join public.businesses b on b.id = o.business_id
  where o.client_user_id = auth.uid()
  order by o.created_at desc
  limit 200;
$$;

revoke all on function public.create_listing(text, text, text, uuid, boolean) from public, anon;
revoke all on function public.cancel_listing(uuid) from public, anon;
revoke all on function public.my_listings() from public, anon;
revoke all on function public.listing_proposals(uuid) from public, anon;
revoke all on function public.provider_open_listings(uuid) from public, anon;
revoke all on function public.send_proposal(uuid, uuid, numeric, integer, text, boolean) from public, anon;
revoke all on function public.withdraw_proposal(uuid) from public, anon;
revoke all on function public.marketplace_place_order(uuid, uuid, jsonb, text, numeric, integer, public.payment_mode, public.logistics_mode, boolean, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.accept_proposal(uuid, public.logistics_mode, public.payment_mode, text) from public, anon;
revoke all on function public.hire_services(uuid, jsonb, uuid, public.logistics_mode, public.payment_mode, text) from public, anon;
revoke all on function public.my_orders() from public, anon;
revoke all on function public.get_public_provider(text) from public;
grant execute on function public.create_listing(text, text, text, uuid, boolean) to authenticated;
grant execute on function public.cancel_listing(uuid) to authenticated;
grant execute on function public.my_listings() to authenticated;
grant execute on function public.listing_proposals(uuid) to authenticated;
grant execute on function public.provider_open_listings(uuid) to authenticated;
grant execute on function public.send_proposal(uuid, uuid, numeric, integer, text, boolean) to authenticated;
grant execute on function public.withdraw_proposal(uuid) to authenticated;
grant execute on function public.accept_proposal(uuid, public.logistics_mode, public.payment_mode, text) to authenticated;
grant execute on function public.hire_services(uuid, jsonb, uuid, public.logistics_mode, public.payment_mode, text) to authenticated;
grant execute on function public.my_orders() to authenticated;
grant execute on function public.get_public_provider(text) to anon, authenticated;
