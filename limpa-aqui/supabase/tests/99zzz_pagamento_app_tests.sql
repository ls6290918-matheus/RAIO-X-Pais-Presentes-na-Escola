-- Testes do marketplace, Etapa 5b (pagamento pelo app via gateway). Roda depois de 99zz_painel_tests.sql.
\set ON_ERROR_STOP on
\set QUIET on

reset role;
create temporary table t_app (k text primary key, id uuid, n numeric, s text);
grant all on t_app to authenticated, anon, service_role;
insert into t_app (k, id) select k, id from t_log where k in ('biz', 'svc', 'addr');
set role authenticated;

-- T135: interruptor da plataforma, chave Pix e opção do prestador
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
do $$ begin
  assert not public.app_payment_available(), 'T135 começa desligado';
  begin perform public.admin_set_app_payment(true, 1); raise exception 'T135 FALHOU dono ligou a plataforma';
  exception when insufficient_privilege then null; end;
  begin perform public.set_app_payment((select id from t_app where k = 'biz'), true); raise exception 'T135 FALHOU ligou sem a plataforma';
  exception when raise_exception then if sqlerrm like 'T135%' then raise; end if; end;
  begin update public.businesses set accepts_app_payment = true where id = (select id from t_app where k = 'biz'); raise exception 'T135 FALHOU mudou direto';
  exception when raise_exception then if sqlerrm like 'T135%' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub', '14141414-0000-0000-0000-000000000014', false);
select public.admin_set_app_payment(true, 5);
select public.admin_create_commission_rule('app', 10);
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
do $$ begin
  assert public.app_payment_available(), 'T135 ligado';
  begin perform public.set_app_payment((select id from t_app where k = 'biz'), true); raise exception 'T135 FALHOU ligou sem chave Pix';
  exception when raise_exception then if sqlerrm like 'T135%' then raise; end if; end;
  begin perform public.save_payout_account((select id from t_app where k = 'biz'), 'cpf', '123', 'João da Silva'); raise exception 'T135 FALHOU CPF curto';
  exception when others then if sqlerrm like 'T135%' then raise; end if; end;
  begin perform public.save_payout_account((select id from t_app where k = 'biz'), 'email', 'sem-arroba', 'João da Silva'); raise exception 'T135 FALHOU e-mail';
  exception when others then if sqlerrm like 'T135%' then raise; end if; end;
  perform public.save_payout_account((select id from t_app where k = 'biz'), 'cpf', '529.982.247-25', 'João da Silva');
  assert (select pix_key from public.payout_accounts) = '52998224725', 'T135 chave normalizada';
  perform public.set_app_payment((select id from t_app where k = 'biz'), true);
  assert (select accepts_app_payment from public.businesses where id = (select id from t_app where k = 'biz')), 'T135 ligado no prestador';
end $$;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', false);
do $$ begin
  assert (select count(*) from public.payout_accounts) = 0, 'T135 funcionário/outro vê a chave Pix';
  begin perform public.save_payout_account((select id from t_app where k = 'biz'), 'cpf', '52998224725', 'Outro'); raise exception 'T135 FALHOU outro gravou chave';
  exception when insufficient_privilege then null; end;
  raise notice 'T135 OK  admin libera o pagamento pelo app; dono precisa da chave Pix (validada) para ligar; ninguém mais vê ou muda a chave';
end $$;

-- T136: contratar pagando pelo app; pedido não anda antes do pagamento
select set_config('request.jwt.claim.sub', '18181818-0000-0000-0000-000000000018', false);
do $$
declare o uuid; c jsonb;
begin
  o := public.hire_services((select id from t_app where k = 'biz'), jsonb_build_array(jsonb_build_object('service_id', (select id from t_app where k = 'svc'))),
                            (select id from t_app where k = 'addr'), 'sem_logistica', 'app');
  insert into t_app (k, id) values ('order', o);
  assert (select payment_mode = 'app' and not paid and status = 'recebido' from public.my_orders() where id = o), 'T136 pedido pelo app';
  c := public.app_payment_checkout(o);
  assert (c ->> 'amount')::numeric = (select total from public.my_orders() where id = o) and c ->> 'email' = 'bia@teste.com'
         and c ->> 'phone' is not null and c -> 'pending' = 'null'::jsonb, 'T136 checkout: ' || c::text;
  insert into t_app (k, n) values ('amount', (c ->> 'amount')::numeric);
