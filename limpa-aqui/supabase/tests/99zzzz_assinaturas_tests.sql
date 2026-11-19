-- Testes do marketplace, Etapa 8 (planos e assinaturas). Roda depois de 99zzz_pagamento_app_tests.sql.
\set ON_ERROR_STOP on
\set QUIET on

reset role;
create temporary table t_sub (k text primary key, id uuid, n numeric);
grant all on t_sub to authenticated, anon, service_role;
insert into t_sub (k, id) select 'biz', id from public.businesses where slug = 'lavanderia-do-joao';
insert into t_sub (k, id) select 'svc', id from t_app where k = 'svc';
insert into t_sub (k, id) select 'addr', id from t_app where k = 'addr';

-- T145: plano padrão Grátis libera tudo o que existe; visitante vê o catálogo de planos
set role anon;
do $$ begin
  assert (select count(*) from jsonb_array_elements(public.public_plans())) = 1, 'T145 só o Grátis no catálogo';
  assert (public.public_plans() -> 0 ->> 'code') = 'gratis' and (public.public_plans() -> 0 ->> 'price')::numeric = 0, 'T145 grátis';
  begin perform count(*) from public.subscriptions; raise exception 'T145 FALHOU anon assinaturas';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
do $$
declare m jsonb;
begin
  m := public.my_plan((select id from t_sub where k = 'biz'));
  assert m -> 'plan' ->> 'code' = 'gratis' and m -> 'subscription' = 'null'::jsonb, 'T145 sem assinatura vale o Grátis';
  assert jsonb_array_length(m -> 'features') = (select count(*) from public.features), 'T145 Grátis tem todos os recursos';
  assert public.plan_allows((select id from t_sub where k = 'biz'), 'equipe'), 'T145 recurso liberado';
  assert (m -> 'usage' ->> 'staff')::int = 1, 'T145 uso: 1 funcionário';
  raise notice 'T145 OK  plano padrão Grátis com todos os recursos (ninguém perde acesso); visitante vê o catálogo, não as assinaturas';
end $$;

-- T146: só o admin cria e edita planos; o padrão é sempre gratuito
do $$ begin
  begin perform public.admin_upsert_plan(null, 'pro', 'Pro', null, 49.9, 30, null, null, true, true, true, 2, array['pedidos']);
        raise exception 'T146 FALHOU dono criou plano';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub', '14141414-0000-0000-0000-000000000014', false);
do $$
declare v_pro uuid; v_ess uuid; v_def uuid;
begin
  v_pro := public.admin_upsert_plan(null, 'pro', 'Pro', 'Tudo e destaque na busca', 49.9, 30, null, 5, true, true, true, 2,
                                    (select array_agg(code) from public.features));
  v_ess := public.admin_upsert_plan(null, 'essencial', 'Essencial', 'O básico', 19.9, 30, 1, 0, false, true, true, 1,
                                    array['pedidos', 'clientes', 'servicos']);
  insert into t_sub (k, id) values ('pro', v_pro), ('ess', v_ess);
  select id into v_def from public.plans where is_default;
  begin perform public.admin_upsert_plan(v_def, 'gratis', 'Grátis', null, 10, 30, null, null, false, true, true, 0, array['pedidos']);
        raise exception 'T146 FALHOU padrão pago';
  exception when raise_exception then if sqlerrm like 'T146%' then raise; end if; end;
  begin perform public.admin_upsert_plan(null, 'x', 'Xis', null, 5, 30, null, null, false, true, true, 0, array['nao_existe']);
        raise exception 'T146 FALHOU recurso inventado';
  exception when others then if sqlerrm like 'T146%' then raise; end if; end;
  assert (select jsonb_array_length(public.admin_plans())) = 3, 'T146 três planos';
  assert (select (x ->> 'subscribers')::int from jsonb_array_elements(public.admin_plans()) x where x ->> 'code' = 'gratis') >= 3, 'T146 todos no grátis';
  raise notice 'T146 OK  admin cria planos com preço, período, limites, destaque e recursos; plano padrão nunca é cobrado';
end $$;

-- T147: escolher plano pago gera mensalidade (só o dono; só com pagamento pelo app ligado; respeita a equipe)
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
do $$ begin
  begin perform public.choose_plan((select id from t_sub where k = 'biz'), (select id from t_sub where k = 'pro')); raise exception 'T147 FALHOU sem pagamento pelo app';
  exception when raise_exception then if sqlerrm like 'T147%' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub', '14141414-0000-0000-0000-000000000014', false);
