-- =====================================================================
-- LIMPA AQUI — Comprovantes por corrida (PRD seção 8 / logística)
--  * Na coleta: o entregador registra foto, quantidade de peças e estado (obrigatório)
--  * Na entrega: quem recebe passa um código de 4 dígitos que só aparece no app dele
--      - coleta (cliente → lavanderia): o código aparece para a equipe da lavanderia
--      - devolução (lavanderia → cliente): o código aparece para o cliente
--    Sem o código (quem recebe não tem acesso ao app), a entrega exige foto e explicação e
--    fica marcada como "sem código" para a administração. 5 tentativas erradas bloqueiam o código.
--  * Quantidade diferente da coleta ou peça com avaria avisa a lavanderia e o cliente
--  * "Coletei" e "Entreguei" só andam por estas funções (advance_delivery fica interna)
--  * Fotos num bucket privado: entregador da corrida, equipe da lavanderia, cliente e admin
-- =====================================================================

alter table public.deliveries
  add column if not exists handoff_code text not null default lpad((floor(random() * 10000))::int::text, 4, '0')
    check (handoff_code ~ '^[0-9]{4}$'),
  add column if not exists code_attempts integer not null default 0 check (code_attempts between 0 and 10);

-- O código nunca sai pela tabela (o entregador lê as próprias corridas): só pela RPC de quem recebe
revoke select on public.deliveries from authenticated;
grant select (id, order_id, business_id, leg, municipality_id, courier_id, origin_label, origin_address, origin_neighborhood,
              origin_lat, origin_lng, dest_label, dest_address, dest_neighborhood, dest_lat, dest_lng, distance_km,
              delivery_fee, courier_earnings, status, accepted_at, picked_at, completed_at, canceled_at, created_at, updated_at)
  on public.deliveries to authenticated;

create table if not exists public.delivery_proofs (
  id            uuid primary key default gen_random_uuid(),
  delivery_id   uuid not null references public.deliveries (id) on delete cascade,
  stage         text not null check (stage in ('coleta', 'entrega')),
  item_count    integer not null check (item_count between 1 and 500),
  condition     text not null check (condition in ('ok', 'avaria')),
  notes         text check (notes is null or char_length(notes) <= 300),
  photo_path    text check (photo_path is null or char_length(photo_path) <= 200),
  code_verified boolean,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (delivery_id, stage),
  check (stage = 'coleta' or code_verified is not null),
  check (stage = 'entrega' or photo_path is not null)
);
alter table public.delivery_proofs enable row level security;
revoke all on public.delivery_proofs from anon, authenticated;

-- Quem pode ver uma corrida e seus comprovantes
create or replace function public.can_see_delivery(p_delivery uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.deliveries d join public.orders o on o.id = d.order_id
    where d.id = p_delivery
      and (d.courier_id = auth.uid() or o.client_user_id = auth.uid()
           or public.is_business_member(d.business_id) or public.has_role('admin')));
$$;

