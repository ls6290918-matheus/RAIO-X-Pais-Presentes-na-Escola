-- =====================================================================
-- LIMPA AQUI — Fase 1 / Subetapa 1: idempotência na criação de pedidos
--  * orders.client_request_id: identifica a tentativa original de quem criou o pedido
--    (cliente na contratação direta, equipe no pedido de balcão)
--  * índice único (created_by, client_request_id): a mesma tentativa nunca vira dois pedidos;
--    pedidos antigos ficam com a coluna nula e não entram no índice
--  * hire_services e create_order ganham p_request_id (opcional, último parâmetro):
--      - sem chave: comportamento de sempre (chamadas antigas continuam funcionando)
--      - com chave repetida: devolvem o pedido original, sem criar outro
--      - duas requisições simultâneas com a mesma chave: a trava transacional faz a segunda
--        esperar a primeira e devolver o mesmo pedido
--  * Nenhuma regra de preço, pagamento, comissão ou logística muda: a criação continua em
--    marketplace_place_order / no corpo atual de create_order
-- =====================================================================

alter table public.orders add column if not exists client_request_id uuid;

create unique index if not exists orders_client_request_uq
  on public.orders (created_by, client_request_id)
  where client_request_id is not null;

-- Trava da tentativa (por usuário + chave) até o fim da transação
create or replace function public.lock_order_request(p_request_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended('limpaaqui:order:' || auth.uid()::text || ':' || p_request_id::text, 0));
$$;

-- Pedido já criado por esta tentativa (se houver); a mesma chave não pode ser usada em outra lavanderia
create or replace function public.order_for_request(p_request_id uuid, p_business_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_business uuid;
begin
  select o.id, o.business_id into v_id, v_business
  from public.orders o
  where o.created_by = auth.uid() and o.client_request_id = p_request_id;
  if v_id is not null and v_business is distinct from p_business_id then
    raise exception 'Esta solicitação já foi usada em outro pedido. Atualize a página e tente de novo.' using errcode = '22023';
  end if;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Contratação direta pelo catálogo (cliente)
-- ---------------------------------------------------------------------
drop function if exists public.hire_services(uuid, jsonb, uuid, public.logistics_mode, public.payment_mode, text);

create function public.hire_services(
  p_business_id uuid, p_items jsonb, p_address_id uuid,
  p_logistics public.logistics_mode default 'sem_logistica', p_payment public.payment_mode default 'direto',
  p_notes text default null, p_request_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pickup boolean;
  v_order uuid;
begin
  if auth.uid() is null then
    raise exception 'Faça login para continuar.' using errcode = '28000';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Escolha pelo menos um serviço.' using errcode = '22023';
  end if;

  if p_request_id is not null then
    perform public.lock_order_request(p_request_id);
    v_order := public.order_for_request(p_request_id, p_business_id);
    if v_order is not null then
      return v_order; -- repetição da mesma tentativa: devolve o pedido original
    end if;
  end if;

  select offers_pickup into v_pickup from public.businesses where id = p_business_id;
  begin
    v_order := public.marketplace_place_order(p_business_id, p_address_id, p_items, null, null, null,
                                              p_payment, p_logistics, coalesce(v_pickup, false), p_notes, null, null);
    if p_request_id is not null then
      update public.orders set client_request_id = p_request_id where id = v_order;
    end if;
  exception when unique_violation then
    -- última defesa: a chave já foi gravada por outra transação; devolve o pedido dela
    v_order := case when p_request_id is not null then public.order_for_request(p_request_id, p_business_id) end;
    if v_order is null then
      raise;
    end if;
  end;
  return v_order;
end;
$$;

-- ---------------------------------------------------------------------
-- Pedido de balcão (equipe da lavanderia) — mesmo corpo de antes + chave opcional
-- ---------------------------------------------------------------------
drop function if exists public.create_order(uuid, jsonb, date, text, public.delivery_type, boolean);

create function public.create_order(
  p_customer_id    uuid,
  p_items          jsonb,
  p_due_date       date default null,
  p_notes          text default null,
  p_delivery_type  public.delivery_type default 'retirada',
  p_as_quote       boolean default false,
  p_request_id     uuid default null
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
  v_number    integer;
  v_order     uuid;
  v_res       record;
begin
  if v_user is null then
    raise exception 'Faça login para continuar.' using errcode = '28000';
  end if;

  select c.business_id into v_business from public.customers c where c.id = p_customer_id;
  if v_business is null or not public.is_business_member(v_business) then
    raise exception 'Cliente não encontrado.' using errcode = 'P0001';
  end if;

  if p_request_id is not null then
    perform public.lock_order_request(p_request_id);
    v_order := public.order_for_request(p_request_id, v_business);
    if v_order is not null then
      return v_order;
    end if;
  end if;

  if p_notes is not null and char_length(p_notes) > 1000 then
    raise exception 'Observações muito longas (máximo de 1000 caracteres).' using errcode = '22023';
  end if;

  select s.timezone, s.default_due_days into v_tz, v_default
  from public.business_settings s where s.business_id = v_business;

  -- Numeração sequencial por lavanderia (orçamentos usam a mesma sequência)
  perform set_config('limpaaqui.internal', 'on', true);
  update public.businesses
     set next_order_number = next_order_number + 1
   where id = v_business
  returning next_order_number - 1 into v_number;
  perform set_config('limpaaqui.internal', 'off', true);

  insert into public.orders (business_id, number, customer_id, due_date, notes, created_by, delivery_type, status, client_request_id)
  values (
    v_business, v_number, p_customer_id,
    coalesce(p_due_date, current_date),
    nullif(trim(coalesce(p_notes, '')), ''),
    v_user,
    coalesce(p_delivery_type, 'retirada'),
    case when coalesce(p_as_quote, false) then 'orcamento' else 'recebido' end::public.order_status,
    p_request_id
  )
  returning id into v_order;

  select * into v_res from public.insert_order_items(v_business, v_order, p_items, v_default);

  update public.orders
     set total = v_res.total,
         due_date = coalesce(
           p_due_date,
           (now() at time zone coalesce(v_tz, 'America/Sao_Paulo'))::date + v_res.max_days
         )
   where id = v_order;

  return v_order;
end;
$$;

-- ---------------------------------------------------------------------
-- Permissões (as mesmas de antes, nas novas assinaturas)
-- ---------------------------------------------------------------------
revoke all on function public.lock_order_request(uuid) from public, anon, authenticated;
revoke all on function public.order_for_request(uuid, uuid) from public, anon, authenticated;
revoke all on function public.hire_services(uuid, jsonb, uuid, public.logistics_mode, public.payment_mode, text, uuid) from public, anon;
revoke all on function public.create_order(uuid, jsonb, date, text, public.delivery_type, boolean, uuid) from public, anon;
grant execute on function public.hire_services(uuid, jsonb, uuid, public.logistics_mode, public.payment_mode, text, uuid) to authenticated;
grant execute on function public.create_order(uuid, jsonb, date, text, public.delivery_type, boolean, uuid) to authenticated;
