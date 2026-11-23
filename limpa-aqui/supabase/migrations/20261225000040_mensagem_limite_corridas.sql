-- =====================================================================
-- LIMPA AQUI — Fase 1 / Subetapa 2 (ajuste): texto do aviso do limite de corridas
-- Só a mensagem muda. A regra, a trava contra concorrência e a assinatura de accept_delivery
-- continuam exatamente iguais às da migration 37.
--  * limite 1: "Você já possui uma entrega em andamento. Conclua ou finalize essa entrega antes de aceitar outra."
--  * limite maior: "Você já possui N entregas em andamento (o limite é N). Conclua ou finalize uma delas antes de aceitar outra."
-- =====================================================================
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
    if v_max = 1 then
      raise exception 'Você já possui uma entrega em andamento. Conclua ou finalize essa entrega antes de aceitar outra.' using errcode = '22023';
    end if;
    raise exception 'Você já possui % entregas em andamento (o limite é %). Conclua ou finalize uma delas antes de aceitar outra.', v_active, v_max
      using errcode = '22023';
  end if;

  update public.deliveries set status = 'aceita', courier_id = auth.uid(), accepted_at = now() where id = d.id;
end;
$$;

revoke all on function public.accept_delivery(uuid) from public, anon;
grant execute on function public.accept_delivery(uuid) to authenticated;