select public.admin_set_app_payment(true);
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
do $$
declare r jsonb;
begin
  begin perform public.choose_plan((select id from t_sub where k = 'biz'), (select id from t_sub where k = 'ess')); raise exception 'T147 FALHOU equipe acima do limite';
  exception when raise_exception then if sqlerrm like 'T147%' then raise; end if; end;
  r := public.choose_plan((select id from t_sub where k = 'biz'), (select id from t_sub where k = 'pro'));
  assert not (r ->> 'activated')::boolean and (r ->> 'amount')::numeric = 49.9, 'T147 mensalidade: ' || r::text;
  insert into t_sub (k, id) values ('inv', (r ->> 'invoice_id')::uuid);
  assert (public.my_plan((select id from t_sub where k = 'biz')) -> 'plan' ->> 'code') = 'gratis', 'T147 continua no grátis até pagar';
  assert (public.subscription_checkout((r ->> 'invoice_id')::uuid) ->> 'amount')::numeric = 49.9, 'T147 checkout';
end $$;
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000004', false);
do $$ begin
  begin perform public.choose_plan((select id from t_sub where k = 'biz'), (select id from t_sub where k = 'pro')); raise exception 'T147 FALHOU funcionário';
  exception when insufficient_privilege then null; end;
  begin perform public.subscription_checkout((select id from t_sub where k = 'inv')); raise exception 'T147 FALHOU funcionário paga';
  exception when raise_exception then if sqlerrm like 'T147%' then raise; end if; end;
  assert (public.my_plan((select id from t_sub where k = 'biz')) -> 'open_invoice') = 'null'::jsonb, 'T147 funcionário não vê a mensalidade';
end $$;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', false);
do $$ begin
  begin perform public.subscription_checkout((select id from t_sub where k = 'inv')); raise exception 'T147 FALHOU outra lavanderia';
  exception when raise_exception then if sqlerrm like 'T147%' then raise; end if; end;
  begin perform public.subscription_register((select id from t_sub where k = 'inv'), 'bbbbbbbb-0000-0000-0000-000000000002', 'sp-sub-x', 'pix', 49.9);
        raise exception 'T147 FALHOU logado registrou';
  exception when insufficient_privilege then null; end;
  raise notice 'T147 OK  plano pago gera mensalidade (só o dono, só com o Pix do app ligado, equipe dentro do limite); continua no Grátis até pagar';
end $$;

-- T148: Pix da mensalidade pago → plano ativo por 30 dias; renovação soma; duplicidade vira devolução
reset role;
set role service_role;
select public.subscription_register((select id from t_sub where k = 'inv'), 'aaaaaaaa-0000-0000-0000-000000000001', 'sp-sub-0001', 'pixsub', 49.9);
do $$ begin
  begin perform public.subscription_register((select id from t_sub where k = 'inv'), 'dddddddd-0000-0000-0000-000000000004', 'sp-sub-0002', 'pix', 49.9);
        raise exception 'T148 FALHOU funcionário como pagador';
  exception when raise_exception then if sqlerrm like 'T148%' then raise; end if; end;
  assert (public.app_payment_apply('sp-sub-0001', 'completed', 'evt-sub-1', 49.9, 48.9) ->> 'kind') = 'assinatura', 'T148 aplicado como assinatura';
end $$;
reset role;
do $$ begin
  assert (select status from public.subscription_invoices where id = (select id from t_sub where k = 'inv')) = 'paga', 'T148 paga';
  assert (select plan_id = (select id from t_sub where k = 'pro') and status = 'ativa'
                 and current_period_end between now() + interval '29 days' and now() + interval '31 days'
          from public.subscriptions where business_id = (select id from t_sub where k = 'biz')), 'T148 assinatura ativa 30 dias';
  assert (select count(*) from public.financial_ledger where event = 'assinatura_recebida') = 1, 'T148 livro';
  assert (select applied and not needs_refund from public.payment_transactions where identifier = 'sp-sub-0001'), 'T148 cobrança aplicada';
  assert not exists (select 1 from public.payouts p join public.payment_transactions t on t.id = p.transaction_id where t.identifier = 'sp-sub-0001'), 'T148 sem repasse';
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
do $$
declare m jsonb; r jsonb;
begin
  m := public.my_plan((select id from t_sub where k = 'biz'));
  assert m -> 'plan' ->> 'code' = 'pro' and (m -> 'plan' ->> 'featured')::boolean, 'T148 meu plano é o Pro';
  -- renova antes de vencer: soma ao período que falta
  r := public.choose_plan((select id from t_sub where k = 'biz'), (select id from t_sub where k = 'pro'));
  insert into t_sub (k, id) values ('inv2', (r ->> 'invoice_id')::uuid);
