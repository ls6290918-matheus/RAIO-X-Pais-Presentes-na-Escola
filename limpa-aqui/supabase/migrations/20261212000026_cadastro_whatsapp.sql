-- =====================================================================
-- LIMPA AQUI — cadastro em passos: o WhatsApp informado no cadastro vai para o perfil
-- (sem validação por SMS: não há provedor configurado; o número fica como informado).
-- Só aceita 10 ou 11 dígitos; qualquer outra coisa é ignorada (não impede criar a conta).
-- =====================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_terms text := nullif(trim(coalesce(new.raw_user_meta_data ->> 'terms_version', '')), '');
  v_phone text := regexp_replace(coalesce(new.raw_user_meta_data ->> 'phone', ''), '\D', '', 'g');
begin
  insert into public.profiles (id, full_name, phone, terms_version, terms_accepted_at)
  values (
    new.id,
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
    case when char_length(v_phone) between 10 and 11 then v_phone end,
    left(v_terms, 20),
    case when v_terms is not null then now() end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
