-- =====================================================================
-- LIMPA AQUI — Onboarding dinâmico (Etapa 1: banco + motor de regras)
--
-- Catálogo global (editável só por migration/admin):
--   service_categories, service_templates, features, feature_rules, segment_modules
-- Por empresa (multiempresa com RLS):
--   business_categories, business_features (+ colunas novas em businesses e services)
-- Assistente:
--   onboarding_profiles (respostas + passo atual; o checklist é calculado dos dados reais)
-- RPCs:
--   save_onboarding_step, complete_onboarding, apply_business_rules, get_setup_checklist
--
-- Nada aqui é decidido por IA: tudo sai das tabelas de regras abaixo.
-- Requer as migrations anteriores (Etapas 1, 2 e 2b).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'onboarding_situation') then
    create type public.onboarding_situation as enum ('comecar_em_casa', 'autonomo', 'lavanderia', 'empresa_limpeza');
  end if;
  if not exists (select 1 from pg_type where typname = 'business_segment') then
    create type public.business_segment as enum ('iniciante', 'profissional', 'empresa');
  end if;
  if not exists (select 1 from pg_type where typname = 'pricing_unit') then
    create type public.pricing_unit as enum ('unidade', 'par', 'peca', 'kg', 'conjunto', 'm2', 'orcamento');
  end if;
  if not exists (select 1 from pg_type where typname = 'feature_status') then
    create type public.feature_status as enum ('disponivel', 'em_breve');
  end if;
  if not exists (select 1 from pg_type where typname = 'rule_trigger') then
    create type public.rule_trigger as enum ('sempre', 'situacao', 'categoria', 'operacao', 'equipe');
  end if;
  if not exists (select 1 from pg_type where typname = 'config_source') then
    create type public.config_source as enum ('regra', 'manual');
  end if;
end$$;

-- =====================================================================
-- CATÁLOGO GLOBAL
-- =====================================================================

-- Categorias de serviço oferecidas no assistente
create table if not exists public.service_categories (
  code           text primary key check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  name           text not null check (char_length(name) between 2 and 60),
  description    text check (description is null or char_length(description) <= 200),
  group_code     text not null check (group_code in ('roupas', 'calcados', 'casa', 'estofados', 'acessorios', 'outros')),
  pricing_units  public.pricing_unit[] not null check (cardinality(pricing_units) > 0),
  sort           integer not null default 0
);

-- Serviços sugeridos por categoria (o usuário adiciona com um clique e define o preço)
create table if not exists public.service_templates (
  id             uuid primary key default gen_random_uuid(),
  category_code  text not null references public.service_categories (code) on delete cascade,
  name           text not null check (char_length(name) between 2 and 80),
  pricing_unit   public.pricing_unit not null,
  sort           integer not null default 0,
  unique (category_code, name)
);

-- Recursos (módulos) do sistema. "em_breve" = aparece no painel, mas ainda não tem tela.
create table if not exists public.features (
  code         text primary key check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  name         text not null check (char_length(name) between 2 and 60),
  description  text check (description is null or char_length(description) <= 200),
  route        text check (route is null or route ~ '^/app(/[a-z0-9/_-]*)?$'),
  status       public.feature_status not null default 'em_breve',
  sort         integer not null default 0
);

-- Regras determinísticas: "se <gatilho> = <valor>, habilite <recurso>"
create table if not exists public.feature_rules (
  id             uuid primary key default gen_random_uuid(),
  trigger_type   public.rule_trigger not null,
  trigger_value  text check ((trigger_type = 'sempre') = (trigger_value is null)),
  feature_code   text not null references public.features (code) on delete cascade,
  unique nulls not distinct (trigger_type, trigger_value, feature_code)
);

-- Destaques do painel por segmento (ordem dos módulos e atalhos)
create table if not exists public.segment_modules (
  segment       public.business_segment not null,
  feature_code  text not null references public.features (code) on delete cascade,
  sort          integer not null default 0,
  primary key (segment, feature_code)
);

-- =====================================================================
-- DADOS DO CATÁLOGO (as regras editáveis)
-- =====================================================================