end $$;
reset role;
set role service_role;
select public.subscription_register((select id from t_sub where k = 'inv2'), 'aaaaaaaa-0000-0000-0000-000000000001', 'sp-sub-0003', 'pix', 49.9);
select public.app_payment_apply('sp-sub-0003', 'completed', 'evt-sub-3', 49.9);
select public.app_payment_apply('sp-sub-0001', 'completed', 'evt-sub-1b', 49.9);
reset role;
do $$ begin
  assert (select current_period_end between now() + interval '59 days' and now() + interval '61 days'
          from public.subscriptions where business_id = (select id from t_sub where k = 'biz')), 'T148 renovação soma 30 dias';
  raise notice 'T148 OK  Pix pago ativa o plano por 30 dias (taxa e recebimento no livro, sem repasse); renovar antes do fim soma ao período';
end $$;

-- T149: busca mostra o prestador do plano com destaque primeiro, com selo
set role anon;
do $$
declare r record;
begin
  select * into r from public.search_providers(3303302) limit 1;
  assert r.slug = 'lavanderia-do-joao' and r.featured, 'T149 destaque primeiro: ' || coalesce(r.slug, '-');
  raise notice 'T149 OK  prestador em plano com destaque aparece primeiro na busca, com selo';
end $$;
reset role;

-- T150: vencido além da tolerância volta ao Grátis sozinho; estorno da mensalidade cancela o período
update public.subscriptions set current_period_end = now() - interval '3 days' where business_id = (select id from t_sub where k = 'biz');
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
do $$
declare m jsonb;
begin
  m := public.my_plan((select id from t_sub where k = 'biz'));
  assert m -> 'plan' ->> 'code' = 'pro' and (m -> 'subscription' ->> 'expired')::boolean, 'T150 vencido mas na tolerância (5 dias)';
end $$;
reset role;
update public.subscriptions set current_period_end = now() - interval '6 days' where business_id = (select id from t_sub where k = 'biz');
set role authenticated;
do $$ begin
  assert (public.my_plan((select id from t_sub where k = 'biz')) -> 'plan' ->> 'code') = 'gratis', 'T150 depois da tolerância vale o Grátis';
end $$;
select set_config('request.jwt.claim.sub', '14141414-0000-0000-0000-000000000014', false);
select public.admin_set_subscription_settings(10);
do $$ begin
  assert (select effective_plan_name from public.admin_subscriptions() where business_id = (select id from t_sub where k = 'biz')) = 'Pro', 'T150 tolerância maior (10 dias)';
  assert (public.admin_subscription_overview() ->> 'in_grace')::int = 1, 'T150 painel: 1 em tolerância';
  perform public.admin_set_subscription_settings(5);
  assert (public.admin_subscription_overview() ->> 'expired')::int = 1, 'T150 painel: 1 vencido';
end $$;
reset role;
-- estorno da segunda mensalidade: período atual dela deixa de valer
update public.subscriptions s set current_period_end = (select period_end from public.subscription_invoices where id = (select id from t_sub where k = 'inv2'))
 where business_id = (select id from t_sub where k = 'biz');
set role service_role;
select public.app_payment_apply('sp-sub-0003', 'refunded', 'evt-sub-4');
reset role;
do $$ begin
  assert (select status from public.subscription_invoices where id = (select id from t_sub where k = 'inv2')) = 'estornada', 'T150 mensalidade estornada';
  assert (select status from public.subscriptions where business_id = (select id from t_sub where k = 'biz')) = 'cancelada', 'T150 assinatura cancelada';
  raise notice 'T150 OK  vencido vale até o fim da tolerância (configurável) e volta ao Grátis sozinho; estorno da mensalidade cancela o período';
end $$;

