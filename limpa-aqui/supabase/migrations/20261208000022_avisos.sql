-- =====================================================================
-- LIMPA AQUI — avisos (notificações) dentro do app
--  * notifications: um aviso por pessoa; cada um só vê os seus; "lido" pela RPC
--  * gerados por gatilhos nos eventos do marketplace (pedido novo, Pix confirmado, situação do pedido,
--    proposta recebida/aceita, corrida disponível, repasse pago, plano ativado)
--  * um erro ao avisar NUNCA desfaz o evento: cada gatilho engole a própria falha
--  * emailed_at fica pronto para o envio por e-mail (quando houver um serviço de envio configurado)
-- =====================================================================

create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  kind       text not null check (kind ~ '^[a-z_]{3,40}$'),
  title      text not null check (char_length(title) between 1 and 120),
  body       text check (body is null or char_length(body) <= 300),
  link       text check (link is null or (char_length(link) <= 200 and link ~ '^/')),
  read_at    timestamptz,
  emailed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx on public.notifications (user_id) where read_at is null;

alter table public.notifications enable row level security;
create policy notifications_select_own on public.notifications for select to authenticated using (user_id = auth.uid());
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;

create or replace function public.notify(p_user uuid, p_kind text, p_title text, p_body text, p_link text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, kind, title, body, link)
  select p_user, p_kind, left(p_title, 120), left(p_body, 300), left(p_link, 200)
  where p_user is not null;
$$;

-- Avisa toda a equipe de uma lavanderia (dono e funcionários)
create or replace function public.notify_business(p_business uuid, p_kind text, p_title text, p_body text, p_link text, p_owner_only boolean default false)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, kind, title, body, link)
  select m.user_id, p_kind, left(p_title, 120), left(p_body, 300), left(p_link, 200)
  from public.business_members m
  where m.business_id = p_business and (not p_owner_only or m.role = 'owner');
$$;

create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  if auth.uid() is null then
    raise exception 'Faça login para continuar.' using errcode = '28000';
  end if;
  update public.notifications set read_at = now()
   where user_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---------------------------------------------------------------------
-- Pedidos do marketplace
-- ---------------------------------------------------------------------
create or replace function public.orders_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_biz text;
  v_label text;
begin
  if new.origin is distinct from 'marketplace' then
    return new;
  end if;
  begin
    select b.name into v_biz from public.businesses b where b.id = new.business_id;

    -- pedido novo (o valor é gravado logo depois de criado)
    if coalesce(old.total, 0) = 0 and coalesce(new.total, 0) > 0 then
      perform public.notify_business(new.business_id, 'pedido_novo',
        'Novo pedido nº ' || new.number || ' pelo Limpa Aqui',
        case when new.payment_mode = 'app' then 'Aguardando o Pix do cliente: comece só depois da confirmação.'
             else 'Pagamento direto ao prestador. Combine com o cliente pelo WhatsApp.' end,
        '/app/pedidos/' || new.id);
    end if;

    -- Pix confirmado
    if new.payment_mode = 'app' and new.paid and not old.paid then
      perform public.notify_business(new.business_id, 'pix_confirmado',
        'Pix confirmado: pedido nº ' || new.number, 'O pagamento foi confirmado. Pode começar o serviço.', '/app/pedidos/' || new.id);
      perform public.notify(new.client_user_id, 'pix_confirmado',
        'Pagamento confirmado', 'Seu Pix do pedido nº ' || new.number || ' em ' || v_biz || ' foi confirmado.', '/cliente');
    end if;

    -- situação do pedido para o cliente
    if new.status is distinct from old.status and new.client_user_id is not null then
      v_label := case new.status
                   when 'em_lavagem' then 'está em lavagem'
                   when 'pronto' then 'está pronto'
                   when 'entregue' then 'foi entregue'
                   when 'cancelado' then 'foi cancelado'
                 end;
      if v_label is not null then
        perform public.notify(new.client_user_id, 'pedido_' || new.status::text,
          'Pedido nº ' || new.number || ' ' || v_label, v_biz, '/cliente');
      end if;
      if new.status = 'cancelado' then
        perform public.notify_business(new.business_id, 'pedido_cancelado', 'Pedido nº ' || new.number || ' cancelado', null, '/app/pedidos/' || new.id);
      end if;
    end if;
  exception when others then
    raise warning 'aviso de pedido falhou: %', sqlerrm;
  end;
  return new;
