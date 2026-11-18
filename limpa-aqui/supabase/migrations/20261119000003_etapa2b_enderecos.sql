-- =====================================================================
-- LIMPA AQUI — Etapa 2b: Endereços e entregas (Google Maps)
-- Endereço completo + localização da lavanderia e dos clientes,
-- e tipo de entrega do pedido (retirada no balcão ou entrega no endereço).
-- Requer as migrations das Etapas 1 e 2.
-- =====================================================================

-- ---------------------------------------------------------------------
-- businesses: endereço completo e localização
-- (neighborhood, city e state já existem desde a Etapa 1)
-- ---------------------------------------------------------------------
alter table public.businesses
  add column if not exists street        text check (street is null or char_length(street) <= 120),
  add column if not exists street_number text check (street_number is null or char_length(street_number) <= 20),
  add column if not exists complement    text check (complement is null or char_length(complement) <= 80),
  add column if not exists postal_code   text check (postal_code is null or postal_code ~ '^[0-9]{8}$'),
  add column if not exists lat           double precision check (lat is null or lat between -90 and 90),
  add column if not exists lng           double precision check (lng is null or lng between -180 and 180),
  add column if not exists place_id      text check (place_id is null or char_length(place_id) <= 300);

-- ---------------------------------------------------------------------
-- customers: endereço para coleta e entrega
-- ---------------------------------------------------------------------
alter table public.customers
  add column if not exists street        text check (street is null or char_length(street) <= 120),
  add column if not exists street_number text check (street_number is null or char_length(street_number) <= 20),
  add column if not exists complement    text check (complement is null or char_length(complement) <= 80),
  add column if not exists neighborhood  text check (neighborhood is null or char_length(neighborhood) <= 80),
  add column if not exists city          text check (city is null or char_length(city) <= 80),
  add column if not exists state         char(2) check (state is null or state ~ '^[A-Z]{2}$'),
  add column if not exists postal_code   text check (postal_code is null or postal_code ~ '^[0-9]{8}$'),
  add column if not exists lat           double precision check (lat is null or lat between -90 and 90),
  add column if not exists lng           double precision check (lng is null or lng between -180 and 180),
  add column if not exists place_id      text check (place_id is null or char_length(place_id) <= 300);

grant insert (street, street_number, complement, neighborhood, city, state, postal_code, lat, lng, place_id)
  on public.customers to authenticated;
grant update (street, street_number, complement, neighborhood, city, state, postal_code, lat, lng, place_id)
  on public.customers to authenticated;

-- ---------------------------------------------------------------------
-- orders: tipo de entrega
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'delivery_type') then
    create type public.delivery_type as enum ('retirada', 'entrega');
  end if;
end$$;

alter table public.orders
  add column if not exists delivery_type public.delivery_type not null default 'retirada';

create index if not exists orders_business_delivery_idx
  on public.orders (business_id, delivery_type, status, due_date);

grant update (delivery_type) on public.orders to authenticated;

-- ---------------------------------------------------------------------
-- create_order com tipo de entrega (substitui a versão da Etapa 2)
-- ---------------------------------------------------------------------
drop function if exists public.create_order(uuid, jsonb, date, text);

create or replace function public.create_order(
  p_customer_id    uuid,
  p_items          jsonb,
  p_due_date       date default null,
  p_notes          text default null,
  p_delivery_type  public.delivery_type default 'retirada'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user      uuid := auth.uid();
  v_business  uuid;
  v_tz        text;
  v_default   integer;
  v_max_days  integer := 0;
  v_number    integer;
  v_order     uuid;
  v_item      jsonb;
  v_service   public.services%rowtype;
  v_qty       integer;
  v_price     numeric(10, 2);
  v_desc      text;
  v_pos       integer := 0;
  v_total     numeric(12, 2) := 0;
begin
  if v_user is null then
    raise exception 'Faça login para continuar.' using errcode = '28000';
  end if;

  select c.business_id into v_business from public.customers c where c.id = p_customer_id;
  if v_business is null or not public.is_business_member(v_business) then
    raise exception 'Cliente não encontrado.' using errcode = 'P0001';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Adicione pelo menos um item ao pedido.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 30 then
    raise exception 'Um pedido pode ter no máximo 30 itens.' using errcode = '22023';
  end if;
  if p_notes is not null and char_length(p_notes) > 1000 then
    raise exception 'Observações muito longas (máximo de 1000 caracteres).' using errcode = '22023';
  end if;

  select s.timezone, s.default_due_days into v_tz, v_default
  from public.business_settings s where s.business_id = v_business;

  -- Numeração sequencial por lavanderia (o UPDATE trava a linha até o fim da transação)
  perform set_config('limpaaqui.internal', 'on', true);
  update public.businesses
     set next_order_number = next_order_number + 1
   where id = v_business
  returning next_order_number - 1 into v_number;
  perform set_config('limpaaqui.internal', 'off', true);

  insert into public.orders (business_id, number, customer_id, due_date, notes, created_by, delivery_type)
  values (
    v_business, v_number, p_customer_id,
    coalesce(p_due_date, current_date),
    nullif(trim(coalesce(p_notes, '')), ''),
    v_user,
    coalesce(p_delivery_type, 'retirada')
  )
  returning id into v_order;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    select * into v_service
    from public.services s
    where s.id = nullif(v_item ->> 'service_id', '')::uuid
      and s.business_id = v_business;

    if v_service.id is null then
      raise exception 'Serviço não encontrado.' using errcode = 'P0001';
    end if;
    if not v_service.active then
      raise exception 'O serviço "%" está desativado.', v_service.name using errcode = 'P0001';
    end if;

    v_qty   := coalesce(nullif(v_item ->> 'quantity', '')::integer, 1);
    v_price := coalesce(nullif(v_item ->> 'unit_price', '')::numeric, v_service.price);
    v_desc  := nullif(trim(coalesce(v_item ->> 'description', '')), '');

    if v_qty < 1 or v_qty > 50 then
      raise exception 'Quantidade inválida (de 1 a 50).' using errcode = '22023';
    end if;
    if v_price < 0 or v_price > 99999 then
      raise exception 'Valor do item inválido.' using errcode = '22023';
    end if;
    if v_desc is not null and char_length(v_desc) > 160 then
      raise exception 'Descrição do item muito longa (máximo de 160 caracteres).' using errcode = '22023';
    end if;

    insert into public.order_items (business_id, order_id, service_id, service_name, description, quantity, unit_price, position)
    values (v_business, v_order, v_service.id, v_service.name, v_desc, v_qty, v_price, v_pos);

    v_pos      := v_pos + 1;
    v_total    := v_total + v_qty * v_price;
    v_max_days := greatest(v_max_days, coalesce(v_service.due_days, v_default, 3));
  end loop;

  if v_total > 99999999 then
    raise exception 'Valor total do pedido muito alto.' using errcode = '22023';
  end if;

  update public.orders
     set total = v_total,
         due_date = coalesce(
           p_due_date,
           (now() at time zone coalesce(v_tz, 'America/Sao_Paulo'))::date + v_max_days
         )
   where id = v_order;

  return v_order;
end;
$$;

revoke all on function public.create_order(uuid, jsonb, date, text, public.delivery_type) from public, anon;
grant execute on function public.create_order(uuid, jsonb, date, text, public.delivery_type) to authenticated;

insert into public.reserved_slugs (slug) values ('rotas') on conflict do nothing;