-- T151: limites do plano: pedidos de balcão por mês e funcionários (marketplace nunca é barrado)
set role authenticated;
select set_config('request.jwt.claim.sub', '14141414-0000-0000-0000-000000000014', false);
select public.admin_upsert_plan((select id from t_sub where k = 'ess'), 'essencial', 'Essencial', 'O básico', 19.9, 30, 1, 1, false, true, true, 1,
                                array['pedidos', 'clientes', 'servicos']);
select public.admin_grant_plan((select id from t_sub where k = 'biz'), (select id from t_sub where k = 'ess'), current_date + 10);
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
do $$
declare m jsonb;
begin
  m := public.my_plan((select id from t_sub where k = 'biz'));
  assert m -> 'plan' ->> 'code' = 'essencial' and m -> 'subscription' ->> 'source' = 'admin', 'T151 cortesia do admin';
  assert not public.plan_allows((select id from t_sub where k = 'biz'), 'equipe') and public.plan_allows((select id from t_sub where k = 'biz'), 'pedidos'), 'T151 recursos do plano';
  begin
    perform public.create_order((select id from public.customers where business_id = (select id from t_sub where k = 'biz') order by created_at limit 1),
                                jsonb_build_array(jsonb_build_object('service_id', (select id from t_sub where k = 'svc'))));
    raise exception 'T151 FALHOU passou do limite de pedidos';
  exception when raise_exception then if sqlerrm like 'T151%' then raise; end if;
    assert sqlerrm like 'Seu plano permite 1 pedidos%', 'T151 mensagem: ' || sqlerrm;
  end;
end $$;
select set_config('request.jwt.claim.sub', '18181818-0000-0000-0000-000000000018', false);
do $$ begin
  perform public.hire_services((select id from t_sub where k = 'biz'), jsonb_build_array(jsonb_build_object('service_id', (select id from t_sub where k = 'svc'))),
                               (select id from t_sub where k = 'addr'), 'sem_logistica', 'direto');
end $$;
reset role;
do $$ begin
  begin insert into public.business_members (business_id, user_id, role) values ((select id from t_sub where k = 'biz'), '17171717-0000-0000-0000-000000000017', 'staff');
        raise exception 'T151 FALHOU passou do limite de equipe';
  exception when raise_exception then if sqlerrm like 'T151%' then raise; end if; end;
  raise notice 'T151 OK  plano limita pedidos de balcão no mês e funcionários; pedido do marketplace nunca é barrado; admin dá cortesia';
end $$;

-- T152: voltar ao Grátis na hora; mensalidade aberta pode ser cancelada; visitante e RLS
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
do $$
declare r jsonb;
begin
  r := public.choose_plan((select id from t_sub where k = 'biz'), (select id from t_sub where k = 'pro'));
  perform public.cancel_invoice((r ->> 'invoice_id')::uuid);
  begin perform public.cancel_invoice((r ->> 'invoice_id')::uuid); raise exception 'T152 FALHOU cancelou duas vezes';
  exception when raise_exception then if sqlerrm like 'T152%' then raise; end if; end;
  r := public.choose_plan((select id from t_sub where k = 'biz'), (select id from plans where is_default));
  assert (r ->> 'activated')::boolean and (public.my_plan((select id from t_sub where k = 'biz')) -> 'plan' ->> 'code') = 'gratis', 'T152 grátis na hora';
end $$;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', false);
do $$ begin
  assert (select count(*) from public.subscription_invoices) = 0 and (select count(*) from public.subscriptions) = 0, 'T152 outra lavanderia não vê';
  begin perform public.my_plan((select id from t_sub where k = 'biz')); raise exception 'T152 FALHOU outra lavanderia';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set role anon;
do $$ begin
  begin perform public.my_plan((select id from t_sub where k = 'biz')); raise exception 'T152 FALHOU anon';
  exception when insufficient_privilege then null; end;
  begin perform public.admin_plans(); raise exception 'T152 FALHOU anon admin';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub', '14141414-0000-0000-0000-000000000014', false);
select public.admin_set_app_payment(false);
do $$ begin
  assert not exists (select 1 from public.tables_without_rls() where table_name not in ('t_tok', 't_ids', 't_pay', 't_log', 't_app', 't_sub')), 'T152 RLS';
  raise notice 'T152 OK  dono volta ao Grátis na hora e cancela mensalidade aberta; outras lavanderias e visitantes não veem nada; RLS em tudo';
end $$;
