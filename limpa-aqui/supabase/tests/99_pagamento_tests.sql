-- Testes do marketplace, Etapa 5a (pagamento direto, comissões e livro-razão). Roda depois de 98_contratacao_tests.sql.
\set ON_ERROR_STOP on
\set QUIET on

reset role;
insert into auth.users (id, email, raw_user_meta_data) values ('18181818-0000-0000-0000-000000000018', 'bia@teste.com', '{"full_name":"Bia Cliente"}');
insert into public.user_roles (user_id, role) values ('18181818-0000-0000-0000-000000000018', 'anunciante');
update public.profiles set phone = '21944443333' where id = '18181818-0000-0000-0000-000000000018';
create temporary table t_pay (k text primary key, id uuid);
grant all on t_pay to authenticated, anon;
insert into t_pay select 'biz', id from public.businesses where slug = 'lavanderia-do-joao';
insert into t_pay select 'svc', id from public.services s where s.business_id = (select id from t_pay where k = 'biz') and s.active and s.pricing_unit <> 'orcamento' and s.price > 0 order by created_at limit 1;
insert into t_pay select 'svc_tenis', id from public.services s where s.business_id = (select id from t_pay where k = 'biz') and s.active and s.category_code = 'lavagem_tenis' and s.pricing_unit <> 'orcamento' and s.price > 0 limit 1;
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
select public.set_marketplace_visible((select id from public.businesses where slug = 'lavanderia-do-joao'), true);
select set_config('request.jwt.claim.sub', '18181818-0000-0000-0000-000000000018', false);
with x as (insert into public.user_addresses (label, city, state) values ('Casa', 'Niterói', 'RJ') returning id)
insert into t_pay select 'addr', id from x;

-- T116: só o admin cria regra de comissão; sem regra, nada é cobrado
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
do $$ begin
  begin perform public.admin_create_commission_rule('direto', 10); raise exception 'T116 FALHOU dono criou regra';
  exception when insufficient_privilege then null; end;
  begin insert into public.commission_rules (payment_mode, percent) values ('direto', 1); raise exception 'T116 FALHOU insert';
  exception when insufficient_privilege then null; end;
  assert (select count(*) from public.commission_rules) = 0, 'T116 dono vê regras';
end $$;
select set_config('request.jwt.claim.sub', '18181818-0000-0000-0000-000000000018', false);
do $$
declare o uuid;
begin
  o := public.hire_services((select id from t_pay where k = 'biz'),
         jsonb_build_array(jsonb_build_object('service_id', (select id from t_pay where k = 'svc'))),
         (select id from t_pay where k = 'addr'));
  insert into t_pay values ('order_sem_regra', o);
end $$;
reset role;
do $$ begin
  assert not exists (select 1 from public.platform_commissions where order_id = (select id from t_pay where k = 'order_sem_regra')), 'T116 comissão sem regra';
  assert exists (select 1 from public.financial_ledger where order_id = (select id from t_pay where k = 'order_sem_regra') and event = 'pedido_marketplace'), 'T116 livro';
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub', '14141414-0000-0000-0000-000000000014', false);
do $$ begin
  insert into t_pay values ('rule10', public.admin_create_commission_rule('direto', 10, 0, null, null, 'Lançamento'));
  raise notice 'T116 OK  só o admin cria regras; sem regra, pedido não gera comissão (mas entra no livro-razão)';
end $$;

-- T117: pedido novo gera comissão prevista pela regra vigente
select set_config('request.jwt.claim.sub', '18181818-0000-0000-0000-000000000018', false);
do $$
declare o uuid;
begin
  o := public.hire_services((select id from t_pay where k = 'biz'),
         jsonb_build_array(jsonb_build_object('service_id', (select id from t_pay where k = 'svc'), 'quantity', 2)),
         (select id from t_pay where k = 'addr'));
  insert into t_pay values ('order', o);
end $$;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
do $$
declare c public.platform_commissions; t numeric;
begin
  select total into t from public.orders where id = (select id from t_pay where k = 'order');
  select * into c from public.platform_commissions where order_id = (select id from t_pay where k = 'order');
  assert c.status = 'prevista' and c.commission_amount = round(t * 0.10, 2) and c.percent = 10, 'T117 comissão prevista';
  assert (public.order_finance((select id from t_pay where k = 'order')) -> 'commission' ->> 'status') = 'prevista', 'T117 dono vê';
  raise notice 'T117 OK  pedido do marketplace gera comissão prevista de 10%% pela regra vigente; o dono vê';
