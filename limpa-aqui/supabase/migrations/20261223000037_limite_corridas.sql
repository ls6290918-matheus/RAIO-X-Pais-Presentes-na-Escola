-- =====================================================================
-- LIMPA AQUI — Fase 1 / Subetapa 2: limite de corridas simultâneas por entregador
--  * platform_settings.max_active_deliveries: quantas corridas ativas (aceita ou coletada) um
--    entregador pode ter ao mesmo tempo. Começa em 1; o admin muda (1 a 5)
--  * accept_delivery trava primeiro a linha do entregador (couriers, FOR UPDATE): dois aceites
--    simultâneos do mesmo entregador entram em fila e o segundo já vê o primeiro ao contar.
--    Depois trava a corrida, como antes (dois entregadores na mesma corrida: só um ganha)
--  * Concluir, cancelar ou desistir libera a vaga (deixa de ser aceita/coletada)
--  * O modelo de corridas não muda: coleta e devolução continuam independentes
-- =====================================================================

alter table public.platform_settings
  add column if not exists max_active_deliveries integer not null default 1 check (max_active_deliveries between 1 and 5);

create or replace function public.courier_max_active()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.max_active_deliveries from public.platform_settings s where s.id), 1);
$$;

create or replace function public.accept_delivery(p_delivery_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.deliveries;
  v_max integer;
  v_active integer;
begin
  if not public.has_role('entregador') then
    raise exception 'Seu cadastro de entregador ainda não foi aprovado.' using errcode = '42501';
  end if;
  -- trava do entregador: aceites simultâneos dele são atendidos um de cada vez
  perform 1 from public.couriers c where c.user_id = auth.uid() and c.online for update;
  if not found then
    raise exception 'Fique online para aceitar corridas.' using errcode = '22023';
  end if;

  select * into d from public.deliveries where id = p_delivery_id for update;
  if d.id is null or not exists (select 1 from public.courier_areas a where a.user_id = auth.uid() and a.municipality_id = d.municipality_id and a.active) then
    raise exception 'Corrida não encontrada.' using errcode = 'P0001';
  end if;
  if d.status <> 'disponivel' then
    raise exception 'Outra pessoa já pegou esta corrida.' using errcode = 'P0001';
  end if;

  v_max := public.courier_max_active();
  select count(*) into v_active from public.deliveries x
   where x.courier_id = auth.uid() and x.status in ('aceita', 'coletada');
  if v_active >= v_max then
    raise exception 'Você já tem % corrida(s) em andamento. Conclua antes de aceitar outra.', v_active using errcode = '22023';
  end if;

  update public.deliveries set status = 'aceita', courier_id = auth.uid(), accepted_at = now() where id = d.id;
end;
$$;

-- Painel do entregador: mostra o limite junto das corridas em andamento
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
      'active', count(*) filter (where d.status in ('aceita', 'coletada')),
      'max_active', public.courier_max_active()
    )
    from public.deliveries d
    where d.courier_id = auth.uid()
  );
end;
$$;

-- Admin: ler e mudar o limite
create or replace function public.admin_logistics_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_role('admin') then
    raise exception 'Somente a administração da plataforma pode fazer isso.' using errcode = '42501';
  end if;
  return jsonb_build_object('max_active_deliveries', public.courier_max_active());
end;
$$;

create or replace function public.admin_set_max_active_deliveries(p_max integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_role('admin') then
    raise exception 'Somente a administração da plataforma pode fazer isso.' using errcode = '42501';
  end if;
  if p_max is null or p_max not between 1 and 5 then
    raise exception 'Escolha de 1 a 5 corridas ao mesmo tempo.' using errcode = '22023';
  end if;
  update public.platform_settings set max_active_deliveries = p_max, updated_at = now(), updated_by = auth.uid() where id;
end;
$$;

revoke all on function public.courier_max_active() from public, anon, authenticated;
revoke all on function public.admin_logistics_settings() from public, anon;
revoke all on function public.admin_set_max_active_deliveries(integer) from public, anon;
grant execute on function public.admin_logistics_settings() to authenticated;
grant execute on function public.admin_set_max_active_deliveries(integer) to authenticated;
