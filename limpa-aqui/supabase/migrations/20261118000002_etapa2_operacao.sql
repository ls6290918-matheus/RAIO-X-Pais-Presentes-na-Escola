-- =====================================================================
-- LIMPA AQUI — Fase 1, Etapa 2: Operação
-- Clientes, serviços, pedidos e itens do pedido (RLS + RPCs)
-- Requer a migration da Etapa 1.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'order_status') then
    create type public.order_status as enum ('recebido', 'em_lavagem', 'pronto', 'entregue', 'cancelado');
  end if;
end$$;

-- ---------------------------------------------------------------------
-- customers
-- ---------------------------------------------------------------------
create table if not exists public.customers (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  name         text not null check (char_length(trim(name)) between 2 and 120),
  whatsapp     text check (whatsapp is null or whatsapp ~ '^[0-9]{10,13}$'),
  email        text check (email is null or (char_length(email) <= 160 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  notes        text check (notes is null or char_length(notes) <= 1000),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (business_id, id)
);

-- Um WhatsApp por cliente dentro da mesma lavanderia
create unique index if not exists customers_business_whatsapp_uq
  on public.customers (business_id, whatsapp) where whatsapp is not null;
create index if not exists customers_business_name_idx on public.customers (business_id, lower(name));

create trigger customers_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- services (catálogo da lavanderia)
-- ---------------------------------------------------------------------
create table if not exists public.services (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  name         text not null check (char_length(trim(name)) between 2 and 80),
  description  text check (description is null or char_length(description) <= 300),
  price        numeric(10, 2) not null check (price >= 0 and price <= 99999),
  due_days     integer check (due_days is null or due_days between 1 and 60),
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (business_id, id)
);

create index if not exists services_business_idx on public.services (business_id, active, name);

create trigger services_updated_at
  before update on public.services
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- orders
-- ---------------------------------------------------------------------
create table if not exists public.orders (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses (id) on delete cascade,
  number          integer not null check (number > 0),
  customer_id     uuid not null,
  status          public.order_status not null default 'recebido',
  due_date        date not null,
  total           numeric(10, 2) not null default 0 check (total >= 0),
  paid            boolean not null default false,
  notes           text check (notes is null or char_length(notes) <= 1000),
  tracking_token  uuid not null default gen_random_uuid() unique,
  created_by      uuid references auth.users (id) on delete set null,
  received_at     timestamptz not null default now(),
  ready_at        timestamptz,
  delivered_at    timestamptz,
  canceled_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (business_id, number),
  unique (business_id, id),
  -- O cliente precisa ser da mesma lavanderia do pedido
  foreign key (business_id, customer_id) references public.customers (business_id, id) on delete restrict
);

create index if not exists orders_business_status_idx on public.orders (business_id, status, due_date);
create index if not exists orders_business_customer_idx on public.orders (business_id, customer_id);
create index if not exists orders_business_created_idx on public.orders (business_id, created_at desc);

create trigger orders_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- order_items (cada par / peça do pedido)
-- ---------------------------------------------------------------------
create table if not exists public.order_items (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null,
  order_id      uuid not null,
  service_id    uuid,
  service_name  text not null check (char_length(service_name) between 1 and 80),
  description   text check (description is null or char_length(description) <= 160),
  quantity      integer not null default 1 check (quantity between 1 and 50),
  unit_price    numeric(10, 2) not null check (unit_price >= 0 and unit_price <= 99999),
  position      integer not null default 0,
  created_at    timestamptz not null default now(),
  foreign key (business_id, order_id) references public.orders (business_id, id) on delete cascade,
  -- Se o serviço for excluído, o item mantém nome e preço (service_name / unit_price)
  foreign key (business_id, service_id) references public.services (business_id, id) on delete set null (service_id)
);

create index if not exists order_items_order_idx on public.order_items (order_id, position);
create index if not exists order_items_service_idx on public.order_items (business_id, service_id);

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.customers   enable row level security;
alter table public.services    enable row level security;
alter table public.orders      enable row level security;
alter table public.order_items enable row level security;

-- customers: membros leem, criam e editam; só o dono exclui
create policy customers_select_member on public.customers
  for select to authenticated using (public.is_business_member(business_id));
create policy customers_insert_member on public.customers
  for insert to authenticated with check (public.is_business_member(business_id));
create policy customers_update_member on public.customers
  for update to authenticated
  using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));
create policy customers_delete_owner on public.customers
  for delete to authenticated using (public.is_business_owner(business_id));

-- services: membros leem; só o dono cria, edita e exclui
create policy services_select_member on public.services
  for select to authenticated using (public.is_business_member(business_id));
create policy services_insert_owner on public.services
  for insert to authenticated with check (public.is_business_owner(business_id));
create policy services_update_owner on public.services
  for update to authenticated
  using (public.is_business_owner(business_id))
  with check (public.is_business_owner(business_id));