insert into public.service_categories (code, name, group_code, pricing_units, sort) values
  ('lavagem_roupas',        'Lavagem de roupas',            'roupas',     '{peca,kg,conjunto}', 10),
  ('secagem_roupas',        'Secagem de roupas',            'roupas',     '{peca,kg}',          20),
  ('passadoria',            'Passadoria',                   'roupas',     '{peca,conjunto}',    30),
  ('lavagem_tenis',         'Lavagem de tênis',             'calcados',   '{par}',              40),
  ('limpeza_sapatos',       'Limpeza de sapatos',           'calcados',   '{par}',              50),
  ('lavagem_edredons',      'Lavagem de edredons',          'casa',       '{peca}',             60),
  ('lavagem_cobertores',    'Lavagem de cobertores',        'casa',       '{peca}',             70),
  ('limpeza_cortinas',      'Limpeza de cortinas',          'casa',       '{peca,m2}',          80),
  ('limpeza_bolsas',        'Limpeza de bolsas e mochilas', 'acessorios', '{unidade}',          90),
  ('higienizacao_sofas',    'Higienização de sofás',        'estofados',  '{orcamento,unidade}', 100),
  ('higienizacao_colchoes', 'Higienização de colchões',     'estofados',  '{orcamento,unidade}', 110),
  ('limpeza_estofados',     'Limpeza de estofados',         'estofados',  '{orcamento,unidade}', 120),
  ('outros',                'Outros serviços',              'outros',     '{unidade,orcamento}', 130)
on conflict (code) do update
  set name = excluded.name, group_code = excluded.group_code, pricing_units = excluded.pricing_units, sort = excluded.sort;

insert into public.service_templates (category_code, name, pricing_unit, sort) values
  ('lavagem_roupas',        'Lavagem por quilo',                 'kg',        1),
  ('lavagem_roupas',        'Lavagem por peça',                  'peca',      2),
  ('lavagem_roupas',        'Lavar e passar (conjunto)',         'conjunto',  3),
  ('secagem_roupas',        'Secagem por quilo',                 'kg',        1),
  ('passadoria',            'Passar roupa por peça',             'peca',      1),
  ('passadoria',            'Passar camisa social',              'peca',      2),
  ('lavagem_tenis',         'Lavagem simples de tênis',          'par',       1),
  ('lavagem_tenis',         'Lavagem premium de tênis',          'par',       2),
  ('lavagem_tenis',         'Clareamento de sola',               'par',       3),
  ('limpeza_sapatos',       'Limpeza de sapato social',          'par',       1),
  ('limpeza_sapatos',       'Limpeza de bota',                   'par',       2),
  ('lavagem_edredons',      'Lavagem de edredom solteiro',       'peca',      1),
  ('lavagem_edredons',      'Lavagem de edredom casal/queen',    'peca',      2),
  ('lavagem_cobertores',    'Lavagem de cobertor',               'peca',      1),
  ('limpeza_cortinas',      'Lavagem de cortina por m²',         'm2',        1),
  ('limpeza_bolsas',        'Limpeza de bolsa',                  'unidade',   1),
  ('limpeza_bolsas',        'Limpeza de mochila',                'unidade',   2),
  ('higienizacao_sofas',    'Higienização de sofá',              'orcamento', 1),
  ('higienizacao_colchoes', 'Higienização de colchão',           'orcamento', 1),
  ('limpeza_estofados',     'Limpeza de cadeiras estofadas',     'unidade',   1),
  ('limpeza_estofados',     'Limpeza de poltrona',               'orcamento', 2)
on conflict (category_code, name) do update set pricing_unit = excluded.pricing_unit, sort = excluded.sort;

-- Status reflete o que existe de verdade hoje. Cada etapa futura muda para 'disponivel' ao entregar a tela.
insert into public.features (code, name, route, status, sort, description) values
  ('pedidos',        'Pedidos',                  '/app/pedidos',     'disponivel', 10,  'Do recebimento à entrega.'),
  ('clientes',       'Clientes',                 '/app/clientes',    'disponivel', 20,  'Cadastro de clientes e endereços.'),
  ('servicos',       'Serviços',                 '/app/servicos',    'disponivel', 30,  'Catálogo de serviços e preços.'),
  ('entregas',       'Central de entregas',      '/app/rotas',       'disponivel', 40,  'Coletas e entregas com rota no mapa.'),
  ('checklist',      'Primeiros passos',         '/app',             'disponivel', 5,   'O que falta para começar a atender.'),
  ('campos_calcado', 'Ficha do calçado',         null,               'em_breve',   50,  'Marca, modelo, cor e numeração no pedido.'),
  ('catalogo_roupas','Catálogo de roupas',       null,               'em_breve',   55,  'Peças, quilo e conjuntos no pedido.'),
  ('dimensoes_item', 'Medidas do item',          null,               'em_breve',   60,  'Dimensões e características de sofás e colchões.'),
  ('orcamento',      'Orçamentos',               null,               'em_breve',   65,  'Orçamento antes de virar pedido.'),
  ('fotos',          'Fotos antes e depois',     null,               'em_breve',   70,  'Fotos do item no pedido.'),
  ('calculadoras',   'Calculadoras de custo e preço', null,          'em_breve',   75,  'Ajuda para calcular custos e definir preços.'),
  ('equipe',         'Equipe',                   null,               'em_breve',   80,  'Funcionários com acesso ao sistema.'),
  ('agenda',         'Agenda',                   null,               'em_breve',   85,  'Atendimentos com dia e hora.'),
  ('financeiro',     'Financeiro',               null,               'em_breve',   90,  'Recebimentos e despesas.'),
  ('relatorios',     'Relatórios',               null,               'em_breve',   95,  'Resumo de pedidos e faturamento.'),
  ('pagina_publica', 'Página comercial',         null,               'em_breve',   100, 'Sua página com serviços e WhatsApp.'),
  ('indicadores',    'Indicadores de desempenho',null,               'em_breve',   105, 'Visão gerencial do negócio.')