end $$;
select set_config('request.jwt.claim.sub', '17171717-0000-0000-0000-000000000017', false);
do $$ begin
  begin perform public.app_payment_checkout((select id from t_app where k = 'order')); raise exception 'T136 FALHOU outro cliente';
  exception when raise_exception then if sqlerrm like 'T136%' then raise; end if; end;
  begin perform public.app_payment_register((select id from t_app where k = 'order'), '17171717-0000-0000-0000-000000000017', 'x-identifier-1', 'pix', 1);
        raise exception 'T136 FALHOU cliente gravou cobrança';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
do $$ begin
  begin perform public.set_order_status((select id from t_app where k = 'order'), 'em_lavagem'); raise exception 'T136 FALHOU andou sem pagar';
  exception when raise_exception then if sqlerrm like 'T136%' then raise; end if; end;
  begin update public.orders set total = 1 where id = (select id from t_app where k = 'order'); raise exception 'T136 FALHOU mudou o valor';
  exception when raise_exception or insufficient_privilege then if sqlerrm like 'T136%' then raise; end if; end;
  begin perform public.confirm_direct_payment((select id from t_app where k = 'order'), 10, 'pix'); raise exception 'T136 FALHOU confirmou como direto';
  exception when raise_exception then if sqlerrm like 'T136%' then raise; end if; end;
  assert (public.order_finance((select id from t_app where k = 'order')) -> 'app_payment' ->> 'status') = 'aguardando', 'T136 prestador vê aguardando';
  raise notice 'T136 OK  cliente contrata pagando pelo app; checkout só para o dono do pedido; pedido não anda, não muda de valor e não é "confirmado" à mão';
end $$;

-- T137: servidor registra o Pix; reaproveita o pendente; webhook "pago" libera o pedido, a comissão e o repasse
reset role;
set role service_role;
select public.app_payment_register((select id from t_app where k = 'order'), '18181818-0000-0000-0000-000000000018',
                                   'sp-0001-aaaa-bbbb', '00020126pixcopiaecola', (select n from t_app where k = 'amount'));
do $$ begin
  begin perform public.app_payment_register((select id from t_app where k = 'order'), '18181818-0000-0000-0000-000000000018', 'sp-0002-xxxx', 'pix', 1);
        raise exception 'T137 FALHOU valor diferente';
  exception when raise_exception then if sqlerrm like 'T137%' then raise; end if; end;
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub', '18181818-0000-0000-0000-000000000018', false);
do $$ begin
  assert (public.app_payment_checkout((select id from t_app where k = 'order')) -> 'pending' ->> 'identifier') = 'sp-0001-aaaa-bbbb', 'T137 reaproveita o Pix';
  assert (public.app_payment_status_check((select id from t_app where k = 'order')) ->> 'query')::boolean = false, 'T137 sem consulta no 1º minuto';
  begin perform public.cancel_unpaid_app_order((select id from t_app where k = 'order3')); raise exception 'T137 FALHOU cancelou pedido direto';
  exception when raise_exception then if sqlerrm like 'T137%' then raise; end if; end;
end $$;
reset role;
set role service_role;
do $$
declare r jsonb;
begin
  assert (public.app_payment_apply('desconhecido-123', 'completed', 'evt-0') ->> 'result') = 'ignored', 'T137 cobrança desconhecida';
  r := public.app_payment_apply('sp-0001-aaaa-bbbb', 'completed', 'evt-1', (select n from t_app where k = 'amount'),
                                (select n from t_app where k = 'amount') - 0.5, 'E123', now());
  assert r ->> 'result' = 'applied', 'T137 aplicado: ' || r::text;
  assert (public.app_payment_apply('sp-0001-aaaa-bbbb', 'completed', 'evt-1') ->> 'result') = 'duplicate', 'T137 evento repetido';
  assert (public.app_payment_apply('sp-0001-aaaa-bbbb', 'pending', 'evt-2') ->> 'result') = 'ignored', 'T137 não volta para pendente';
