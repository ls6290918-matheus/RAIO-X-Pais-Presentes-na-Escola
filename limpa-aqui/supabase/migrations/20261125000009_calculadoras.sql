-- =====================================================================
-- LIMPA AQUI — Onboarding dinâmico, Etapa 6: calculadoras de custo e preço
--  * business_settings: dados do cálculo "quanto vale a sua hora"
--  * service_costs: custos informados para cada serviço (o cálculo fica na tela, a partir destes valores)
-- Só o dono altera; funcionários podem ver. Nada aqui promete lucro: são estimativas
-- feitas com os números que o próprio usuário informa.
-- =====================================================================

alter table public.business_settings
  add column if not exists income_goal      numeric(10, 2) check (income_goal is null or (income_goal >= 0 and income_goal <= 1000000)),
  add column if not exists fixed_costs      numeric(10, 2) check (fixed_costs is null or (fixed_costs >= 0 and fixed_costs <= 1000000)),
  add column if not exists work_hours_day   numeric(4, 1)  check (work_hours_day is null or (work_hours_day > 0 and work_hours_day <= 24)),
  add column if not exists work_days_month  integer        check (work_days_month is null or (work_days_month between 1 and 31)),
  add column if not exists hourly_rate      numeric(10, 2) check (hourly_rate is null or (hourly_rate >= 0 and hourly_rate <= 10000));

create table if not exists public.service_costs (
  service_id    uuid primary key,
  business_id   uuid not null,
  products      numeric(10, 2) not null default 0 check (products  >= 0 and products  <= 99999),
  water         numeric(10, 2) not null default 0 check (water     >= 0 and water     <= 99999),
  energy        numeric(10, 2) not null default 0 check (energy    >= 0 and energy    <= 99999),
  packaging     numeric(10, 2) not null default 0 check (packaging >= 0 and packaging <= 99999),
  other         numeric(10, 2) not null default 0 check (other     >= 0 and other     <= 99999),
  minutes       integer        not null default 0 check (minutes between 0 and 1440),
  margin_pct    numeric(5, 2)  not null default 30 check (margin_pct >= 0 and margin_pct <= 90),
  card_fee_pct  numeric(5, 2)  not null default 0  check (card_fee_pct >= 0 and card_fee_pct <= 30),
  updated_at    timestamptz not null default now(),
  -- serviço e custos sempre da mesma lavanderia
  foreign key (business_id, service_id) references public.services (business_id, id) on delete cascade,
  check (margin_pct + card_fee_pct < 95)
);

create trigger service_costs_updated_at
  before update on public.service_costs
  for each row execute function public.set_updated_at();

alter table public.service_costs enable row level security;

create policy service_costs_select_member on public.service_costs
  for select to authenticated using (public.is_business_member(business_id));
create policy service_costs_insert_owner on public.service_costs
  for insert to authenticated with check (public.is_business_owner(business_id));
create policy service_costs_update_owner on public.service_costs
  for update to authenticated
  using (public.is_business_owner(business_id))
  with check (public.is_business_owner(business_id));
create policy service_costs_delete_owner on public.service_costs
  for delete to authenticated using (public.is_business_owner(business_id));

revoke all on public.service_costs from anon, authenticated;
grant select, delete on public.service_costs to authenticated;
grant insert (service_id, business_id, products, water, energy, packaging, other, minutes, margin_pct, card_fee_pct)
  on public.service_costs to authenticated;
grant update (products, water, energy, packaging, other, minutes, margin_pct, card_fee_pct)
  on public.service_costs to authenticated;

update public.features set status = 'disponivel', route = '/app/calculadoras' where code = 'calculadoras';
