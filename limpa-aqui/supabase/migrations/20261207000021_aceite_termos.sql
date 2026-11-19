-- =====================================================================
-- LIMPA AQUI — aceite dos Termos de Uso e da Política de Privacidade
--  * profiles.terms_version / terms_accepted_at: qual versão a pessoa aceitou e quando
--  * no cadastro, o aceite vem nos metadados da conta (marcado na tela de cadastro)
--  * quem já tinha conta aceita pela RPC accept_terms (ao entrar, uma vez por versão)
-- =====================================================================

alter table public.profiles
  add column if not exists terms_version     text check (terms_version is null or char_length(terms_version) <= 20),
  add column if not exists terms_accepted_at timestamptz;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_terms text := nullif(trim(coalesce(new.raw_user_meta_data ->> 'terms_version', '')), '');
begin
  insert into public.profiles (id, full_name, terms_version, terms_accepted_at)
  values (
    new.id,
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
    left(v_terms, 20),
    case when v_terms is not null then now() end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function public.accept_terms(p_version text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Faça login para continuar.' using errcode = '28000';
  end if;
  if p_version is null or char_length(trim(p_version)) not between 1 and 20 then
    raise exception 'Versão inválida.' using errcode = '22023';
  end if;
  update public.profiles set terms_version = trim(p_version), terms_accepted_at = now() where id = auth.uid();
end;
$$;

revoke all on function public.accept_terms(text) from public, anon;
grant execute on function public.accept_terms(text) to authenticated;