end $$;
reset role;
do $$
declare o public.orders;
begin
  select * into o from public.orders where id = (select id from t_app where k = 'order');
  assert o.paid, 'T137 pedido pago';
  assert (select status = 'paga' and commission_amount = round(o.total * 0.10, 2) from public.platform_commissions where order_id = o.id), 'T137 comissão retida';
  assert (select amount from public.payouts where order_id = o.id and payee_type = 'prestador' and status = 'pendente') = o.total - round(o.total * 0.10, 2), 'T137 repasse';
  assert (select string_agg(event, ',' order by id) from public.financial_ledger where order_id = o.id and event like any (array['pagamento_app%', 'taxa_gateway', 'comissao_retida', 'repasse%']))
         = 'pagamento_app_recebido,taxa_gateway,comissao_retida,repasse_previsto', 'T137 livro';
  assert (select amount from public.financial_ledger where order_id = o.id and event = 'taxa_gateway') = 0.5, 'T137 taxa do gateway';
  raise notice 'T137 OK  servidor registra o Pix (valor conferido), reaproveita o pendente; "pago" do gateway quita o pedido, retém a comissão e prevê o repasse; eventos repetidos ignorados';
end $$;

-- T138: prestador vê o pagamento e o repasse; pedido anda; cliente não vê o código do Pix na tabela
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
do $$
declare f jsonb;
begin
  f := public.order_finance((select id from t_app where k = 'order'));
  assert f -> 'app_payment' ->> 'status' = 'completed' and f -> 'payout' ->> 'status' = 'pendente', 'T138 prestador: ' || f::text;
  perform public.set_order_status((select id from t_app where k = 'order'), 'em_lavagem');
  assert (select count(*) from public.my_payouts((select id from t_app where k = 'biz'))) = 1, 'T138 meus repasses';
end $$;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', false);
do $$ begin
  begin perform public.my_payouts((select id from t_app where k = 'biz')); raise exception 'T138 FALHOU outra lavanderia vê repasses';
  exception when insufficient_privilege then null; end;
  begin perform public.order_finance((select id from t_app where k = 'order')); raise exception 'T138 FALHOU outra lavanderia vê o pedido';
  exception when raise_exception then if sqlerrm like 'T138%' then raise; end if; end;
  assert (select count(*) from public.payouts) = 0 and (select count(*) from public.payment_transactions) = 0, 'T138 outra lavanderia vê dinheiro';
end $$;
select set_config('request.jwt.claim.sub', '18181818-0000-0000-0000-000000000018', false);
do $$ begin
  assert (select count(*) from public.payment_transactions) = 1, 'T138 cliente vê a própria cobrança';
  begin perform pix_code from public.payment_transactions; raise exception 'T138 FALHOU leu o código';
  exception when insufficient_privilege then null; end;
  begin perform public.app_payment_checkout((select id from t_app where k = 'order')); raise exception 'T138 FALHOU pagar de novo';
  exception when raise_exception then if sqlerrm like 'T138%' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub', '17171717-0000-0000-0000-000000000017', false);
do $$ begin
  assert (select count(*) from public.payment_transactions) = 0 and (select count(*) from public.payouts) = 0, 'T138 outro cliente';
  raise notice 'T138 OK  prestador vê pagamento e repasse (outra lavanderia não vê nada); pedido pago anda; cliente não lê o código nem paga duas vezes';
end $$;

-- T139: com entregador, a coleta só aparece depois do pagamento; corrida concluída gera repasse ao entregador
select set_config('request.jwt.claim.sub', '14141414-0000-0000-0000-000000000014', false);
select public.admin_upsert_delivery_zone(3303302, 8, 1.5, 10, 1.3, 30, true);
select set_config('request.jwt.claim.sub', '18181818-0000-0000-0000-000000000018', false);
do $$
declare o uuid; c jsonb;
begin
  o := public.hire_services((select id from t_app where k = 'biz'), jsonb_build_array(jsonb_build_object('service_id', (select id from t_app where k = 'svc'))),
                            (select id from t_app where k = 'addr'), 'entregador', 'app');
  insert into t_app (k, id) values ('order_log', o);
  assert (select count(*) from public.order_deliveries(o)) = 0, 'T139 sem coleta antes de pagar';
  c := public.app_payment_checkout(o);
  assert (c ->> 'amount')::numeric = (select total + delivery_fee_total from public.my_orders() where id = o), 'T139 cobra serviço + entregas';
  insert into t_app (k, n) values ('amount_log', (c ->> 'amount')::numeric);
