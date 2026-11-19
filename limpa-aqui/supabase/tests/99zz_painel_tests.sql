-- Testes do marketplace, Etapa 7 (painel administrativo). Roda depois de 99z_logistica_tests.sql.
\set ON_ERROR_STOP on
\set QUIET on

reset role;
set role authenticated;

-- T131: só o admin vê o painel; período validado
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
do $$ begin
  begin perform public.admin_dashboard(current_date - 30, current_date); raise exception 'T131 FALHOU dono';
  exception when insufficient_privilege then null; end;
  begin perform public.admin_reconciliation(); raise exception 'T131 FALHOU dono conciliação';
  exception when insufficient_privilege then null; end;
  begin perform public.admin_ledger(current_date - 30, current_date); raise exception 'T131 FALHOU dono livro';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub', '14141414-0000-0000-0000-000000000014', false);
do $$ begin
  begin perform public.admin_dashboard(current_date, current_date - 1); raise exception 'T131 FALHOU período invertido';
  exception when others then if sqlerrm like 'T131%' then raise; end if; end;
  raise notice 'T131 OK  painel, conciliação e livro só para o admin; período validado';
end $$;

-- T132: indicadores do PRD separados por modalidade, logística e cobertura
do $$
declare d jsonb; dir jsonb; app jsonb;
begin
  d := public.admin_dashboard(current_date - 30, current_date + 1);
  select x into dir from jsonb_array_elements(d -> 'by_mode') x where x ->> 'mode' = 'direto';
  select x into app from jsonb_array_elements(d -> 'by_mode') x where x ->> 'mode' = 'app';
  assert (dir ->> 'orders')::int >= 5 and (dir ->> 'paid_total')::numeric = 90 and (dir ->> 'paid_orders')::int = 1, 'T132 direto: ' || dir::text;
  assert (app ->> 'orders')::int = 0 and (app ->> 'paid_total')::numeric = 0, 'T132 app separado';
  assert (d -> 'commissions' ->> 'paid')::numeric = 9, 'T132 comissão paga';
  assert (d -> 'logistics' ->> 'rides_done')::int = 2 and (d -> 'logistics' ->> 'orders_with_courier')::int >= 1, 'T132 corridas: ' || (d -> 'logistics')::text;
  assert (d -> 'logistics' ->> 'couriers_approved')::int = 4, 'T132 entregadores (3 desta etapa + 1 da Etapa 1)';
  assert (d -> 'coverage' ->> 'registered')::int = 92 and (d -> 'coverage' ->> 'with_logistics')::int = 1, 'T132 cobertura (Rio: tarifa ativa + Rui aprovado): ' || (d -> 'coverage')::text;
  assert (d -> 'coverage' ->> 'active_without_logistics')::int >= 1, 'T132 ativos sem logística';
  assert (d -> 'marketplace' ->> 'orders_from_profile')::int >= 5 and (d -> 'marketplace' ->> 'orders_from_listing') is not null, 'T132 origem';
  assert (public.admin_dashboard(current_date - 400, current_date - 365) -> 'logistics' ->> 'rides_done')::int = 0, 'T132 período vazio';
  raise notice 'T132 OK  indicadores do PRD: pedidos e valores por modalidade, comissões, corridas, entregadores, cobertura e origem';
end $$;

-- T133: conciliação e repasses
do $$
declare r jsonb;
begin
  r := public.admin_reconciliation();
  assert exists (select 1 from jsonb_array_elements(r -> 'unconfirmed_direct') x where (x ->> 'status') = 'entregue'), 'T133 pedido entregue sem confirmação';
  assert not exists (select 1 from jsonb_array_elements(r -> 'unconfirmed_direct') x where (x ->> 'id')::uuid = (select id from t_pay where k = 'order')), 'T133 confirmado não aparece';
  assert (select string_agg(full_name || ':' || rides, ',' order by full_name) from public.admin_courier_report(current_date - 30, current_date + 1)) = 'Edu Moto:1,Iva Bike:1', 'T133 repasses';
  assert (select count(*) from public.admin_ledger(current_date - 30, current_date + 1, 'corrida_concluida')) = 2, 'T133 livro filtrado';
  assert (select business_name from public.admin_ledger(current_date - 30, current_date + 1, 'pagamento_direto_confirmado') limit 1) like 'Lavanderia do João%', 'T133 livro com nomes';
  raise notice 'T133 OK  conciliação mostra pagamento direto não confirmado; corridas por entregador; livro-razão filtrável com nomes';
end $$;

reset role;
set role anon;
do $$ begin
  begin perform public.admin_dashboard(current_date - 30, current_date); raise exception 'T134 FALHOU anon';
  exception when insufficient_privilege then null; end;
  raise notice 'T134 OK  visitante não acessa o painel';
end $$;
reset role;
