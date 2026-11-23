-- Histórico do pedido, confirmação de recebimento e disputas (PRD seção 8). Roda por último.
\set ON_ERROR_STOP on
\set QUIET on
reset role;
create temp table t169 (k text primary key, id uuid);
insert into t169 select 'done', id from t168 where k = 'done';
insert into t169 select 'deliv', id from t168 where k = 'deliv';
insert into t169 select 'open', id from t168 where k = 'open';
-- cenário: pedido entregue há pouco, com repasse pendente para a lavanderia
update public.orders set delivered_at = now() - interval '1 day' where id = (select id from t169 where k = 'done');
with p as (
  insert into public.payouts (payee_type, business_id, order_id, amount)
  select 'prestador', o.business_id, o.id, 40 from public.orders o where o.id = (select id from t169 where k = 'done')
  returning id)
insert into t169 select 'pay', p.id from p;
-- segundo pedido: pago pelo app, com Pix aplicado e repasse pendente
select set_config('limpaaqui.internal', 'on', false);
update public.orders set payment_mode = 'app', paid = true where id = (select id from t169 where k = 'open');
select set_config('limpaaqui.internal', 'off', false);
with t as (
  insert into public.payment_transactions (order_id, business_id, payer_user_id, identifier, amount, status, applied)
  select o.id, o.business_id, o.client_user_id, 'teste-disputa-0001', public.app_order_amount(o), 'completed', true
  from public.orders o where o.id = (select id from t169 where k = 'open') returning id)
insert into t169 select 'tx', t.id from t;
insert into public.payouts (payee_type, business_id, order_id, transaction_id, amount)
select 'prestador', o.business_id, o.id, (select id from t169 where k = 'tx'), 30 from public.orders o where o.id = (select id from t169 where k = 'open');
grant select on t169 to authenticated;
set role authenticated;

-- T169: histórico e linha do tempo só para os participantes
select set_config('request.jwt.claim.sub', '18181818-0000-0000-0000-000000000018', false);
do $$ declare tl jsonb := public.order_timeline((select id from t169 where k = 'done')); begin
  assert jsonb_array_length(tl -> 'events') >= 3, 'T169 eventos do pedido';
  assert (tl -> 'events' -> 0 ->> 'event') = 'criado', 'T169 primeiro evento';
  assert exists (select 1 from jsonb_array_elements(tl -> 'events') e where e ->> 'to' = 'entregue'), 'T169 entrega registrada';
  assert jsonb_array_length(tl -> 'deliveries') >= 1, 'T169 corridas na linha do tempo';
  begin perform 1 from public.order_status_history; raise exception 'T169 FALHOU tabela direta';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub', '17171717-0000-0000-0000-000000000017', false);
do $$ begin
  begin perform public.order_timeline((select id from t169 where k = 'done')); raise exception 'T169 FALHOU estranho vê histórico';
  exception when insufficient_privilege then null; end;
  begin perform public.open_dispute((select id from t169 where k = 'done'), 'dano', 'Não sou deste pedido'); raise exception 'T169 FALHOU estranho abre disputa';
  exception when insufficient_privilege then null; end;
  raise notice 'T169 OK  histórico do pedido: criação, mudanças de situação e corridas; só cliente, equipe e admin';
end $$;

-- T170: cliente abre disputa → repasse bloqueado; não confirma nem paga enquanto aberta; lavanderia responde
select set_config('request.jwt.claim.sub', '18181818-0000-0000-0000-000000000018', false);
do $$ declare s record; begin
  begin perform public.open_dispute((select id from t169 where k = 'done'), 'dano', 'curto'); raise exception 'T170 FALHOU descrição curta';
  exception when invalid_parameter_value then null; end;
  perform public.open_dispute((select id from t169 where k = 'done'), 'dano', 'A camisa branca voltou com uma mancha amarela.');
  begin perform public.open_dispute((select id from t169 where k = 'done'), 'outro', 'Abrindo outra disputa igual'); raise exception 'T170 FALHOU duas abertas';
  exception when invalid_parameter_value then null; end;
  begin perform public.confirm_order_received((select id from t169 where k = 'done')); raise exception 'T170 FALHOU confirma com disputa';
  exception when invalid_parameter_value then null; end;
  select * into s from public.order_stage_info(array[(select id from t169 where k = 'done')]);
  assert s.dispute ->> 'status' = 'aberta' and not s.can_confirm and not s.can_dispute and not (s.dispute ->> 'can_respond')::boolean, 'T170 situação do cliente';
  begin perform public.respond_dispute((s.dispute ->> 'id')::uuid, 'Eu mesmo respondo'); raise exception 'T170 FALHOU quem abriu responde';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  assert (select status from public.payouts where id = (select id from t169 where k = 'pay')) = 'bloqueado', 'T170 repasse bloqueado';
  assert (select dispute_hold from public.payouts where id = (select id from t169 where k = 'pay')), 'T170 marca da disputa';
end $$;
-- repasse criado durante a disputa já nasce bloqueado
insert into public.payouts (payee_type, courier_id, order_id, delivery_id, amount)
select 'entregador', d.courier_id, d.order_id, d.id, 8 from public.deliveries d where d.id = (select id from t169 where k = 'deliv');
do $$ begin
  assert (select status from public.payouts where delivery_id = (select id from t169 where k = 'deliv') and status <> 'cancelado') = 'bloqueado', 'T170 novo repasse bloqueado';
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
do $$ declare s record; begin
  select * into s from public.order_stage_info(array[(select id from t169 where k = 'done')]);
  assert (s.dispute ->> 'can_respond')::boolean, 'T170 dono pode responder';
  perform public.respond_dispute((s.dispute ->> 'id')::uuid, 'Vamos relavar sem custo, pode trazer.');
