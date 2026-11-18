-- =====================================================================
-- LIMPA AQUI — Onboarding dinâmico, Etapa 7: equipe
--  * team_invites: convite por link (código secreto, uso único, vale 7 dias)
--  * RPCs: create_invite, get_invite, accept_invite, revoke_invite, list_team, remove_member
-- Quem aceita entra como funcionário (staff) da lavanderia de quem convidou.
-- Na Fase 1 cada pessoa participa de uma única lavanderia.
-- =====================================================================

create table if not exists public.team_invites (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  token        text not null unique default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
               check (token ~ '^[0-9a-f]{64}$'),
  name         text check (name is null or char_length(trim(name)) between 2 and 80),
  role         public.business_role not null default 'staff' check (role = 'staff'),
  created_by   uuid references auth.users (id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '7 days',
  accepted_at  timestamptz,
  accepted_by  uuid references auth.users (id) on delete set null,
  revoked_at   timestamptz
);

create index if not exists team_invites_business_idx on public.team_invites (business_id, created_at desc);

alter table public.team_invites enable row level security;

-- Só o dono vê os convites da lavanderia; criar, aceitar e cancelar é sempre por RPC
create policy team_invites_select_owner on public.team_invites
  for select to authenticated using (public.is_business_owner(business_id));

revoke all on public.team_invites from anon, authenticated;
grant select on public.team_invites to authenticated;

-- ---------------------------------------------------------------------
-- create_invite: dono gera o link (no máximo 20 convites pendentes)
-- ---------------------------------------------------------------------
create or replace function public.create_invite(p_business_id uuid, p_name text default null)
returns table (id uuid, token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Faça login para continuar.' using errcode = '28000';
  end if;
  if not public.is_business_owner(p_business_id) then
    raise exception 'Somente o dono da lavanderia pode convidar pessoas.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.team_invites i
      where i.business_id = p_business_id and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()) >= 20 then
    raise exception 'Há muitos convites pendentes. Cancele algum antes de criar outro.' using errcode = 'P0001';
  end if;
  if p_name is not null and char_length(trim(p_name)) not between 0 and 80 then
    raise exception 'Nome muito longo.' using errcode = '22023';
  end if;

  return query
  insert into public.team_invites (business_id, name, created_by)
  values (p_business_id, nullif(trim(coalesce(p_name, '')), ''), auth.uid())
  returning team_invites.id, team_invites.token, team_invites.expires_at;
end;
$$;

-- ---------------------------------------------------------------------
-- get_invite: o que a pessoa convidada vê ao abrir o link (pode estar sem login)
-- Devolve só o nome da lavanderia e a situação do convite.
-- ---------------------------------------------------------------------
create or replace function public.get_invite(p_token text)
returns table (business_name text, status text, expires_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select b.name,
         case
           when i.revoked_at is not null then 'cancelado'
           when i.accepted_at is not null then 'usado'
           when i.expires_at <= now() then 'expirado'
           else 'valido'
         end,
         i.expires_at
  from public.team_invites i
  join public.businesses b on b.id = i.business_id
  where i.token = p_token and p_token ~ '^[0-9a-f]{64}$';
$$;

-- ---------------------------------------------------------------------
-- accept_invite: a pessoa logada entra como funcionária
-- ---------------------------------------------------------------------
create or replace function public.accept_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_inv  public.team_invites%rowtype;
begin
  if v_user is null then
    raise exception 'Entre na sua conta para aceitar o convite.' using errcode = '28000';
  end if;

  select * into v_inv from public.team_invites i where i.token = p_token and p_token ~ '^[0-9a-f]{64}$' for update;
  if v_inv.id is null then
    raise exception 'Convite não encontrado. Confira o link.' using errcode = 'P0001';
  end if;
  if v_inv.revoked_at is not null then
    raise exception 'Este convite foi cancelado pela lavanderia.' using errcode = 'P0001';
  end if;
  if v_inv.accepted_at is not null then
    raise exception 'Este convite já foi usado.' using errcode = 'P0001';
  end if;
  if v_inv.expires_at <= now() then
    raise exception 'Este convite expirou. Peça um novo link para a lavanderia.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.business_members m where m.user_id = v_user) then
    raise exception 'Sua conta já faz parte de uma lavanderia. Use outra conta para aceitar este convite.' using errcode = 'P0001';
  end if;

  insert into public.business_members (business_id, user_id, role) values (v_inv.business_id, v_user, 'staff');
  update public.team_invites set accepted_at = now(), accepted_by = v_user where id = v_inv.id;
  -- se a pessoa tinha começado o assistente de cadastro, ele não é mais necessário
  delete from public.onboarding_profiles where user_id = v_user and business_id is null;
  return v_inv.business_id;
end;
$$;

-- ---------------------------------------------------------------------
-- revoke_invite: dono cancela um convite pendente
-- ---------------------------------------------------------------------
create or replace function public.revoke_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid;
begin
  select business_id into v_business from public.team_invites where id = p_invite_id;
  if v_business is null or not public.is_business_owner(v_business) then
    raise exception 'Convite não encontrado.' using errcode = 'P0001';
  end if;
  update public.team_invites set revoked_at = now()
   where id = p_invite_id and accepted_at is null and revoked_at is null;
end;
$$;

-- ---------------------------------------------------------------------
-- list_team: dono vê nome, e-mail e papel de cada pessoa da equipe
-- ---------------------------------------------------------------------
create or replace function public.list_team(p_business_id uuid)
returns table (member_id uuid, user_id uuid, role public.business_role, full_name text, email text, joined_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_business_owner(p_business_id) then
    raise exception 'Somente o dono da lavanderia vê a equipe.' using errcode = 'P0001';
  end if;
  return query
  select m.id, m.user_id, m.role, p.full_name, u.email::text, m.created_at
  from public.business_members m
  join auth.users u on u.id = m.user_id
  left join public.profiles p on p.id = m.user_id
  where m.business_id = p_business_id
  order by (m.role = 'owner') desc, m.created_at;
end;
$$;

-- ---------------------------------------------------------------------
-- remove_member: dono tira um funcionário (nunca o dono)
-- ---------------------------------------------------------------------
create or replace function public.remove_member(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m public.business_members%rowtype;
begin
  select * into v_m from public.business_members where id = p_member_id;
  if v_m.id is null or not public.is_business_owner(v_m.business_id) then
    raise exception 'Pessoa não encontrada na equipe.' using errcode = 'P0001';
  end if;
  if v_m.role = 'owner' then
    raise exception 'O dono da lavanderia não pode ser removido.' using errcode = 'P0001';
  end if;
  delete from public.business_members where id = p_member_id;
end;
$$;

revoke all on function public.create_invite(uuid, text) from public, anon;
revoke all on function public.accept_invite(text) from public, anon;
revoke all on function public.revoke_invite(uuid) from public, anon;
revoke all on function public.list_team(uuid) from public, anon;
revoke all on function public.remove_member(uuid) from public, anon;
revoke all on function public.get_invite(text) from public;
grant execute on function public.create_invite(uuid, text) to authenticated;
grant execute on function public.accept_invite(text) to authenticated;
grant execute on function public.revoke_invite(uuid) to authenticated;
grant execute on function public.list_team(uuid) to authenticated;
grant execute on function public.remove_member(uuid) to authenticated;
-- o link do convite pode ser aberto antes de entrar na conta
grant execute on function public.get_invite(text) to anon, authenticated;

insert into public.reserved_slugs (slug) values ('convite') on conflict do nothing;

update public.features set status = 'disponivel', route = '/app/equipe' where code = 'equipe';