on conflict (code) do update
  set name = excluded.name, route = excluded.route, status = excluded.status, sort = excluded.sort, description = excluded.description;

insert into public.feature_rules (trigger_type, trigger_value, feature_code) values
  -- sempre
  ('sempre', null, 'pedidos'), ('sempre', null, 'clientes'), ('sempre', null, 'servicos'), ('sempre', null, 'checklist'),
  -- situação
  ('situacao', 'comecar_em_casa', 'calculadoras'),
  ('situacao', 'comecar_em_casa', 'pagina_publica'),
  ('situacao', 'autonomo',        'calculadoras'),
  ('situacao', 'autonomo',        'agenda'),
  ('situacao', 'autonomo',        'financeiro'),
  ('situacao', 'lavanderia',      'financeiro'),
  ('situacao', 'lavanderia',      'relatorios'),
  ('situacao', 'empresa_limpeza', 'financeiro'),
  ('situacao', 'empresa_limpeza', 'relatorios'),
  ('situacao', 'empresa_limpeza', 'indicadores'),
  -- categorias
  ('categoria', 'lavagem_roupas',        'catalogo_roupas'),
  ('categoria', 'secagem_roupas',        'catalogo_roupas'),
  ('categoria', 'passadoria',            'catalogo_roupas'),
  ('categoria', 'lavagem_tenis',         'campos_calcado'),
  ('categoria', 'lavagem_tenis',         'fotos'),
  ('categoria', 'limpeza_sapatos',       'campos_calcado'),
  ('categoria', 'limpeza_sapatos',       'fotos'),
  ('categoria', 'limpeza_bolsas',        'fotos'),
  ('categoria', 'lavagem_edredons',      'catalogo_roupas'),
  ('categoria', 'lavagem_cobertores',    'catalogo_roupas'),
  ('categoria', 'limpeza_cortinas',      'catalogo_roupas'),
  ('categoria', 'limpeza_cortinas',      'dimensoes_item'),
  ('categoria', 'higienizacao_sofas',    'orcamento'),
  ('categoria', 'higienizacao_sofas',    'dimensoes_item'),
  ('categoria', 'higienizacao_sofas',    'fotos'),
  ('categoria', 'higienizacao_sofas',    'agenda'),
  ('categoria', 'higienizacao_colchoes', 'orcamento'),
  ('categoria', 'higienizacao_colchoes', 'dimensoes_item'),
  ('categoria', 'higienizacao_colchoes', 'fotos'),
  ('categoria', 'higienizacao_colchoes', 'agenda'),
  ('categoria', 'limpeza_estofados',     'orcamento'),
  ('categoria', 'limpeza_estofados',     'dimensoes_item'),
  ('categoria', 'limpeza_estofados',     'fotos'),
  ('categoria', 'limpeza_estofados',     'agenda'),
  -- operação
  ('operacao', 'busca_na_casa',           'entregas'),
  ('operacao', 'faz_entregas',            'entregas'),
  ('operacao', 'servico_na_casa_cliente', 'agenda'),
  ('operacao', 'servico_na_casa_cliente', 'orcamento'),
  ('operacao', 'com_funcionarios',        'equipe'),
  -- tamanho da equipe (Etapa 4 do assistente)
  ('equipe', '2_5',     'equipe'),
  ('equipe', '6_mais',  'equipe'),
  ('equipe', '6_mais',  'indicadores')
