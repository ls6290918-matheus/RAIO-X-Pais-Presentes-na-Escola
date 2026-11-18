-- Testes da Etapa 6 (calculadoras). Roda depois de 70_fotos_tests.sql.
\set ON_ERROR_STOP on
\set QUIET on

-- ---------------------------------------------------------------- Usuário A (dono)
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);

-- T71: dono guarda o cálculo da hora e os custos de um serviço
do $$
declare v uuid; s uuid;
begin
  select id into v from public.businesses where slug = 'lavanderia-do-joao';
  update public.business_settings
     set income_goal = 3000, fixed_costs = 800, work_hours_day = 8, work_days_month = 22, hourly_rate = 21.59
   where business_id = v;
  assert (select hourly_rate from public.business_settings where business_id = v) = 21.59, 'T71 hora';
  select id into s from public.services where name = 'Tênis premium A';
  insert into public.service_costs (service_id, business_id, products, water, energy, minutes, margin_pct, card_fee_pct)
  values (s, v, 6.5, 0.4, 0.8, 40, 35, 3);
  update public.service_costs set products = 7 where service_id = s;
  assert (select products from public.service_costs where service_id = s) = 7, 'T71 custos';
  raise notice 'T71 OK  dono guarda o valor da hora e os custos do serviço';
end $$;

-- T72: valores absurdos são recusados
do $$
declare v uuid; s uuid;
begin
  select id into v from public.businesses where slug = 'lavanderia-do-joao';
  select id into s from public.services where name = 'Tênis premium A';
  begin update public.service_costs set margin_pct = 95 where service_id = s; raise exception 'T72 FALHOU margem';
  exception when check_violation then null; end;
  begin update public.service_costs set products = -1 where service_id = s; raise exception 'T72 FALHOU negativo';
  exception when check_violation then null; end;
  begin update public.service_costs set margin_pct = 80, card_fee_pct = 20 where service_id = s; raise exception 'T72 FALHOU soma';
  exception when check_violation then null; end;
  begin update public.business_settings set work_days_month = 40 where business_id = v; raise exception 'T72 FALHOU dias';
  exception when check_violation then null; end;
  raise notice 'T72 OK  margem acima de 90%%, custo negativo, margem + taxa ≥ 95%% e mês de 40 dias são recusados';
end $$;

-- T73: custo de serviço de outra lavanderia é recusado (chave composta)
do $$
declare v uuid; s_b uuid;
begin
  select id into v from public.businesses where slug = 'lavanderia-do-joao';
  reset role;
  select s.id into s_b from public.services s join public.businesses b on b.id = s.business_id where b.slug = 'maria-sneakers' limit 1;
  set role authenticated;
  begin
    insert into public.service_costs (service_id, business_id) values (s_b, v);
    raise exception 'T73 FALHOU';
  exception when foreign_key_violation then null; end;
  raise notice 'T73 OK  não dá para ligar custos ao serviço de outra lavanderia';
end $$;

-- ---------------------------------------------------------------- Usuário D (funcionário de A)
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000004', false);
do $$
declare n int;
begin
  assert (select count(*) from public.service_costs) = 1, 'T74 staff não vê';
  update public.service_costs set products = 0;
  get diagnostics n = row_count;
  assert n = 0, 'T74 staff alterou custos';
  update public.business_settings set hourly_rate = 1;
  get diagnostics n = row_count;
  assert n = 0, 'T74 staff alterou hora';
  raise notice 'T74 OK  funcionário vê as calculadoras, mas só o dono altera';
end $$;

-- ---------------------------------------------------------------- Usuário B (outra empresa)
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', false);
do $$
declare n int;
begin
  assert (select count(*) from public.service_costs) = 0, 'T75 B vê custos de A';
  update public.service_costs set products = 0;
  get diagnostics n = row_count;
  assert n = 0, 'T75 B alterou';
  raise notice 'T75 OK  outra empresa não vê nem altera custos de A';
end $$;

reset role;
do $$ begin
  assert (select status = 'disponivel' and route = '/app/calculadoras' from public.features where code = 'calculadoras'), 'T76 recurso';
  assert not exists (select 1 from public.tables_without_rls()), 'T76 RLS';
  raise notice 'T76 OK  calculadoras disponíveis; RLS em todas as tabelas';
end $$;