-- Caminho da foto: <corrida>/<arquivo>.jpg e o arquivo precisa existir no Storage
create or replace function public.delivery_photo_ok(p_delivery uuid, p_path text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ok boolean;
begin
  if p_path is null or p_path !~ ('^' || p_delivery::text || '/[A-Za-z0-9_-]{8,64}\.(jpg|webp)$') then
    return false;
  end if;
  if to_regclass('storage.objects') is null then
    return true; -- banco sem Storage (testes locais)
  end if;
  execute 'select exists (select 1 from storage.objects where bucket_id = $1 and name = $2)' into v_ok using 'delivery-proofs', p_path;
  return v_ok;
end;
$$;

-- "Coletei" e "Entreguei" diretos ficam bloqueados: só pelo registro com comprovante
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
  if current_setting('limpaaqui.internal', true) is distinct from 'on' then
    raise exception 'Registre a coleta ou a entrega com o comprovante (foto, quantidade e código).' using errcode = 'P0001';
  end if;
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
    if d.leg = 'return' and o.status = 'pronto' then
      update public.orders set status = 'entregue', delivered_at = now() where id = o.id;
    end if;
  end if;
end;
$$;

-- Avisa lavanderia e cliente de divergência na quantidade ou de avaria
create or replace function public.delivery_proof_alert(d public.deliveries, p_stage text, p_count integer, p_condition text, p_notes text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  v_pick integer;
  v_msg text;
begin
  select * into o from public.orders where id = d.order_id;
  if p_stage = 'entrega' then
    select item_count into v_pick from public.delivery_proofs where delivery_id = d.id and stage = 'coleta';
  end if;
  if p_condition = 'avaria' then
    v_msg := 'O entregador registrou avaria na ' || p_stage || ': ' || coalesce(p_notes, '');
  elsif v_pick is not null and v_pick <> p_count then
    v_msg := 'Quantidade diferente: ' || v_pick || ' peça(s) na coleta e ' || p_count || ' na entrega.';
  else
    return;
  end if;
  perform public.order_history_add(o.id, 'alerta_corrida', null, null, left(v_msg, 300));
  perform public.notify_business(d.business_id, 'corrida_alerta', 'Atenção no pedido nº ' || o.number, v_msg, '/app/pedidos/' || o.id, false);
  perform public.notify(o.client_user_id, 'corrida_alerta', 'Atenção no pedido nº ' || o.number, v_msg, '/cliente/pedidos');
exception when others then null;
end;
$$;

-- Coleta: foto + quantidade + estado
create or replace function public.delivery_pickup(p_delivery_id uuid, p_item_count integer, p_condition text, p_photo_path text, p_notes text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.deliveries;
  v_notes text := nullif(trim(coalesce(p_notes, '')), '');
begin
  select * into d from public.deliveries where id = p_delivery_id for update;
  if d.id is null or d.courier_id is distinct from auth.uid() then
    raise exception 'Corrida não encontrada.' using errcode = 'P0001';
  end if;
  if d.status <> 'aceita' then
    raise exception 'A coleta desta corrida já foi registrada.' using errcode = 'P0001';
  end if;
  if p_item_count is null or p_item_count not between 1 and 500 then
    raise exception 'Informe quantas peças você retirou.' using errcode = '22023';
  end if;
  if p_condition is null or p_condition not in ('ok', 'avaria') then
    raise exception 'Informe o estado das peças.' using errcode = '22023';
  end if;
  if p_condition = 'avaria' and v_notes is null then
    raise exception 'Descreva a avaria que você viu.' using errcode = '22023';
  end if;
  if not public.delivery_photo_ok(d.id, p_photo_path) then
    raise exception 'Tire uma foto das peças antes de registrar a coleta.' using errcode = '22023';
  end if;
  insert into public.delivery_proofs (delivery_id, stage, item_count, condition, notes, photo_path, created_by)
  values (d.id, 'coleta', p_item_count, p_condition, left(v_notes, 300), p_photo_path, auth.uid());
  perform set_config('limpaaqui.internal', 'on', true);
  perform public.advance_delivery(d.id, 'coletada');
  perform set_config('limpaaqui.internal', 'off', true);
  perform public.delivery_proof_alert(d, 'coleta', p_item_count, p_condition, v_notes);
end;
$$;

-- Entrega: código de quem recebe (ou, sem código, foto + explicação) + quantidade + estado
create or replace function public.delivery_dropoff(
  p_delivery_id uuid, p_code text, p_item_count integer, p_condition text,
  p_photo_path text default null, p_notes text default null, p_without_code boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.deliveries;
  v_notes text := nullif(trim(coalesce(p_notes, '')), '');
  v_photo text := nullif(trim(coalesce(p_photo_path, '')), '');
begin
  select * into d from public.deliveries where id = p_delivery_id for update;
  if d.id is null or d.courier_id is distinct from auth.uid() then
    raise exception 'Corrida não encontrada.' using errcode = 'P0001';
  end if;
  if d.status <> 'coletada' then
    raise exception 'Registre a coleta antes da entrega.' using errcode = 'P0001';
  end if;
  if p_item_count is null or p_item_count not between 1 and 500 then
    raise exception 'Informe quantas peças você entregou.' using errcode = '22023';
  end if;
  if p_condition is null or p_condition not in ('ok', 'avaria') then
    raise exception 'Informe o estado das peças.' using errcode = '22023';
  end if;
  if p_condition = 'avaria' and v_notes is null then
    raise exception 'Descreva a avaria.' using errcode = '22023';
  end if;
  if v_photo is not null and not public.delivery_photo_ok(d.id, v_photo) then
    raise exception 'A foto não foi encontrada. Envie de novo.' using errcode = '22023';
  end if;

  if coalesce(p_without_code, false) then
    if v_photo is null or v_notes is null then
      raise exception 'Sem o código, tire uma foto da entrega e explique quem recebeu.' using errcode = '22023';
    end if;
  else
    if d.code_attempts >= 5 then
      return jsonb_build_object('ok', false, 'error', 'Código bloqueado por tentativas erradas. Registre a entrega sem código, com foto e explicação.', 'remaining', 0);
    end if;
    if coalesce(trim(p_code), '') <> d.handoff_code then
      update public.deliveries set code_attempts = code_attempts + 1 where id = d.id;
      return jsonb_build_object('ok', false, 'error', 'Código incorreto. Confira com quem está recebendo.', 'remaining', 4 - d.code_attempts);
    end if;
  end if;

  insert into public.delivery_proofs (delivery_id, stage, item_count, condition, notes, photo_path, code_verified, created_by)
  values (d.id, 'entrega', p_item_count, p_condition, left(v_notes, 300), v_photo, not coalesce(p_without_code, false), auth.uid());
  perform set_config('limpaaqui.internal', 'on', true);
  perform public.advance_delivery(d.id, 'entregue');
  perform set_config('limpaaqui.internal', 'off', true);
  perform public.delivery_proof_alert(d, 'entrega', p_item_count, p_condition, v_notes);
  if coalesce(p_without_code, false) then
    begin
      perform public.order_history_add(d.order_id, 'entrega_sem_codigo', null, null, left('Entrega registrada sem código: ' || v_notes, 300));
    exception when others then null;
    end;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- Comprovantes das corridas (entregador da corrida, cliente, equipe da lavanderia e admin)
create or replace function public.delivery_proofs_for(p_delivery_ids uuid[])
returns table (delivery_id uuid, leg public.delivery_leg, stage text, item_count integer, condition text, notes text,
               photo_path text, code_verified boolean, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select p.delivery_id, d.leg, p.stage, p.item_count, p.condition, p.notes, p.photo_path, p.code_verified, p.created_at
  from public.delivery_proofs p join public.deliveries d on d.id = p.delivery_id
  where p.delivery_id = any (coalesce(p_delivery_ids, '{}')) and public.can_see_delivery(p.delivery_id)
  order by p.created_at;
$$;

-- Código de entrega: só para quem recebe e só enquanto a corrida está em andamento
create or replace function public.delivery_handoff_codes(p_order_id uuid)
returns table (delivery_id uuid, leg public.delivery_leg, code text)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id, d.leg, d.handoff_code
  from public.deliveries d join public.orders o on o.id = d.order_id
  where d.order_id = p_order_id and d.status in ('aceita', 'coletada')
    and ((d.leg = 'pickup' and public.is_business_member(d.business_id))
      or (d.leg = 'return' and o.client_user_id = auth.uid()));
$$;

-- ---------------------------------------------------------------------
-- Storage: fotos dos comprovantes (privado)
-- ---------------------------------------------------------------------
do $outer$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'Storage não disponível neste banco; bucket não criado.';
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('delivery-proofs', 'delivery-proofs', false, 3145728, array['image/jpeg', 'image/webp'])
  on conflict (id) do update set public = false, file_size_limit = 3145728, allowed_mime_types = array['image/jpeg', 'image/webp'];

  execute 'drop policy if exists delivery_proofs_obj_read on storage.objects';
  execute 'drop policy if exists delivery_proofs_obj_write on storage.objects';
  execute 'drop policy if exists delivery_proofs_obj_remove on storage.objects';
  execute $p$
    create policy delivery_proofs_obj_read on storage.objects for select to authenticated
      using (bucket_id = 'delivery-proofs' and public.can_see_delivery(public.business_of_path(name)))
  $p$;
  execute $p$
    create policy delivery_proofs_obj_write on storage.objects for insert to authenticated
      with check (bucket_id = 'delivery-proofs' and exists (
        select 1 from public.deliveries d where d.id = public.business_of_path(name) and d.courier_id = auth.uid() and d.status in ('aceita', 'coletada')))
  $p$;
  execute $p$
    create policy delivery_proofs_obj_remove on storage.objects for delete to authenticated
      using (bucket_id = 'delivery-proofs' and exists (
        select 1 from public.deliveries d where d.id = public.business_of_path(name) and d.courier_id = auth.uid() and d.status in ('aceita', 'coletada'))
        and not exists (select 1 from public.delivery_proofs p where p.photo_path = name))
  $p$;
end
$outer$;

revoke all on function public.can_see_delivery(uuid) from public, anon;
revoke all on function public.delivery_photo_ok(uuid, text) from public, anon, authenticated;
revoke all on function public.delivery_proof_alert(public.deliveries, text, integer, text, text) from public, anon, authenticated;
revoke all on function public.delivery_pickup(uuid, integer, text, text, text) from public, anon;
revoke all on function public.delivery_dropoff(uuid, text, integer, text, text, text, boolean) from public, anon;
revoke all on function public.delivery_proofs_for(uuid[]) from public, anon;
revoke all on function public.delivery_handoff_codes(uuid) from public, anon;
grant execute on function public.can_see_delivery(uuid) to authenticated;
grant execute on function public.delivery_pickup(uuid, integer, text, text, text) to authenticated;
grant execute on function public.delivery_dropoff(uuid, text, integer, text, text, text, boolean) to authenticated;
grant execute on function public.delivery_proofs_for(uuid[]) to authenticated;
grant execute on function public.delivery_handoff_codes(uuid) to authenticated;