end $$;
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000004', false);
do $$ begin
  assert (select count(*) from public.platform_commissions) = 0, 'T117 funcionário vê comissão';
  assert public.order_finance((select id from t_pay where k = 'order')) -> 'commission' = 'null'::jsonb, 'T117 funcionário vê na tela';
end $$;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', false);
do $$ begin
  assert (select count(*) from public.platform_commissions) = 0 and (select count(*) from public.financial_ledger) = 0, 'T117 outra lavanderia vê';
  begin perform public.order_finance((select id from t_pay where k = 'order')); raise exception 'T117 FALHOU outra';
  exception when raise_exception then if sqlerrm like 'T117%' then raise; end if; end;
end $$;

-- T118: pago só pela confirmação; confirmação uma vez; comissão vira "a cobrar"
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
do $$
declare o uuid := (select id from t_pay where k = 'order');
begin
  begin update public.orders set paid = true where id = o; raise exception 'T118 FALHOU interruptor';
  exception when others then if sqlerrm like 'T118%' then raise; end if; end;
  begin perform public.confirm_direct_payment(o, 0, 'pix'); raise exception 'T118 FALHOU valor zero';
  exception when others then if sqlerrm like 'T118%' then raise; end if; end;
  begin perform public.confirm_direct_payment(o, 50, 'pix', 'bbbbbbbb-0000-0000-0000-000000000002/x/y.jpg'); raise exception 'T118 FALHOU comprovante de outra';
  exception when others then if sqlerrm like 'T118%' then raise; end if; end;
  perform public.confirm_direct_payment(o, 90, 'pix');
  assert (select paid from public.orders where id = o), 'T118 pago';
  assert (select status = 'a_cobrar' and base_amount = 90 and commission_amount = 9 from public.platform_commissions where order_id = o), 'T118 a cobrar sobre o recebido';
  begin perform public.confirm_direct_payment(o, 90, 'pix'); raise exception 'T118 FALHOU duas vezes';
  exception when others then if sqlerrm like 'T118%' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', false);
do $$ begin
  begin perform public.confirm_direct_payment((select id from t_pay where k = 'order_sem_regra'), 10, 'pix'); raise exception 'T118 FALHOU outra confirmou';
  exception when others then if sqlerrm like 'T118%' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub', '18181818-0000-0000-0000-000000000018', false);
do $$ begin
  assert (select amount from public.external_payment_confirmations where order_id = (select id from t_pay where k = 'order')) = 90, 'T118 cliente vê a confirmação';
  assert (select paid from public.my_orders() where id = (select id from t_pay where k = 'order')), 'T118 meus pedidos pago';
  raise notice 'T118 OK  "pago" só muda pela confirmação do prestador (uma vez); comissão vira "a cobrar" sobre o valor recebido';
end $$;

-- T119: livro-razão não muda nem some, nem para o dono do banco
reset role;
do $$ begin
  begin update public.financial_ledger set amount = 0 where order_id = (select id from t_pay where k = 'order'); raise exception 'T119 FALHOU update';
  exception when insufficient_privilege then null; end;
  begin delete from public.financial_ledger where order_id = (select id from t_pay where k = 'order'); raise exception 'T119 FALHOU delete';
  exception when insufficient_privilege then null; end;
  assert (select string_agg(event, ',' order by id) from public.financial_ledger where order_id = (select id from t_pay where k = 'order'))
         = 'pedido_marketplace,comissao_prevista,pagamento_direto_confirmado,comissao_a_cobrar', 'T119 eventos';
  raise notice 'T119 OK  livro-razão registra pedido, comissão e pagamento, e não pode ser alterado nem apagado';
end $$;

