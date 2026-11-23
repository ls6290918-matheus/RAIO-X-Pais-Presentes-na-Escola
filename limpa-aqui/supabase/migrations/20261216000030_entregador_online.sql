-- =====================================================================
-- LIMPA AQUI — Etapa 6: entregador online/offline (PRD Fase 4)
--  * couriers.online / online_since: só quem está online vê e aceita corridas livres
--  * corridas já aceitas continuam visíveis e podem ser concluídas mesmo offline
--  * courier_summary(): online, corridas e ganhos de hoje e da semana, corridas em andamento
-- =====================================================================

alter table public.couriers add column if not exists online boolean not null default false;
alter table public.couriers add column if not exists online_since timestamptz;

create or replace function public.set_courier_online(p_online boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_role('entregador') then
    raise exception 'Seu cadastro de entregador ainda não foi aprovado.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.couriers where user_id = auth.uid()) then
    raise exception 'Complete seu cadastro de entregador primeiro.' using errcode = '22023';
  end if;
  if p_online and not exists (select 1 from public.courier_areas where user_id = auth.uid() and active) then
    raise exception 'Escolha pelo menos um município para ficar online.' using errcode = '22023';
  end if;
  update public.couriers
     set online = coalesce(p_online, false),
         online_since = case when coalesce(p_online, false) then coalesce(case when online then online_since end, now()) end
   where user_id = auth.uid();
  return coalesce(p_online, false);
end;
$$;

-- Corridas livres: só para quem está online
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
  if not exists (select 1 from public.couriers c where c.user_id = auth.uid() and c.online) then
    return;
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

-- Aceitar: precisa estar online
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
  if not exists (select 1 from public.couriers c where c.user_id = auth.uid() and c.online) then
    raise exception 'Fique online para aceitar corridas.' using errcode = '22023';
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

-- Resumo do entregador (dia e semana no fuso de Brasília)
create or replace function public.courier_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now timestamp := now() at time zone 'America/Sao_Paulo';
  d0 timestamptz := date_trunc('day', v_now) at time zone 'America/Sao_Paulo';
  w0 timestamptz := date_trunc('week', v_now) at time zone 'America/Sao_Paulo';
begin
  if not exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'entregador') then
    raise exception 'Você não tem perfil de entregador.' using errcode = '42501';
  end if;
  return (
    select jsonb_build_object(
      'online', coalesce((select c.online from public.couriers c where c.user_id = auth.uid()), false),
      'online_since', (select c.online_since from public.couriers c where c.user_id = auth.uid()),
      'today_rides', count(*) filter (where d.status = 'entregue' and d.completed_at >= d0),
      'today_earnings', coalesce(sum(d.courier_earnings) filter (where d.status = 'entregue' and d.completed_at >= d0), 0),
      'week_rides', count(*) filter (where d.status = 'entregue' and d.completed_at >= w0),
      'week_earnings', coalesce(sum(d.courier_earnings) filter (where d.status = 'entregue' and d.completed_at >= w0), 0),
      'active', count(*) filter (where d.status in ('aceita', 'coletada'))
    )
    from public.deliveries d
    where d.courier_id = auth.uid()
  );
end;
$$;

revoke all on function public.set_courier_online(boolean) from public, anon;
revoke all on function public.courier_summary() from public, anon;
revoke all on function public.courier_available_deliveries() from public, anon;
revoke all on function public.accept_delivery(uuid) from public, anon;
grant execute on function public.set_courier_online(boolean) to authenticated;
grant execute on function public.courier_summary() to authenticated;
grant execute on function public.courier_available_deliveries() to authenticated;
grant execute on function public.accept_delivery(uuid) to authenticated;