end $$;
-- admin não paga nem libera durante a disputa; quem não é admin não vê disputas
select set_config('request.jwt.claim.sub', '14141414-0000-0000-0000-000000000014', false);
do $$ begin
  begin perform public.admin_set_payout_status((select id from t169 where k = 'pay'), 'pendente'); raise exception 'T170 FALHOU libera na disputa';
  exception when raise_exception then null; end;
  assert (select count(*) from public.admin_disputes('aberta') where response like 'Vamos relavar%') = 1, 'T170 lista do admin';
end $$;
select set_config('request.jwt.claim.sub', '18181818-0000-0000-0000-000000000018', false);
do $$ begin
  begin perform public.admin_disputes(); raise exception 'T170 FALHOU cliente lista disputas';
  exception when insufficient_privilege then null; end;
  raise notice 'T170 OK  disputa: cliente abre, repasses bloqueados (inclusive os novos), sem confirmar nem pagar; a outra parte responde';
end $$;

-- T171: admin decide a favor da lavanderia → repasses liberados; cliente confirma → concluído, sem nova disputa
select set_config('request.jwt.claim.sub', '14141414-0000-0000-0000-000000000014', false);
do $$ declare d uuid := (select id from public.admin_disputes('aberta') where order_id = (select id from t169 where k = 'done')); begin
  begin perform public.admin_resolve_dispute(d, 'favor_prestador', ''); raise exception 'T171 FALHOU sem explicação';
  exception when invalid_parameter_value then null; end;
  perform public.admin_resolve_dispute(d, 'favor_prestador', 'A lavanderia ofereceu relavar sem custo.');
  begin perform public.admin_resolve_dispute(d, 'acordo', 'De novo'); raise exception 'T171 FALHOU resolve duas vezes';
  exception when invalid_parameter_value then null; end;
end $$;
reset role;
do $$ begin
  assert (select status from public.payouts where id = (select id from t169 where k = 'pay')) = 'pendente', 'T171 repasse liberado';
  assert not exists (select 1 from public.payouts where order_id = (select id from t169 where k = 'done') and dispute_hold), 'T171 sem marca';
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub', '18181818-0000-0000-0000-000000000018', false);
do $$ declare s record; tl jsonb; begin
  select * into s from public.order_stage_info(array[(select id from t169 where k = 'done')]);
  assert s.can_confirm and s.dispute ->> 'resolution' = 'favor_prestador', 'T171 pode confirmar';
  perform public.confirm_order_received((select id from t169 where k = 'done'));
  select * into s from public.order_stage_info(array[(select id from t169 where k = 'done')]);
  assert s.client_confirmed_at is not null and not s.can_dispute, 'T171 concluído';
  begin perform public.open_dispute((select id from t169 where k = 'done'), 'dano', 'Depois de concluído não pode'); raise exception 'T171 FALHOU disputa após concluir';
  exception when invalid_parameter_value then null; end;
  tl := public.order_timeline((select id from t169 where k = 'done'));
  assert exists (select 1 from jsonb_array_elements(tl -> 'events') e where e ->> 'event' = 'disputa_resolvida' and e ->> 'actor' = 'admin'), 'T171 decisão no histórico';
  assert exists (select 1 from jsonb_array_elements(tl -> 'events') e where e ->> 'event' = 'concluido' and e ->> 'actor' = 'cliente'), 'T171 conclusão no histórico';
  raise notice 'T171 OK  admin decide a favor da lavanderia e os repasses voltam a valer; cliente confirma o recebimento e o pedido fica concluído';
end $$;

-- T172: lavanderia abre disputa num pedido pago pelo app; decisão a favor do cliente → Pix a devolver e repasses cancelados
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
do $$ begin
  perform public.open_dispute((select id from t169 where k = 'open'), 'cobranca', 'Cliente pediu outro serviço do que foi pago.');
end $$;
select set_config('request.jwt.claim.sub', '18181818-0000-0000-0000-000000000018', false);
do $$ declare s record; begin
  select * into s from public.order_stage_info(array[(select id from t169 where k = 'open')]);
  assert s.dispute ->> 'opened_by_role' = 'prestador' and (s.dispute ->> 'can_respond')::boolean, 'T172 cliente pode responder';
  perform public.respond_dispute((s.dispute ->> 'id')::uuid, 'Paguei exatamente o que foi combinado.');
end $$;
select set_config('request.jwt.claim.sub', '14141414-0000-0000-0000-000000000014', false);
do $$ begin
  perform public.admin_resolve_dispute((select id from public.admin_disputes('aberta') where order_id = (select id from t169 where k = 'open')),
                                       'favor_cliente', 'O pagamento será devolvido ao cliente.');
end $$;
reset role;
do $$ begin
  assert (select needs_refund from public.payment_transactions where id = (select id from t169 where k = 'tx')), 'T172 Pix a devolver';
  assert not exists (select 1 from public.payouts where order_id = (select id from t169 where k = 'open') and status in ('pendente', 'bloqueado')), 'T172 repasses cancelados';
  assert exists (select 1 from public.financial_ledger where order_id = (select id from t169 where k = 'open') and event = 'disputa_resolvida'), 'T172 livro-razão';
  assert exists (select 1 from public.notifications n join public.user_roles r on r.user_id = n.user_id and r.role = 'admin' where n.kind = 'disputa'), 'T172 admin avisado';
  raise notice 'T172 OK  disputa aberta pela lavanderia; decisão a favor do cliente manda o Pix para devolução e cancela os repasses';
end $$;