end $$;
reset role;
set role service_role;
select public.app_payment_register((select id from t_app where k = 'order_log'), '18181818-0000-0000-0000-000000000018', 'sp-0003-log', 'pix3', (select n from t_app where k = 'amount_log'));
select public.app_payment_apply('sp-0003-log', 'completed', 'evt-3', (select n from t_app where k = 'amount_log'));
set role authenticated;
select set_config('request.jwt.claim.sub', '19191919-0000-0000-0000-000000000019', false);
do $$
declare d uuid;
begin
  select id into d from public.courier_available_deliveries() where leg = 'pickup';
  assert d is not null, 'T139 coleta liberada após pagamento';
  perform public.accept_delivery(d);
  perform public.advance_delivery(d, 'coletada');
  perform public.advance_delivery(d, 'entregue');
  assert (select count(*) from public.my_payouts() where status = 'pendente') = 1, 'T139 entregador vê o repasse';
  assert (select count(*) from public.payouts) = 1, 'T139 entregador só vê o próprio';
  raise notice 'T139 OK  com entregador, a coleta só é chamada depois do pagamento; corrida concluída gera repasse ao entregador';
end $$;

-- T140: admin paga repasses; transições validadas
select set_config('request.jwt.claim.sub', '14141414-0000-0000-0000-000000000014', false);
do $$
declare p uuid;
begin
  assert (select count(*) from public.admin_list_payouts('pendente')) = 3, 'T140 três repasses pendentes';
  assert (select pix_key from public.admin_list_payouts('pendente') where payee_type = 'prestador' limit 1) = '52998224725', 'T140 admin vê a chave';
  select id into p from public.admin_list_payouts('pendente') where payee_type = 'entregador';
  perform public.admin_set_payout_status(p, 'pago', 'Pix E2E-ABC');
  begin perform public.admin_set_payout_status(p, 'pendente'); raise exception 'T140 FALHOU voltou de pago';
  exception when raise_exception then if sqlerrm like 'T140%' then raise; end if; end;
  assert (select status = 'pago' and reference = 'Pix E2E-ABC' from public.admin_list_payouts() where id = p), 'T140 pago';
  assert jsonb_array_length(public.admin_reconciliation() -> 'payouts_by_payee') = 1, 'T140 conciliação de repasses';
end $$;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
do $$ begin
  begin perform public.admin_set_payout_status((select id from public.payouts limit 1), 'pago'); raise exception 'T140 FALHOU dono pagou';
  exception when insufficient_privilege then null; end;
  begin perform public.admin_list_payouts(); raise exception 'T140 FALHOU dono lista';
  exception when insufficient_privilege then null; end;
  raise notice 'T140 OK  admin vê repasses com a chave Pix, marca como pago com referência; ninguém mais mexe';
end $$;

-- T141: contestação (MED) bloqueia repasses; resolvida, libera; estorno cancela pedido e repasses
reset role;
set role service_role;
select public.app_payment_apply('sp-0003-log', 'med', 'evt-4');
reset role;
do $$ begin
  assert (select count(*) from public.payouts where order_id = (select id from t_app where k = 'order_log') and status = 'bloqueado') = 1, 'T141 MED bloqueia o repasse do prestador (o do entregador já foi pago)';
  assert (select status from public.payment_transactions where identifier = 'sp-0003-log') = 'med', 'T141 med';
end $$;
set role service_role;
select public.app_payment_apply('sp-0001-aaaa-bbbb', 'med', 'evt-5');
reset role;
do $$ begin
  assert (select status from public.payouts where order_id = (select id from t_app where k = 'order') and payee_type = 'prestador') = 'bloqueado', 'T141 bloqueado';
end $$;
set role service_role;
select public.app_payment_apply('sp-0001-aaaa-bbbb', 'completed', 'evt-6');
reset role;
do $$ begin
  assert (select status from public.payouts where order_id = (select id from t_app where k = 'order') and payee_type = 'prestador') = 'pendente', 'T141 liberado';
  assert (select paid from public.orders where id = (select id from t_app where k = 'order')), 'T141 continua pago';