on conflict do nothing;

insert into public.segment_modules (segment, feature_code, sort) values
  ('iniciante', 'checklist', 1), ('iniciante', 'calculadoras', 2), ('iniciante', 'servicos', 3),
  ('iniciante', 'clientes', 4), ('iniciante', 'pagina_publica', 5), ('iniciante', 'pedidos', 6),
  ('profissional', 'pedidos', 1), ('profissional', 'clientes', 2), ('profissional', 'agenda', 3),
  ('profissional', 'financeiro', 4), ('profissional', 'servicos', 5), ('profissional', 'entregas', 6),
  ('profissional', 'relatorios', 7),
  ('empresa', 'indicadores', 1), ('empresa', 'equipe', 2), ('empresa', 'pedidos', 3),
  ('empresa', 'financeiro', 4), ('empresa', 'entregas', 5), ('empresa', 'relatorios', 6)
on conflict (segment, feature_code) do update set sort = excluded.sort;

-- =====================================================================
-- POR EMPRESA
-- =====================================================================

-- businesses: identidade usada pelo assistente
alter table public.businesses
  add column if not exists email          text check (email is null or (char_length(email) <= 160 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  add column if not exists service_region text check (service_region is null or char_length(service_region) <= 160),
  add column if not exists opening_hours  jsonb check (opening_hours is null or (jsonb_typeof(opening_hours) = 'object' and pg_column_size(opening_hours) <= 4000)),
  add column if not exists logo_path      text check (logo_path is null or char_length(logo_path) <= 300),
  add column if not exists segment        public.business_segment;

-- services (= serviços da empresa): categoria e unidade de cobrança
alter table public.services
  add column if not exists category_code text references public.service_categories (code) on delete set null,
  add column if not exists pricing_unit  public.pricing_unit not null default 'unidade';

grant insert (category_code, pricing_unit) on public.services to authenticated;
grant update (category_code, pricing_unit) on public.services to authenticated;

-- Categorias atendidas pela empresa (do catálogo ou personalizadas)
create table if not exists public.business_categories (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses (id) on delete cascade,
  category_code  text references public.service_categories (code) on delete cascade,
  custom_name    text check (custom_name is null or char_length(trim(custom_name)) between 2 and 60),
  active         boolean not null default true,
  source         public.config_source not null default 'manual',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check ((category_code is null) <> (custom_name is null)),
  unique (business_id, category_code)
);

create unique index if not exists business_categories_custom_uq
  on public.business_categories (business_id, lower(trim(custom_name))) where custom_name is not null;

create trigger business_categories_updated_at
  before update on public.business_categories
  for each row execute function public.set_updated_at();

-- Recursos habilitados na empresa (calculados pelas regras ou ajustados à mão pelo dono)
create table if not exists public.business_features (
  business_id   uuid not null references public.businesses (id) on delete cascade,
  feature_code  text not null references public.features (code) on delete cascade,
  enabled       boolean not null default true,
  source        public.config_source not null default 'manual',
  updated_at    timestamptz not null default now(),
  primary key (business_id, feature_code)
);

-- Alteração feita pela tela (fora das funções do sistema) vira ajuste manual,
-- que o recálculo das regras respeita.
create or replace function public.mark_manual_source()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('limpaaqui.internal', true) is distinct from 'on' then
    new.source := 'manual';
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger business_features_manual
  before insert or update on public.business_features
  for each row execute function public.mark_manual_source();

create trigger business_categories_manual
  before insert or update on public.business_categories
  for each row execute function public.mark_manual_source();

-- =====================================================================
-- ASSISTENTE
-- =====================================================================
create table if not exists public.onboarding_profiles (
  user_id            uuid primary key references auth.users (id) on delete cascade,
  business_id        uuid references public.businesses (id) on delete set null,
  situation          public.onboarding_situation,
  categories         text[] not null default '{}' check (cardinality(categories) <= 20),
  custom_categories  text[] not null default '{}' check (cardinality(custom_categories) <= 10),
  operations         text[] not null default '{}' check (
                       operations <@ array['trabalho_em_casa', 'estabelecimento', 'recebe_na_residencia', 'busca_na_casa',
                                           'faz_entregas', 'servico_na_casa_cliente', 'com_funcionarios', 'sozinho']::text[]),
  has_clients        boolean,
  weekly_orders      text check (weekly_orders is null or weekly_orders in ('ate_10', '11_50', '51_200', 'mais_200')),
  team               text check (team is null or team in ('sozinho', '2_5', '6_mais')),
  has_prices         boolean,
  service_region     text check (service_region is null or char_length(service_region) <= 160),
  draft              jsonb not null default '{}' check (jsonb_typeof(draft) = 'object' and pg_column_size(draft) <= 8000),
  current_step       integer not null default 1 check (current_step between 1 and 6),
  completed_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists onboarding_profiles_business_idx on public.onboarding_profiles (business_id);

create trigger onboarding_profiles_updated_at
  before update on public.onboarding_profiles
  for each row execute function public.set_updated_at();

-- Categorias do assistente precisam existir no catálogo; personalizadas têm tamanho limitado
create or replace function public.validate_onboarding_profile()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_bad text;
begin
  select c into v_bad
  from unnest(new.categories) as c
  where not exists (select 1 from public.service_categories sc where sc.code = c)
  limit 1;
  if v_bad is not null then
    raise exception 'Categoria desconhecida: %', v_bad using errcode = '22023';
  end if;
  if exists (select 1 from unnest(new.custom_categories) as c where char_length(trim(c)) not between 2 and 60) then
    raise exception 'Categorias personalizadas precisam ter de 2 a 60 caracteres.' using errcode = '22023';
  end if;
  new.categories := array(select distinct c from unnest(new.categories) as c order by c);
  return new;
end;
$$;

create trigger onboarding_profiles_validate
  before insert or update on public.onboarding_profiles
  for each row execute function public.validate_onboarding_profile();

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.service_categories  enable row level security;
alter table public.service_templates   enable row level security;
alter table public.features            enable row level security;
alter table public.feature_rules       enable row level security;
alter table public.segment_modules     enable row level security;
alter table public.business_categories enable row level security;
alter table public.business_features   enable row level security;
alter table public.onboarding_profiles enable row level security;

-- Catálogo: qualquer usuário logado lê; ninguém escreve pela API
create policy service_categories_read on public.service_categories for select to authenticated using (true);
create policy service_templates_read  on public.service_templates  for select to authenticated using (true);
create policy features_read           on public.features           for select to authenticated using (true);
create policy feature_rules_read      on public.feature_rules      for select to authenticated using (true);
create policy segment_modules_read    on public.segment_modules    for select to authenticated using (true);

-- business_categories: membros leem; dono ativa, desativa, cria e exclui
create policy business_categories_select_member on public.business_categories
  for select to authenticated using (public.is_business_member(business_id));
create policy business_categories_insert_owner on public.business_categories
  for insert to authenticated with check (public.is_business_owner(business_id));
create policy business_categories_update_owner on public.business_categories
  for update to authenticated
  using (public.is_business_owner(business_id))
  with check (public.is_business_owner(business_id));
create policy business_categories_delete_owner on public.business_categories
  for delete to authenticated using (public.is_business_owner(business_id));

-- business_features: membros leem; dono liga/desliga
create policy business_features_select_member on public.business_features
  for select to authenticated using (public.is_business_member(business_id));
create policy business_features_insert_owner on public.business_features
  for insert to authenticated with check (public.is_business_owner(business_id));
create policy business_features_update_owner on public.business_features
  for update to authenticated
  using (public.is_business_owner(business_id))
  with check (public.is_business_owner(business_id));

-- onboarding_profiles: cada um lê o próprio; o dono da empresa vinculada também lê. Escrita só via RPC.
create policy onboarding_profiles_select on public.onboarding_profiles
  for select to authenticated
  using (user_id = auth.uid() or (business_id is not null and public.is_business_owner(business_id)));

-- Privilégios explícitos
revoke all on public.service_categories, public.service_templates, public.features, public.feature_rules,
              public.segment_modules, public.business_categories, public.business_features,
              public.onboarding_profiles from anon, authenticated;

grant select on public.service_categories, public.service_templates, public.features, public.feature_rules,
               public.segment_modules to authenticated;

grant select, delete on public.business_categories to authenticated;
grant insert (business_id, category_code, custom_name, active) on public.business_categories to authenticated;
grant update (active) on public.business_categories to authenticated;

grant select on public.business_features to authenticated;
grant insert (business_id, feature_code, enabled) on public.business_features to authenticated;
grant update (enabled) on public.business_features to authenticated;

grant select on public.onboarding_profiles to authenticated;

-- =====================================================================
-- RPC: salvar uma etapa do assistente (salvamento automático)
-- Só as chaves presentes em p_data são alteradas; as demais respostas ficam como estão.
-- =====================================================================
create or replace function public.save_onboarding_step(p_step integer, p_data jsonb default '{}')
returns public.onboarding_profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_row  public.onboarding_profiles;
  d      jsonb := coalesce(p_data, '{}');
begin
  if v_user is null then
    raise exception 'Faça login para continuar.' using errcode = '28000';
  end if;
  if jsonb_typeof(d) <> 'object' then
    raise exception 'Dados inválidos.' using errcode = '22023';
  end if;

  insert into public.onboarding_profiles (user_id) values (v_user) on conflict (user_id) do nothing;

  begin
    update public.onboarding_profiles p set
      situation         = case when d ? 'situation' then nullif(d ->> 'situation', '')::public.onboarding_situation else p.situation end,
      categories        = case when d ? 'categories' then array(select jsonb_array_elements_text(coalesce(d -> 'categories', '[]'))) else p.categories end,
      custom_categories = case when d ? 'custom_categories'
                               then array(select trim(x) from jsonb_array_elements_text(coalesce(d -> 'custom_categories', '[]')) as x where trim(x) <> '')
                               else p.custom_categories end,
      operations        = case when d ? 'operations' then array(select distinct jsonb_array_elements_text(coalesce(d -> 'operations', '[]'))) else p.operations end,
      has_clients       = case when d ? 'has_clients' then (d ->> 'has_clients')::boolean else p.has_clients end,
      weekly_orders     = case when d ? 'weekly_orders' then nullif(d ->> 'weekly_orders', '') else p.weekly_orders end,
      team              = case when d ? 'team' then nullif(d ->> 'team', '') else p.team end,
      has_prices        = case when d ? 'has_prices' then (d ->> 'has_prices')::boolean else p.has_prices end,
      service_region    = case when d ? 'service_region' then nullif(trim(d ->> 'service_region'), '') else p.service_region end,
      draft             = case when d ? 'draft' and jsonb_typeof(d -> 'draft') = 'object' then d -> 'draft' else p.draft end,
      current_step      = least(greatest(coalesce(p_step, p.current_step), 1), 6)
    where p.user_id = v_user
    returning * into v_row;
  exception
    when invalid_text_representation then
      raise exception 'Resposta inválida. Atualize a página e tente novamente.' using errcode = '22023';
    when check_violation then
      raise exception 'Resposta fora das opções permitidas.' using errcode = '22023';
  end;

  return v_row;
end;
$$;

-- =====================================================================
-- RPC: aplicar as regras na empresa (idempotente; preserva ajustes manuais)
-- =====================================================================
create or replace function public.apply_business_rules(p_business_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile  public.onboarding_profiles;
  v_segment  public.business_segment;
  v_features text[];
begin
  if auth.uid() is null then
    raise exception 'Faça login para continuar.' using errcode = '28000';
  end if;
  if not public.is_business_owner(p_business_id) then
    raise exception 'Somente o dono da lavanderia pode alterar a configuração.' using errcode = 'P0001';
  end if;

  select * into v_profile
  from public.onboarding_profiles p
  where p.business_id = p_business_id
  order by p.completed_at desc nulls last
  limit 1;

  perform set_config('limpaaqui.internal', 'on', true);

  -- 1) Categorias vindas do assistente (as criadas/alteradas à mão pelo dono não são tocadas)
  if v_profile.user_id is not null then
    insert into public.business_categories (business_id, category_code, active, source)
    select p_business_id, c, true, 'regra' from unnest(v_profile.categories) as c
    on conflict (business_id, category_code) do update
      set active = true
      where public.business_categories.source = 'regra';

    insert into public.business_categories (business_id, custom_name, active, source)
    select p_business_id, trim(c), true, 'regra' from unnest(v_profile.custom_categories) as c
    where not exists (
      select 1 from public.business_categories bc
      where bc.business_id = p_business_id and lower(trim(bc.custom_name)) = lower(trim(c))
    );

    update public.business_categories bc
       set active = false
     where bc.business_id = p_business_id
       and bc.source = 'regra'
       and bc.active
       and (
         (bc.category_code is not null and not (bc.category_code = any (v_profile.categories)))
         or (bc.custom_name is not null and not exists (
               select 1 from unnest(v_profile.custom_categories) as c where lower(trim(c)) = lower(trim(bc.custom_name))))
       );
  end if;

  -- 2) Segmento
  v_segment := case v_profile.situation
    when 'comecar_em_casa' then 'iniciante'
    when 'autonomo'        then 'profissional'
    when 'lavanderia'      then case when v_profile.team in ('2_5', '6_mais')
                                       or 'com_funcionarios' = any (v_profile.operations)
                                       or v_profile.weekly_orders in ('51_200', 'mais_200')
                                     then 'empresa' else 'profissional' end
    when 'empresa_limpeza' then 'empresa'
    else null
  end::public.business_segment;

  update public.businesses set segment = coalesce(v_segment, segment) where id = p_business_id;

  -- 3) Recursos: regras "sempre" + situação + categorias ativas + operações + equipe
  select coalesce(array_agg(distinct r.feature_code), '{}') into v_features
  from public.feature_rules r
  where r.trigger_type = 'sempre'
     or (r.trigger_type = 'situacao'  and r.trigger_value = v_profile.situation::text)
     or (r.trigger_type = 'operacao'  and r.trigger_value = any (v_profile.operations))
     or (r.trigger_type = 'equipe'    and r.trigger_value = v_profile.team)
     or (r.trigger_type = 'categoria' and r.trigger_value in (
           select bc.category_code from public.business_categories bc
           where bc.business_id = p_business_id and bc.active and bc.category_code is not null));

  insert into public.business_features (business_id, feature_code, enabled, source)
  select p_business_id, f, true, 'regra' from unnest(v_features) as f
  on conflict (business_id, feature_code) do update
    set enabled = true
    where public.business_features.source = 'regra' and not public.business_features.enabled;

  update public.business_features bf
     set enabled = false
   where bf.business_id = p_business_id
     and bf.source = 'regra'
     and bf.enabled
     and not (bf.feature_code = any (v_features));

  perform set_config('limpaaqui.internal', 'off', true);
end;
$$;

-- =====================================================================
-- RPC: concluir o assistente
-- Cria a lavanderia (ou usa a existente, no modo "Personalizar"), grava a identidade
-- do rascunho e aplica as regras.
-- =====================================================================
create or replace function public.complete_onboarding()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user     uuid := auth.uid();
  v_profile  public.onboarding_profiles;
  v_business uuid;
  v_role     public.business_role;
  d          jsonb;
  v_hours    jsonb;
begin
  if v_user is null then
    raise exception 'Faça login para continuar.' using errcode = '28000';
  end if;

  select * into v_profile from public.onboarding_profiles p where p.user_id = v_user for update;
  if v_profile.user_id is null then
    raise exception 'Responda as perguntas do assistente antes de concluir.' using errcode = 'P0001';
  end if;
  if v_profile.situation is null then
    raise exception 'Conte qual é a sua situação atual (etapa 1).' using errcode = '22023';
  end if;
  if cardinality(v_profile.categories) + cardinality(v_profile.custom_categories) = 0 then
    raise exception 'Escolha pelo menos um serviço que você pretende oferecer (etapa 2).' using errcode = '22023';
  end if;

  d := v_profile.draft;
  v_hours := case when jsonb_typeof(d -> 'opening_hours') = 'object' then d -> 'opening_hours' end;

  select m.business_id, m.role into v_business, v_role
  from public.business_members m where m.user_id = v_user
  order by m.created_at limit 1;

  if v_business is not null and v_role <> 'owner' then
    raise exception 'Somente o dono da lavanderia pode refazer a configuração.' using errcode = 'P0001';
  end if;

  if v_business is null then
    -- create_business valida nome, endereço público e WhatsApp e mantém a regra de uma lavanderia por usuário
    v_business := public.create_business(
      d ->> 'name', d ->> 'slug', d ->> 'whatsapp', d ->> 'city', d ->> 'state', d ->> 'neighborhood'
    );
  end if;

  begin
    update public.businesses b set
      name           = coalesce(nullif(trim(d ->> 'name'), ''), b.name),
      whatsapp       = case when d ? 'whatsapp' then coalesce(nullif(regexp_replace(d ->> 'whatsapp', '\D', '', 'g'), ''), b.whatsapp) else b.whatsapp end,
      email          = case when d ? 'email' then nullif(lower(trim(d ->> 'email')), '') else b.email end,
      city           = case when d ? 'city' then coalesce(nullif(trim(d ->> 'city'), ''), b.city) else b.city end,
      state          = case when d ? 'state' then coalesce(nullif(upper(trim(d ->> 'state')), ''), b.state) else b.state end,
      neighborhood   = case when d ? 'neighborhood' then nullif(trim(d ->> 'neighborhood'), '') else b.neighborhood end,
      street         = case when d ? 'street' then nullif(trim(d ->> 'street'), '') else b.street end,
      street_number  = case when d ? 'street_number' then nullif(trim(d ->> 'street_number'), '') else b.street_number end,
      complement     = case when d ? 'complement' then nullif(trim(d ->> 'complement'), '') else b.complement end,
      postal_code    = case when d ? 'postal_code' then nullif(regexp_replace(d ->> 'postal_code', '\D', '', 'g'), '') else b.postal_code end,
      lat            = case when d ? 'lat' then (d ->> 'lat')::double precision else b.lat end,
      lng            = case when d ? 'lng' then (d ->> 'lng')::double precision else b.lng end,
      place_id       = case when d ? 'place_id' then nullif(d ->> 'place_id', '') else b.place_id end,
      service_region = coalesce(nullif(trim(d ->> 'service_region'), ''), v_profile.service_region, b.service_region),
      opening_hours  = coalesce(v_hours, b.opening_hours),
      logo_path      = case when d ? 'logo_path' then nullif(d ->> 'logo_path', '') else b.logo_path end
    where b.id = v_business;
  exception
    when check_violation then
      raise exception 'Confira os dados do negócio (e-mail, CEP ou endereço inválido).' using errcode = '22023';
    when invalid_text_representation then
      raise exception 'Confira os dados do negócio.' using errcode = '22023';
  end;

  update public.onboarding_profiles
     set business_id = v_business, completed_at = now(), current_step = 6
   where user_id = v_user;

  perform public.apply_business_rules(v_business);
  return v_business;
end;
$$;

-- =====================================================================
-- Checklist de primeiros passos — calculado dos dados reais
-- (nada fica concluído só porque o usuário clicou)
-- =====================================================================
create or replace function public.get_setup_checklist(p_business_id uuid)
returns table (code text, label text, done boolean, href text, available boolean, sort integer)
language sql
stable
security invoker
set search_path = ''
as $$
  with b as (
    select * from public.businesses where id = p_business_id and public.is_business_member(p_business_id)
  )
  select * from (
    select 'dados'::text, 'Configurar dados do negócio'::text,
           exists (select 1 from b where b.whatsapp is not null and b.city is not null and b.state is not null
                                     and (b.street is not null or b.service_region is not null)),
           '/app/configuracoes'::text, true, 1
    from b
    union all
    select 'servicos', 'Cadastrar serviços',
           exists (select 1 from public.services s where s.business_id = p_business_id),
           '/app/servicos', true, 2
    from b
    union all
    select 'precos', 'Definir preços',
           exists (select 1 from public.services s
                   where s.business_id = p_business_id and s.active and (s.price > 0 or s.pricing_unit = 'orcamento'))
           and not exists (select 1 from public.services s
                           where s.business_id = p_business_id and s.active and s.price = 0 and s.pricing_unit <> 'orcamento'),
           '/app/servicos', true, 3
    from b
    union all
    select 'pagina_publica', 'Criar página pública', false, null::text,
           exists (select 1 from public.features f where f.code = 'pagina_publica' and f.status = 'disponivel'), 4
    from b
    union all
    select 'cliente', 'Cadastrar primeiro cliente',
           exists (select 1 from public.customers c where c.business_id = p_business_id),
           '/app/clientes', true, 5
    from b
    union all
    select 'pedido', 'Criar primeiro pedido',
           exists (select 1 from public.orders o where o.business_id = p_business_id),
           '/app/pedidos/novo', true, 6
    from b
  ) t (code, label, done, href, available, sort)
  order by sort;
$$;

-- Permissões das funções
revoke all on function public.save_onboarding_step(integer, jsonb) from public, anon;
revoke all on function public.apply_business_rules(uuid) from public, anon;
revoke all on function public.complete_onboarding() from public, anon;
revoke all on function public.get_setup_checklist(uuid) from public, anon;
grant execute on function public.save_onboarding_step(integer, jsonb) to authenticated;
grant execute on function public.apply_business_rules(uuid) to authenticated;
grant execute on function public.complete_onboarding() to authenticated;
grant execute on function public.get_setup_checklist(uuid) to authenticated;

revoke all on function public.mark_manual_source() from public, anon, authenticated;
revoke all on function public.validate_onboarding_profile() from public, anon, authenticated;

insert into public.reserved_slugs (slug) values ('configurar'), ('assistente'), ('equipe'), ('calculadoras') on conflict do nothing;
