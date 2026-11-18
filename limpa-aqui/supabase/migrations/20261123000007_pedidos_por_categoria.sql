-- =====================================================================
-- LIMPA AQUI — Onboarding dinâmico, Etapa 4: campos por categoria e orçamentos
--  * order_items.attributes: ficha do item (calçado, peça de roupa, medidas)
--  * quantidade com casas decimais (kg, m²)
--  * status "orcamento" antes de "recebido": orçamento vira pedido quando o cliente aprova
--  * update_quote_items: ajustar itens e valores enquanto é orçamento
-- =====================================================================

alter type public.order_status add value if not exists 'orcamento' before 'recebido';

-- Quantidade: 2,5 kg ou 3,2 m² passam a valer
alter table public.order_items drop constraint if exists order_items_quantity_check;
alter table public.order_items alter column quantity type numeric(8, 2);
alter table public.order_items add constraint order_items_quantity_check check (quantity > 0 and quantity <= 500);

-- Ficha do item
alter table public.order_items
  add column if not exists attributes jsonb not null default '{}'
    check (jsonb_typeof(attributes) = 'object' and pg_column_size(attributes) <= 2000);

-- ---------------------------------------------------------------------
-- Valida e limpa a ficha do item. Só aceita os campos conhecidos.
-- Texto: até 60 caracteres (numeração até 10). Medidas em cm: 1 a 2000. Lugares: 1 a 20.
-- ---------------------------------------------------------------------
create or replace function public.clean_item_attributes(p jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  k     text;
  v     jsonb;
  v_out jsonb := '{}';
  txt   text;
  num   numeric;
  lim   integer;
begin
  if p is null or jsonb_typeof(p) = 'null' then
    return '{}';
  end if;
  if jsonb_typeof(p) <> 'object' then
    raise exception 'Ficha do item inválida.' using errcode = '22023';
  end if;

  for k, v in select * from jsonb_each(p)
  loop
    if k in ('marca', 'modelo', 'cor', 'numeracao', 'tipo_peca', 'tecido') then
      txt := nullif(trim(v #>> '{}'), '');
      continue when txt is null;
      lim := case when k = 'numeracao' then 10 else 60 end;
      if char_length(txt) > lim then
        raise exception 'Campo "%" muito longo.', k using errcode = '22023';
      end if;
      v_out := v_out || jsonb_build_object(k, txt);
    elsif k in ('largura_cm', 'profundidade_cm', 'altura_cm', 'lugares') then
      continue when v is null or jsonb_typeof(v) = 'null' or trim(v #>> '{}') = '';
      begin
        num := (v #>> '{}')::numeric;
      exception when invalid_text_representation then
        raise exception 'Medida inválida em "%".', k using errcode = '22023';
      end;
      if k = 'lugares' and (num <> trunc(num) or num < 1 or num > 20) then
        raise exception 'Número de lugares inválido (de 1 a 20).' using errcode = '22023';
      elsif k <> 'lugares' and (num <= 0 or num > 2000) then
        raise exception 'Medida inválida em "%" (de 1 a 2000 cm).', k using errcode = '22023';
      end if;
      v_out := v_out || jsonb_build_object(k, num);
    else
      raise exception 'Campo desconhecido na ficha do item: %', k using errcode = '22023';
    end if;
  end loop;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------
-- Grava os itens de um pedido e devolve total e maior prazo (uso interno das RPCs)
-- ---------------------------------------------------------------------
create or replace function public.insert_order_items(
  p_business uuid, p_order uuid, p_items jsonb, p_default_days integer,
  out total numeric, out max_days integer
)
language plpgsql
set search_path = ''
as $$
declare
  v_item    jsonb;
  v_service public.services%rowtype;
  v_qty     numeric(8, 2);
  v_price   numeric(10, 2);
  v_desc    text;
  v_pos     integer := 0;
begin
  total := 0;
  max_days := 0;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Adicione pelo menos um item ao pedido.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 30 then
    raise exception 'Um pedido pode ter no máximo 30 itens.' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    select * into v_service
    from public.services s
    where s.id = nullif(v_item ->> 'service_id', '')::uuid
      and s.business_id = p_business;

    if v_service.id is null then
      raise exception 'Serviço não encontrado.' using errcode = 'P0001';
    end if;
    if not v_service.active then
      raise exception 'O serviço "%" está desativado.', v_service.name using errcode = 'P0001';
    end if;

    begin
      v_qty := coalesce(nullif(v_item ->> 'quantity', '')::numeric, 1);
      v_price := coalesce(nullif(v_item ->> 'unit_price', '')::numeric, v_service.price);
    exception when invalid_text_representation then
      raise exception 'Quantidade ou valor inválido.' using errcode = '22023';
    end;
    v_desc := nullif(trim(coalesce(v_item ->> 'description', '')), '');

    if v_qty <= 0 or v_qty > 500 then
      raise exception 'Quantidade inválida (maior que zero, até 500).' using errcode = '22023';
    end if;
    if v_service.pricing_unit not in ('kg', 'm2') and v_qty <> trunc(v_qty) then
      raise exception 'O serviço "%" é cobrado por % e aceita só quantidades inteiras.', v_service.name, v_service.pricing_unit using errcode = '22023';
    end if;
    if v_price < 0 or v_price > 99999 then
      raise exception 'Valor do item inválido.' using errcode = '22023';
    end if;
    if v_desc is not null and char_length(v_desc) > 160 then
      raise exception 'Descrição do item muito longa (máximo de 160 caracteres).' using errcode = '22023';
    end if;

    insert into public.order_items (business_id, order_id, service_id, service_name, description, quantity, unit_price, position, attributes)
    values (p_business, p_order, v_service.id, v_service.name, v_desc, v_qty, v_price, v_pos,
            public.clean_item_attributes(v_item -> 'attributes'));

    v_pos    := v_pos + 1;
    total    := total + round(v_qty * v_price, 2);
    max_days := greatest(max_days, coalesce(v_service.due_days, p_default_days, 3));
  end loop;

  if total > 99999999 then
    raise exception 'Valor total do pedido muito alto.' using errcode = '22023';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- create_order: agora com orçamento (p_as_quote) e ficha dos itens
-- ---------------------------------------------------------------------
drop function if exists public.create_order(uuid, jsonb, date, text, public.delivery_type);

create or replace function public.create_order(
  p_customer_id    uuid,
  p_items          jsonb,
  p_due_date       date default null,
  p_notes          text default null,
  p_delivery_type  public.delivery_type default 'retirada',
  p_as_quote       boolean default false
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

  insert into public.orders (business_id, number, customer_id, due_date, notes, created_by, delivery_type, status)
  values (
    v_business, v_number, p_customer_id,
    coalesce(p_due_date, current_date),
    nullif(trim(coalesce(p_notes, '')), ''),
    v_user,
    coalesce(p_delivery_type, 'retirada'),
    case when coalesce(p_as_quote, false) then 'orcamento' else 'recebido' end::public.order_status
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
-- update_quote_items: troca os itens de um orçamento (preços e quantidades combinados com o cliente)
-- ---------------------------------------------------------------------
create or replace function public.update_quote_items(p_order_id uuid, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order   public.orders%rowtype;
  v_default integer;
  v_res     record;
begin
  if auth.uid() is null then
    raise exception 'Faça login para continuar.' using errcode = '28000';
  end if;

  select * into v_order from public.orders o where o.id = p_order_id for update;
  if v_order.id is null or not public.is_business_member(v_order.business_id) then
    raise exception 'Pedido não encontrado.' using errcode = 'P0001';
  end if;
  if v_order.status <> 'orcamento' then
    raise exception 'Só dá para alterar os itens enquanto é orçamento.' using errcode = 'P0001';
  end if;

  select s.default_due_days into v_default from public.business_settings s where s.business_id = v_order.business_id;

  delete from public.order_items where order_id = p_order_id;
  select * into v_res from public.insert_order_items(v_order.business_id, p_order_id, p_items, v_default);
  update public.orders set total = v_res.total where id = p_order_id;
end;
$$;

-- ---------------------------------------------------------------------
-- set_order_status: orçamento → recebido (aprovado) ou cancelado (recusado)
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

  v_ok := case v_order.status::text
    when 'orcamento'  then p_status::text in ('recebido', 'cancelado')
    when 'recebido'   then p_status::text in ('em_lavagem', 'pronto', 'cancelado')
    when 'em_lavagem' then p_status::text in ('recebido', 'pronto', 'cancelado')
    when 'pronto'     then p_status::text in ('em_lavagem', 'entregue', 'cancelado')
    when 'entregue'   then p_status::text = 'pronto'
    else false
  end;

  if not v_ok then
    raise exception 'Não é possível mudar o pedido de "%" para "%".', v_order.status, p_status using errcode = 'P0001';
  end if;

  update public.orders
     set status       = p_status,
         -- orçamento aprovado: a data de recebimento passa a ser a da aprovação
         received_at  = case when v_order.status::text = 'orcamento' and p_status::text = 'recebido' then now() else received_at end,
         ready_at     = case when p_status::text = 'pronto' and v_order.status::text <> 'entregue' then now()
                             when p_status::text in ('recebido', 'em_lavagem') then null
                             else ready_at end,
         delivered_at = case when p_status::text = 'entregue' then now() else null end,
         canceled_at  = case when p_status::text = 'cancelado' then now() else null end
   where id = p_order_id;
end;
$$;

-- Permissões
revoke all on function public.clean_item_attributes(jsonb) from public, anon, authenticated;
revoke all on function public.insert_order_items(uuid, uuid, jsonb, integer) from public, anon, authenticated;
revoke all on function public.create_order(uuid, jsonb, date, text, public.delivery_type, boolean) from public, anon;
grant execute on function public.create_order(uuid, jsonb, date, text, public.delivery_type, boolean) to authenticated;
revoke all on function public.update_quote_items(uuid, jsonb) from public, anon;
grant execute on function public.update_quote_items(uuid, jsonb) to authenticated;

-- Recursos entregues nesta etapa
update public.features set status = 'disponivel'
 where code in ('campos_calcado', 'catalogo_roupas', 'dimensoes_item', 'orcamento');
