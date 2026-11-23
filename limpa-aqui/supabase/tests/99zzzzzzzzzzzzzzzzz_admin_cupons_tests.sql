-- Admin: auditoria, listas e cupons. Roda por último.
\set ON_ERROR_STOP on
\set QUIET on
reset role;
create temp table t176 (k text primary key, id uuid, n numeric);
-- dois pedidos do cliente 1818 passam a ser pagos pelo app, ainda não pagos
insert into t176 (k, id) select 'o' || row_number() over (order by created_at), id from public.orders
  where client_user_id = '18181818-0000-0000-0000-000000000018' and payment_mode = 'direto' and not paid and status in ('recebido', 'pronto') limit 2;
select set_config('limpaaqui.internal', 'on', false);
update public.orders set payment_mode = 'app' where id in (select id from t176 where k in ('o1', 'o2'));
select set_config('limpaaqui.internal', 'off', false);
insert into t176 (k, id) select 'listing', id from public.listings where status = 'aberto' limit 1;
grant select on t176 to authenticated;
set role authenticated;

-- T176: o que o admin altera fica na trilha de auditoria (antes → depois); ninguém apaga; só admin lê
select set_config('request.jwt.claim.sub', '14141414-0000-0000-0000-000000000014', false);
do $$ declare m integer := (select id from public.municipalities where status = 'cadastrado' limit 1); begin
  perform public.admin_set_municipality_status(m, 'suspenso');
  perform public.admin_set_municipality_status(m, 'cadastrado');
  assert (select count(*) from public.admin_audit_logs('municipalities') where target_id = m::text) = 2, 'T176 duas alterações';
  assert (select changes -> 'status' ->> 1 from public.admin_audit_logs('municipalities') where target_id = m::text order by created_at, id limit 1) = 'suspenso', 'T176 antes → depois';
end $$;
select set_config('request.jwt.claim.sub', '18181818-0000-0000-0000-000000000018', false);
do $$ begin
  begin perform public.admin_audit_logs(); raise exception 'T176 FALHOU cliente lê auditoria';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.audit_logs; raise exception 'T176 FALHOU tabela direta';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  begin delete from public.audit_logs; raise exception 'T176 FALHOU apagou auditoria';
  exception when insufficient_privilege then null; end;
  raise notice 'T176 OK  trilha de auditoria: cada alteração do admin com antes e depois; não pode ser apagada; só o admin lê';
end $$;
set role authenticated;

-- T177: listas do admin com busca; encerrar anúncio avisa o cliente; quem não é admin não vê
select set_config('request.jwt.claim.sub', '14141414-0000-0000-0000-000000000014', false);
do $$ declare n integer; begin
  assert (select count(*) from public.admin_users(null, 'entregador')) >= 3, 'T177 filtro por perfil';
  assert (select max(total_count) from public.admin_users()) >= 10, 'T177 total';
  select number into n from public.orders where id = (select id from t176 where k = 'o1');
  assert exists (select 1 from public.admin_orders(n::text) where id = (select id from t176 where k = 'o1')), 'T177 busca pedido pelo número';
  assert (select count(*) from public.admin_orders(null, null, 'marketplace', 5)) between 1 and 5, 'T177 paginação';
  assert (select count(*) from public.admin_listings(null, 'aberto')) >= 1, 'T177 anúncios abertos';
  begin perform public.admin_close_listing((select id from t176 where k = 'listing'), ''); raise exception 'T177 FALHOU sem motivo';
  exception when invalid_parameter_value then null; end;
  perform public.admin_close_listing((select id from t176 where k = 'listing'), 'Anúncio com conteúdo fora das regras.');
end $$;
reset role;
do $$ begin
  assert (select status from public.listings where id = (select id from t176 where k = 'listing')) = 'cancelado', 'T177 encerrado';
  assert exists (select 1 from public.notifications where kind = 'anuncio_encerrado'), 'T177 cliente avisado';
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub', '17171717-0000-0000-0000-000000000017', false);
do $$ begin
  begin perform public.admin_users(); raise exception 'T177 FALHOU cliente lista usuários';
  exception when insufficient_privilege then null; end;
  begin perform public.admin_orders(); raise exception 'T177 FALHOU cliente lista pedidos';
  exception when insufficient_privilege then null; end;
  raise notice 'T177 OK  listas de usuários, pedidos e anúncios com busca e paginação; encerrar anúncio com motivo avisa o cliente; só admin';
end $$;