end $$;
set role service_role;
select public.app_payment_apply('sp-0001-aaaa-bbbb', 'refunded', 'evt-7');
select public.app_payment_apply('sp-0003-log', 'refunded', 'evt-8');
reset role;
do $$ begin
  assert (select not paid and status = 'cancelado' from public.orders where id = (select id from t_app where k = 'order')), 'T141 pedido cancelado após estorno';
  assert (select status from public.payouts where order_id = (select id from t_app where k = 'order') and payee_type = 'prestador') = 'cancelado', 'T141 repasse cancelado';
  assert (select status from public.platform_commissions where order_id = (select id from t_app where k = 'order')) = 'cancelada', 'T141 comissão cancelada';
  assert exists (select 1 from public.financial_ledger where order_id = (select id from t_app where k = 'order_log') and event = 'repasse_a_recuperar'), 'T141 repasse pago a recuperar';
  assert (select count(*) from public.financial_ledger where event = 'pagamento_app_estornado') = 2, 'T141 livro do estorno';
  raise notice 'T141 OK  MED bloqueia o repasse e libera se resolvido; estorno cancela pedido, comissão e repasses pendentes; repasse já pago fica "a recuperar"';
end $$;

-- T142: pagamento de pedido cancelado, duplicidade e cancelamento depois de pago viram "a devolver"
set role authenticated;
select set_config('request.jwt.claim.sub', '18181818-0000-0000-0000-000000000018', false);
do $$
declare o uuid;
begin
  o := public.hire_services((select id from t_app where k = 'biz'), jsonb_build_array(jsonb_build_object('service_id', (select id from t_app where k = 'svc'))),
                            (select id from t_app where k = 'addr'), 'sem_logistica', 'app');
  insert into t_app (k, id, n) values ('order_c', o, (public.app_payment_checkout(o) ->> 'amount')::numeric);
  o := public.hire_services((select id from t_app where k = 'biz'), jsonb_build_array(jsonb_build_object('service_id', (select id from t_app where k = 'svc'))),
                            (select id from t_app where k = 'addr'), 'sem_logistica', 'app');
  insert into t_app (k, id, n) values ('order_d', o, (public.app_payment_checkout(o) ->> 'amount')::numeric);
end $$;
reset role;
set role service_role;
select public.app_payment_register((select id from t_app where k = 'order_c'), '18181818-0000-0000-0000-000000000018', 'sp-0010-c', 'pix', (select n from t_app where k = 'order_c'));
select public.app_payment_register((select id from t_app where k = 'order_d'), '18181818-0000-0000-0000-000000000018', 'sp-0011-d1', 'pix', (select n from t_app where k = 'order_d'));
select public.app_payment_register((select id from t_app where k = 'order_d'), '18181818-0000-0000-0000-000000000018', 'sp-0012-d2', 'pix', (select n from t_app where k = 'order_d'));
set role authenticated;
select set_config('request.jwt.claim.sub', '18181818-0000-0000-0000-000000000018', false);
select public.cancel_unpaid_app_order((select id from t_app where k = 'order_c'));
reset role;
set role service_role;
select public.app_payment_apply('sp-0010-c', 'completed', 'evt-10');
select public.app_payment_apply('sp-0011-d1', 'completed', 'evt-11');
select public.app_payment_apply('sp-0012-d2', 'completed', 'evt-12');
select public.app_payment_apply('sp-0011-d1', 'failed', 'evt-13');
reset role;
do $$ begin
  assert (select needs_refund and not applied from public.payment_transactions where identifier = 'sp-0010-c'), 'T142 pedido cancelado';
  assert (select applied and not needs_refund and status = 'completed' from public.payment_transactions where identifier = 'sp-0011-d1'), 'T142 primeiro paga (failed depois ignorado)';
  assert (select needs_refund from public.payment_transactions where identifier = 'sp-0012-d2'), 'T142 duplicidade';
  assert (select count(*) from public.payouts where order_id = (select id from t_app where k = 'order_d') and status = 'pendente') = 1, 'T142 um repasse só';
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
select public.set_order_status((select id from t_app where k = 'order_d'), 'cancelado');
reset role;
do $$ begin
  assert (select needs_refund from public.payment_transactions where identifier = 'sp-0011-d1'), 'T142 cancelado depois de pago';
  assert (select status from public.payouts where order_id = (select id from t_app where k = 'order_d')) = 'cancelado', 'T142 repasse cancelado';
  raise notice 'T142 OK  Pix pago de pedido cancelado, em duplicidade ou de pedido cancelado depois viram "a devolver"; um repasse por pedido';
