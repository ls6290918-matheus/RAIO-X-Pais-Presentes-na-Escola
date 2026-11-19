-- Testes dos avisos (notificações). Roda por último: usa os eventos gerados pelos testes anteriores.
\set ON_ERROR_STOP on
\set QUIET on

reset role;
do $$ begin
  assert exists (select 1 from public.notifications where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and kind = 'pedido_novo'), 'T154 dono avisado de pedido novo';
  assert exists (select 1 from public.notifications where user_id = 'dddddddd-0000-0000-0000-000000000004' and kind = 'pedido_novo'), 'T154 funcionário avisado de pedido novo';
  assert exists (select 1 from public.notifications where user_id = '18181818-0000-0000-0000-000000000018' and kind = 'pix_confirmado'), 'T154 cliente avisado do Pix';
  assert exists (select 1 from public.notifications where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and kind = 'pix_confirmado'), 'T154 prestador avisado do Pix';
  assert exists (select 1 from public.notifications where user_id = '18181818-0000-0000-0000-000000000018' and kind = 'pedido_entregue'), 'T154 cliente avisado de entregue';
  assert exists (select 1 from public.notifications where kind = 'proposta_nova'), 'T154 anunciante avisado de proposta';
  assert exists (select 1 from public.notifications where kind = 'proposta_aceita' and user_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 'T154 prestador avisado de proposta aceita';
  assert not exists (select 1 from public.notifications where kind = 'proposta_aceita' and user_id = 'dddddddd-0000-0000-0000-000000000004'), 'T154 proposta aceita só para o dono';
  assert exists (select 1 from public.notifications where kind = 'corrida_disponivel' and user_id = '19191919-0000-0000-0000-000000000019'), 'T154 entregador do município avisado';
  assert not exists (select 1 from public.notifications where kind = 'corrida_disponivel' and user_id = '20202020-0000-0000-0000-000000000020'
                     and created_at < (select min(created_at) from public.deliveries where municipality_id = 3304557)), 'T154 entregador de outro município';
  assert exists (select 1 from public.notifications where kind = 'repasse_pago' and user_id = '19191919-0000-0000-0000-000000000019'), 'T154 entregador avisado do repasse';
  assert exists (select 1 from public.notifications where kind = 'plano_ativo' and user_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 'T154 dono avisado do plano';
  raise notice 'T154 OK  avisos gerados: pedido novo (equipe), Pix confirmado (cliente e prestador), situação do pedido, proposta nova/aceita, corrida, repasse e plano';
end $$;

set role authenticated;
select set_config('request.jwt.claim.sub', '18181818-0000-0000-0000-000000000018', false);
do $$
declare n integer;
begin
  assert (select count(*) from public.notifications where user_id <> auth.uid()) = 0, 'T155 só vê os próprios';
  n := (select count(*) from public.notifications where read_at is null);
  assert n > 0, 'T155 tem não lidos';
  assert public.mark_notifications_read(array[(select id from public.notifications order by created_at limit 1)]) = 1, 'T155 marca um';
  perform public.mark_notifications_read();
  assert (select count(*) from public.notifications where read_at is null) = 0, 'T155 marca todos';
  begin update public.notifications set read_at = null; raise exception 'T155 FALHOU alterou direto';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub', '17171717-0000-0000-0000-000000000017', false);
do $$ begin
  assert (select count(*) from public.notifications where kind = 'pix_confirmado') = 0, 'T155 outro cliente não vê';
end $$;
reset role;
set role anon;
do $$ begin
  begin perform count(*) from public.notifications; raise exception 'T155 FALHOU anon';
  exception when insufficient_privilege then null; end;
  begin perform public.mark_notifications_read(); raise exception 'T155 FALHOU anon marca';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  assert not exists (select 1 from public.tables_without_rls() where table_name not in ('t_tok', 't_ids', 't_pay', 't_log', 't_app', 't_sub')), 'T155 RLS';
  raise notice 'T155 OK  cada pessoa só vê e marca os próprios avisos; ninguém altera direto; visitante não acessa; RLS em tudo';
end $$;