-- T178: cupom 10% (teto R$ 3) no pedido pelo app; validações; Pix já gerado bloqueia; 1 uso por pessoa
select set_config('request.jwt.claim.sub', '14141414-0000-0000-0000-000000000014', false);
do $$ begin
  begin perform public.admin_upsert_coupon(null, 'a b', null, 'percentual', 10, null, 0, null, null, 1, false, true); raise exception 'T178 FALHOU código ruim';
  exception when invalid_parameter_value then null; end;
  perform public.admin_upsert_coupon(null, 'bemvindo10', 'Boas-vindas', 'percentual', 10, 3, 10, now() + interval '30 days', 100, 1, false, true);
  perform public.admin_upsert_coupon(null, 'VENCIDO', null, 'valor', 5, null, 0, null, null, 1, false, false);
  begin perform public.admin_upsert_coupon(null, 'BEMVINDO10', null, 'valor', 5, null, 0, null, null, 1, false, true); raise exception 'T178 FALHOU duplicado';
  exception when invalid_parameter_value then null; end;
  assert exists (select 1 from public.admin_audit_logs('coupons') where action = 'insert'), 'T178 criação auditada';
end $$;
select set_config('request.jwt.claim.sub', '18181818-0000-0000-0000-000000000018', false);
do $$ declare r jsonb; begin
  begin perform public.apply_coupon((select id from t176 where k = 'o1'), 'NAOEXISTE'); raise exception 'T178 FALHOU inexistente';
  exception when invalid_parameter_value then null; end;
  begin perform public.apply_coupon((select id from t176 where k = 'o1'), 'VENCIDO'); raise exception 'T178 FALHOU inativo';
  exception when invalid_parameter_value then null; end;
  r := public.apply_coupon((select id from t176 where k = 'o1'), ' bemvindo10 ');
  assert (r ->> 'discount')::numeric = least(round((select total from public.orders where id = (select id from t176 where k = 'o1')) * 0.10, 2), 3), 'T178 desconto com teto';
  assert (public.order_coupon((select id from t176 where k = 'o1')) ->> 'amount')::numeric = (r ->> 'amount')::numeric, 'T178 valor final';
  begin perform public.apply_coupon((select id from t176 where k = 'o2'), 'BEMVINDO10'); raise exception 'T178 FALHOU dois usos';
  exception when invalid_parameter_value then null; end;
end $$;
select set_config('request.jwt.claim.sub', '17171717-0000-0000-0000-000000000017', false);
do $$ begin
  begin perform public.apply_coupon((select id from t176 where k = 'o2'), 'BEMVINDO10'); raise exception 'T178 FALHOU pedido de outro';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
insert into public.payment_transactions (order_id, business_id, payer_user_id, identifier, amount, status)
select id, business_id, client_user_id, 'pix-pendente-cupom', public.app_order_amount(o), 'pending' from public.orders o where id = (select id from t176 where k = 'o1');
set role authenticated;
select set_config('request.jwt.claim.sub', '18181818-0000-0000-0000-000000000018', false);
do $$ begin
  begin perform public.remove_coupon((select id from t176 where k = 'o1')); raise exception 'T178 FALHOU mexeu com Pix gerado';
  exception when invalid_parameter_value then null; end;
  raise notice 'T178 OK  cupom: código validado, desconto percentual com teto, inválido/inativo recusado, 1 uso por pessoa, travado depois de gerar o Pix';
end $$;

-- T179: o cliente paga o valor com desconto; o repasse da lavanderia não muda (a plataforma absorve)
reset role;
delete from public.payment_transactions where identifier = 'pix-pendente-cupom';
insert into t176 (k, n) select 'amount', public.app_order_amount(o) from public.orders o where id = (select id from t176 where k = 'o1');
select public.app_payment_register((select id from t176 where k = 'o1'), '18181818-0000-0000-0000-000000000018', 'sp-cupom-0001', 'pixcupom', (select n from t176 where k = 'amount'));
select public.app_payment_apply('sp-cupom-0001', 'completed', 'evt-cupom-1', (select n from t176 where k = 'amount'));
do $$ declare o public.orders; v_comm numeric; begin
  select * into o from public.orders where id = (select id from t176 where k = 'o1');
  assert o.paid, 'T179 pago com o valor com desconto';
  select coalesce(sum(commission_amount), 0) into v_comm from public.platform_commissions where order_id = o.id and status = 'paga';
  assert (select amount from public.payouts where order_id = o.id and payee_type = 'prestador' and status <> 'cancelado') = greatest(o.total - v_comm, 0),
         'T179 repasse sem desconto';
  assert not exists (select 1 from public.payment_transactions where identifier = 'sp-cupom-0001' and needs_refund), 'T179 valor aceito';
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub', '14141414-0000-0000-0000-000000000014', false);
do $$ begin
  assert (select paid_uses from public.admin_coupons() where code = 'BEMVINDO10') = 1, 'T179 uso pago';
  assert (select discount_paid from public.admin_coupons() where code = 'BEMVINDO10') > 0, 'T179 desconto concedido';
  raise notice 'T179 OK  Pix cobra o valor com desconto; repasse da lavanderia igual ao sem cupom; relatório de uso do cupom';
end $$;
reset role;
