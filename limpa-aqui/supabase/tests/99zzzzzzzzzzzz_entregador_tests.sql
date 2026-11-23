-- Etapa 6: entregador online/offline. Roda por último.
\set ON_ERROR_STOP on
\set QUIET on
reset role;
set role authenticated;
-- T166: offline não vê nem aceita corridas livres; online vê; resumo do dia/semana; quem não é entregador não fica online
select set_config('request.jwt.claim.sub', '19191919-0000-0000-0000-000000000019', false);
do $$ declare s jsonb; begin
  perform public.set_courier_online(false);
  assert (select count(*) from public.courier_available_deliveries()) = 0, 'T166 offline não vê';
  begin perform public.accept_delivery(gen_random_uuid()); raise exception 'T166 FALHOU offline aceita';
  exception when invalid_parameter_value then null; end;
  s := public.courier_summary();
  assert (s ->> 'online')::boolean = false, 'T166 resumo offline';
  assert (s ->> 'week_rides')::int >= 1 and (s ->> 'week_earnings')::numeric > 0, 'T166 ganhos da semana: ' || s::text;
  perform public.set_courier_online(true);
  s := public.courier_summary();
  assert (s ->> 'online')::boolean and s ->> 'online_since' is not null, 'T166 online';
end $$;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
do $$ begin
  begin perform public.set_courier_online(true); raise exception 'T166 FALHOU dono online';
  exception when insufficient_privilege then null; end;
  begin perform public.courier_summary(); raise exception 'T166 FALHOU resumo sem perfil';
  exception when insufficient_privilege then null; end;
  raise notice 'T166 OK  entregador online/offline: offline não vê nem aceita corridas livres; resumo de ganhos; só entregador aprovado fica online';
end $$;
reset role;