end;
$$;

create trigger orders_notify
  after update of total, paid, status on public.orders
  for each row execute function public.orders_notify();

-- ---------------------------------------------------------------------
-- Propostas
-- ---------------------------------------------------------------------
create or replace function public.proposals_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.listings;
  v_biz text;
begin
  begin
    select * into l from public.listings where id = new.listing_id;
    select b.name into v_biz from public.businesses b where b.id = new.business_id;
    if tg_op = 'INSERT' then
      perform public.notify(l.user_id, 'proposta_nova', 'Nova proposta para "' || left(l.title, 60) || '"',
        v_biz || ' enviou uma proposta.', '/cliente/anuncios/' || l.id);
    elsif new.status = 'aceita' and old.status <> 'aceita' then
      perform public.notify_business(new.business_id, 'proposta_aceita', 'Sua proposta foi aceita!',
        '"' || left(l.title, 60) || '" virou pedido.', '/app/pedidos', true);
    end if;
  exception when others then
    raise warning 'aviso de proposta falhou: %', sqlerrm;
  end;
  return new;
end;
$$;

create trigger proposals_notify
  after insert or update of status on public.proposals
  for each row execute function public.proposals_notify();

-- ---------------------------------------------------------------------
-- Corridas livres → entregadores aprovados do município
-- ---------------------------------------------------------------------
create or replace function public.deliveries_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'disponivel' then
    return new;
  end if;
  begin
    insert into public.notifications (user_id, kind, title, body, link)
    select ca.user_id, 'corrida_disponivel',
           'Nova corrida de ' || case when new.leg = 'pickup' then 'coleta' else 'devolução' end,
           coalesce(new.origin_neighborhood, '') || ' → ' || coalesce(new.dest_neighborhood, '') || ' · ' || new.distance_km || ' km',
           '/entregas'
    from public.courier_areas ca
    join public.user_roles r on r.user_id = ca.user_id and r.role = 'entregador' and r.status = 'ativo'
    where ca.municipality_id = new.municipality_id
    limit 200;
  exception when others then
    raise warning 'aviso de corrida falhou: %', sqlerrm;
  end;
  return new;
end;
$$;

create trigger deliveries_notify
  after insert on public.deliveries
  for each row execute function public.deliveries_notify();

-- ---------------------------------------------------------------------
-- Repasse pago e plano ativado
-- ---------------------------------------------------------------------
create or replace function public.payouts_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_txt text;
begin
  if new.status <> 'pago' or old.status = 'pago' then
    return new;
  end if;
  begin
    v_txt := 'Repasse de R$ ' || to_char(new.amount, 'FM999G990D00') || ' pago na sua chave Pix.';
    if new.payee_type = 'entregador' then
      perform public.notify(new.courier_id, 'repasse_pago', 'Repasse pago', v_txt, '/entregas');
    else
      perform public.notify_business(new.business_id, 'repasse_pago', 'Repasse pago', v_txt, '/app/pedidos', true);
    end if;
  exception when others then
    raise warning 'aviso de repasse falhou: %', sqlerrm;
  end;
  return new;
end;
$$;

create trigger payouts_notify
  after update of status on public.payouts
  for each row execute function public.payouts_notify();

create or replace function public.invoices_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'paga' and old.status <> 'paga' then
    begin
      perform public.notify_business(new.business_id, 'plano_ativo',
        'Plano ' || (select p.name from public.plans p where p.id = new.plan_id) || ' ativo',
        'Pagamento confirmado. Válido até ' || to_char(new.period_end at time zone 'America/Sao_Paulo', 'DD/MM/YYYY') || '.', '/app/plano', true);
    exception when others then
      raise warning 'aviso de plano falhou: %', sqlerrm;
    end;
  end if;
  return new;
end;
$$;

create trigger subscription_invoices_notify
  after update of status on public.subscription_invoices
  for each row execute function public.invoices_notify();

revoke all on function public.notify(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.notify_business(uuid, text, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.orders_notify() from public, anon, authenticated;
revoke all on function public.proposals_notify() from public, anon, authenticated;
revoke all on function public.deliveries_notify() from public, anon, authenticated;
revoke all on function public.payouts_notify() from public, anon, authenticated;
revoke all on function public.invoices_notify() from public, anon, authenticated;
revoke all on function public.mark_notifications_read(uuid[]) from public, anon;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;
