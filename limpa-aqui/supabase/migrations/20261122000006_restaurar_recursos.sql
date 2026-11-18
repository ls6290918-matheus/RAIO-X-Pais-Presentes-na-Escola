-- =====================================================================
-- LIMPA AQUI — Onboarding dinâmico, Etapa 3
-- "Restaurar automático": apaga os ajustes manuais de recursos da empresa
-- e recalcula tudo pelas regras (feature_rules). Só o dono.
-- =====================================================================
create or replace function public.reset_business_features(p_business_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Faça login para continuar.' using errcode = '28000';
  end if;
  if not public.is_business_owner(p_business_id) then
    raise exception 'Somente o dono da lavanderia pode alterar a configuração.' using errcode = 'P0001';
  end if;

  delete from public.business_features where business_id = p_business_id and source = 'manual';
  perform public.apply_business_rules(p_business_id);
end;
$$;

revoke all on function public.reset_business_features(uuid) from public, anon;
grant execute on function public.reset_business_features(uuid) to authenticated;