create policy services_delete_owner on public.services
  for delete to authenticated using (public.is_business_owner(business_id));

-- orders: membros leem e editam campos simples (prazo, pago, observações);
-- criação e status só pelas funções create_order / set_order_status
create policy orders_select_member on public.orders
  for select to authenticated using (public.is_business_member(business_id));
create policy orders_update_member on public.orders
  for update to authenticated
  using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

-- order_items: membros leem; escrita só via create_order
create policy order_items_select_member on public.order_items
  for select to authenticated using (public.is_business_member(business_id));

-- Privilégios explícitos (defesa em profundidade): só as colunas que a tela pode mexer
revoke all on public.customers, public.services, public.orders, public.order_items from anon, authenticated;

grant select, delete on public.customers to authenticated;
grant insert (business_id, name, whatsapp, email, notes) on public.customers to authenticated;
grant update (name, whatsapp, email, notes) on public.customers to authenticated;

grant select, delete on public.services to authenticated;
grant insert (business_id, name, description, price, due_days, active) on public.services to authenticated;
grant update (name, description, price, due_days, active) on public.services to authenticated;

grant select on public.orders to authenticated;
grant update (due_date, paid, notes) on public.orders to authenticated;

grant select on public.order_items to authenticated;

-- ---------------------------------------------------------------------
-- RPC: criar pedido (pedido + itens + numeração + total numa transação)
-- p_items: [{ "service_id": uuid, "description": text?, "quantity": int?, "unit_price": number? }]
-- Sem unit_price, vale o preço do serviço. Sem p_due_date, o prazo é calculado
-- pelo maior prazo entre os serviços (ou o prazo padrão da lavanderia).
-- ---------------------------------------------------------------------
create or replace function public.create_order(
  p_customer_id  uuid,
  p_items        jsonb,
  p_due_date     date default null,
  p_notes        text default null
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

  -- Numeração sequencial por lavanderia. O UPDATE trava a linha até o fim da
  -- transação, então dois pedidos simultâneos nunca recebem o mesmo número.
  perform set_config('limpaaqui.internal', 'on', true);
  update public.businesses
     set next_order_number = next_order_number + 1
   where id = v_business
  returning next_order_number - 1 into v_number;
  perform set_config('limpaaqui.internal', 'off', true);

  insert into public.orders (business_id, number, customer_id, due_date, notes, created_by)
  values (
    v_business, v_number, p_customer_id,
    coalesce(p_due_date, current_date),  -- ajustado abaixo quando não informado
    nullif(trim(coalesce(p_notes, '')), ''),
    v_user
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

-- ---------------------------------------------------------------------
-- RPC: mudar status do pedido (só transições válidas, com data de cada etapa)
-- recebido   -> em_lavagem | pronto | cancelado
-- em_lavagem -> recebido | pronto | cancelado
-- pronto     -> em_lavagem | entregue | cancelado
-- entregue   -> pronto        (desfazer entrega registrada por engano)
-- cancelado  -> (final)
-- ---------------------------------------------------------------------
create or replace function public.set_order_status(p_order_id uuid, p_status public.order_status)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_ok    boolean;
begin
  if auth.uid() is null then
    raise exception 'Faça login para continuar.' using errcode = '28000';
  end if;

  select * into v_order from public.orders o where o.id = p_order_id for update;
  if v_order.id is null or not public.is_business_member(v_order.business_id) then
    raise exception 'Pedido não encontrado.' using errcode = 'P0001';
  end if;

  if v_order.status = p_status then
    return;
  end if;

  v_ok := case v_order.status
    when 'recebido'   then p_status in ('em_lavagem', 'pronto', 'cancelado')
    when 'em_lavagem' then p_status in ('recebido', 'pronto', 'cancelado')
    when 'pronto'     then p_status in ('em_lavagem', 'entregue', 'cancelado')
    when 'entregue'   then p_status = 'pronto'
    else false
  end;

  if not v_ok then
    raise exception 'Não é possível mudar o pedido de "%" para "%".', v_order.status, p_status using errcode = 'P0001';
  end if;

  update public.orders
     set status       = p_status,
         ready_at     = case when p_status = 'pronto' and v_order.status <> 'entregue' then now()
                             when p_status in ('recebido', 'em_lavagem') then null
                             else ready_at end,
         delivered_at = case when p_status = 'entregue' then now() else null end,
         canceled_at  = case when p_status = 'cancelado' then now() else null end
   where id = p_order_id;
end;
$$;

revoke all on function public.create_order(uuid, jsonb, date, text) from public, anon;
grant execute on function public.create_order(uuid, jsonb, date, text) to authenticated;

revoke all on function public.set_order_status(uuid, public.order_status) from public, anon;
grant execute on function public.set_order_status(uuid, public.order_status) to authenticated;

-- Novos nomes reservados para rotas do painel
insert into public.reserved_slugs (slug) values ('pedidos'), ('clientes'), ('servicos')
on conflict do nothing;