end $$;

-- T143: estorno pelo admin, painel e resumo separados por modalidade
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
do $$ begin
  begin perform public.app_payment_refund_prepare((select id from public.payment_transactions limit 1)); raise exception 'T143 FALHOU dono estorna';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub', '14141414-0000-0000-0000-000000000014', false);
do $$
declare d jsonb; app jsonb; tid uuid;
begin
  select id into tid from public.admin_app_transactions(true) where needs_refund and status = 'completed' limit 1;
  assert (public.app_payment_refund_prepare(tid) ->> 'identifier') is not null, 'T143 preparar estorno';
  insert into t_app (k, id) values ('refund_tx', tid);
  assert (select count(*) from public.admin_app_transactions(true) where needs_refund) = 3, 'T143 três a devolver';
  assert jsonb_array_length(public.admin_reconciliation() -> 'app_to_refund') = 3, 'T143 conciliação';
  d := public.admin_dashboard(current_date - 30, current_date + 1);
  select x into app from jsonb_array_elements(d -> 'by_mode') x where x ->> 'mode' = 'app';
  assert (app ->> 'canceled')::int = 4 and (d -> 'app_payments' ->> 'enabled')::boolean and (d -> 'app_payments' ->> 'to_refund')::int = 3
         and (d -> 'app_payments' ->> 'gateway_fees')::numeric = 0.5 and (d -> 'app_payments' ->> 'refunded')::numeric > 0, 'T143 painel: ' || (d -> 'app_payments')::text;
  assert (select confirmed_orders from public.admin_finance_summary() where payment_mode = 'app') = 0, 'T143 resumo (estornados/cancelados não contam)';
  assert (select confirmed_total from public.admin_finance_summary() where payment_mode = 'direto') = 90, 'T143 direto intacto';
end $$;
reset role;
set role service_role;
select public.app_payment_refund_mark((select id from t_app where k = 'refund_tx'), 'rfd_abc123', 'duplicate_charge', '14141414-0000-0000-0000-000000000014');
set role authenticated;
select set_config('request.jwt.claim.sub', '14141414-0000-0000-0000-000000000014', false);
do $$ begin
  begin perform public.app_payment_refund_prepare((select id from t_app where k = 'refund_tx')); raise exception 'T143 FALHOU estorno duplo';
  exception when raise_exception then if sqlerrm like 'T143%' then raise; end if; end;
  raise notice 'T143 OK  só o admin pede estorno (uma vez); painel e resumo mostram o app separado do direto, com taxas, estornos e devoluções';
end $$;

-- T144: desligar a plataforma bloqueia novas contratações pelo app; visitante; RLS
select public.admin_set_app_payment(false);
select set_config('request.jwt.claim.sub', '18181818-0000-0000-0000-000000000018', false);
do $$ begin
  begin perform public.hire_services((select id from t_app where k = 'biz'), jsonb_build_array(jsonb_build_object('service_id', (select id from t_app where k = 'svc'))),
                                     (select id from t_app where k = 'addr'), 'sem_logistica', 'app'); raise exception 'T144 FALHOU contratou com app desligado';
  exception when raise_exception then if sqlerrm like 'T144%' then raise; end if; end;
end $$;
reset role;
set role anon;
do $$ begin
  assert not public.app_payment_available(), 'T144 visitante vê se está disponível';
  begin perform count(*) from public.payment_transactions; raise exception 'T144 FALHOU anon cobranças';
  exception when insufficient_privilege then null; end;
  begin perform public.app_payment_apply('sp-0001-aaaa-bbbb', 'refunded'); raise exception 'T144 FALHOU anon aplicou status';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set role authenticated;
do $$ begin
  begin perform public.app_payment_apply('sp-0001-aaaa-bbbb', 'refunded'); raise exception 'T144 FALHOU logado aplicou status';
  exception when insufficient_privilege then null; end;
  begin perform count(*) from public.payment_webhook_events; raise exception 'T144 FALHOU eventos';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  assert not exists (select 1 from public.tables_without_rls() where table_name not in ('t_tok', 't_ids', 't_pay', 't_log', 't_app')), 'T144 RLS';
  raise notice 'T144 OK  plataforma desligada bloqueia novas contratações pelo app; visitante e cliente não aplicam status; RLS em todas as tabelas';
end $$;