-- T120: resumo do admin separado por modalidade; comissão paga
set role authenticated;
select set_config('request.jwt.claim.sub', '14141414-0000-0000-0000-000000000014', false);
do $$
declare r record; c uuid;
begin
  select * into r from public.admin_finance_summary() where payment_mode = 'direto';
  assert r.orders >= 2 and r.confirmed_orders = 1 and r.confirmed_total = 90 and r.commission_to_collect = 9, 'T120 resumo direto';
  select * into r from public.admin_finance_summary() where payment_mode = 'app';
  assert r.orders = 0 and r.confirmed_total = 0, 'T120 app separado';
  select id into c from public.admin_list_commissions('a_cobrar') limit 1;
  perform public.admin_set_commission_status(c, 'paga');
  begin perform public.admin_set_commission_status(c, 'a_cobrar'); raise exception 'T120 FALHOU voltou';
  exception when raise_exception then if sqlerrm like 'T120%' then raise; end if; end;
  assert (select commission_paid from public.admin_finance_summary() where payment_mode = 'direto') = 9, 'T120 paga';
  raise notice 'T120 OK  admin vê pedidos, pagamentos declarados e comissões por modalidade e marca comissão como paga';
end $$;

-- T121: regra nova substitui a antiga; a mais específica vence; pedido cancelado cancela a comissão
do $$ begin
  insert into t_pay values ('rule_tenis', public.admin_create_commission_rule('direto', 5, 1, 'lavagem_tenis', 3303302));
  insert into t_pay values ('rule12', public.admin_create_commission_rule('direto', 12));
  assert (select valid_to is not null from public.commission_rules where id = (select id from t_pay where k = 'rule10')), 'T121 antiga encerrada';
end $$;
select set_config('request.jwt.claim.sub', '18181818-0000-0000-0000-000000000018', false);
do $$
declare o uuid;
begin
  o := public.hire_services((select id from t_pay where k = 'biz'), jsonb_build_array(jsonb_build_object('service_id', (select id from t_pay where k = 'svc_tenis'))), (select id from t_pay where k = 'addr'));
  insert into t_pay values ('order_tenis', o);
end $$;
reset role;
do $$
declare c public.platform_commissions; t numeric;
begin
  select total into t from public.orders where id = (select id from t_pay where k = 'order_tenis');
  select * into c from public.platform_commissions where order_id = (select id from t_pay where k = 'order_tenis');
  assert c.rule_id = (select id from t_pay where k = 'rule_tenis') and c.commission_amount = round(t * 0.05 + 1, 2), 'T121 regra específica';
  assert (select commission_amount from public.platform_commissions where order_id = (select id from t_pay where k = 'order')) = 9, 'T121 pedido antigo não muda';
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
select public.set_order_status((select id from t_pay where k = 'order_tenis'), 'cancelado');
do $$ begin
  assert (select status from public.platform_commissions where order_id = (select id from t_pay where k = 'order_tenis')) = 'cancelada', 'T121 cancelada';
  begin perform public.confirm_direct_payment((select id from t_pay where k = 'order_tenis'), 10, 'dinheiro'); raise exception 'T121 FALHOU pagou cancelado';
  exception when raise_exception then if sqlerrm like 'T121%' then raise; end if; end;
  raise notice 'T121 OK  regra nova encerra a antiga; a mais específica vence; pedido antigo mantém a sua; cancelar o pedido cancela a comissão';
end $$;

-- T122: pedido de balcão continua como antes
do $$
declare o uuid;
begin
  select id into o from public.orders where business_id = (select id from public.businesses where slug = 'lavanderia-do-joao') and origin = 'balcao' and status <> 'cancelado' limit 1;
  update public.orders set paid = not paid where id = o;
  update public.orders set paid = not paid where id = o;
  assert not exists (select 1 from public.platform_commissions where order_id = o), 'T122 comissão em balcão';
  begin perform public.confirm_direct_payment(o, 10, 'pix'); raise exception 'T122 FALHOU balcão';
  exception when raise_exception then if sqlerrm like 'T122%' then raise; end if; end;
  raise notice 'T122 OK  pedido de balcão: interruptor de pago funciona como antes e não gera comissão';
end $$;

-- T123: visitante e RLS
reset role;
set role anon;
do $$ begin
  begin perform count(*) from public.financial_ledger; raise exception 'T123 FALHOU livro';
  exception when insufficient_privilege then null; end;
  begin perform public.admin_finance_summary(); raise exception 'T123 FALHOU resumo';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  assert not exists (select 1 from public.tables_without_rls() where table_name not in ('t_tok', 't_ids', 't_pay')), 'T123 RLS';
  raise notice 'T123 OK  visitante não vê nada financeiro; RLS em todas as tabelas';
end $$;
