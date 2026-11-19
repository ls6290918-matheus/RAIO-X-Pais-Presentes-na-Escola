-- =====================================================================
-- LIMPA AQUI — credenciais da SyncPay no Vault do Supabase (criptografadas)
-- A função syncpay usa os segredos da Edge Function quando existem; se não, lê daqui.
-- Só o servidor (service_role) pode chamar. Os valores NUNCA ficam neste arquivo:
--   select vault.create_secret('<valor>', 'SYNCPAY_CLIENT_ID');   (e CLIENT_SECRET, WEBHOOK_SECRET)
-- =====================================================================
create or replace function public.syncpay_config()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if to_regclass('vault.decrypted_secrets') is null then
    return '{}'::jsonb;
  end if;
  return coalesce((
    select jsonb_object_agg(s.name, s.decrypted_secret)
    from vault.decrypted_secrets s
    where s.name in ('SYNCPAY_CLIENT_ID', 'SYNCPAY_CLIENT_SECRET', 'SYNCPAY_WEBHOOK_SECRET')), '{}'::jsonb);
end;
$$;

revoke all on function public.syncpay_config() from public, anon, authenticated;
grant execute on function public.syncpay_config() to service_role;
