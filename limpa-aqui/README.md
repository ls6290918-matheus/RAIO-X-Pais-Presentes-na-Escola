# Limpa Aqui — Fase 1 (Etapas 1 e 2)

SaaS de gestão para lavanderias de tênis e calçados.
Stack: React + TypeScript + Vite + Tailwind CSS + Supabase (Auth, PostgreSQL, RLS).

## O que já está pronto

### Etapa 1 — Fundação

- Identidade visual (paleta do PRD, fonte Inter), painel com menu lateral e menu mobile.
- Cadastro com confirmação de e-mail, login, recuperação e redefinição de senha.
- Onboarding: nome da lavanderia, endereço público (slug) com verificação em tempo real, WhatsApp, cidade, UF e bairro.
- Dashboard inicial (sem números fictícios) e tela de Configurações que salva no banco.
- Banco multiempresa com RLS em todas as tabelas, testado com 15 testes automáticos.

### Etapa 2 — Operação
- **Serviços**: catálogo com preço e prazo (em branco usa o prazo padrão). Só o dono cria, edita, desativa ou exclui.
- **Clientes**: cadastro com busca por nome ou WhatsApp, botão de WhatsApp e atalho para novo pedido.
  O WhatsApp não se repete dentro da mesma lavanderia.
- **Pedidos**: vários itens por pedido (serviço, descrição do calçado, quantidade e valor), numeração automática
  por lavanderia (#1, #2...), prazo sugerido pelo serviço mais demorado, total calculado no banco.
  Status: Recebido → Em lavagem → Pronto → Entregue (ou Cancelado), com data de cada etapa.
  Botão "Avisar no WhatsApp" com mensagem pronta conforme o status. Marcar como pago, mudar prazo e observações.
- **Dashboard** com números reais: pedidos em aberto, prontos, para entregar hoje, atrasados e próximas entregas.

### Etapa 2b — Endereços e Google Maps
- Endereço completo com **busca do Google** (autocompletar) para a lavanderia (onboarding e Configurações) e para os
  clientes (para coleta e entrega). O endereço escolhido guarda a localização no mapa; tudo pode ser editado à mão.
- Pedido com **"Cliente retira" ou "Entregar"**; o detalhe do pedido mostra o endereço com "Abrir no Maps" e a mensagem
  de WhatsApp muda quando o pedido é para entrega.
- **Rotas**: lista os pedidos prontos para entrega na ordem mais próxima a partir da lavanderia, com mapa, link de rota
  no Google Maps, botão "A caminho" (WhatsApp) e "Entregue".
- O mapa da **página pública** usa o mesmo componente (`MapView`) e entra junto com a página pública.
- Sem `VITE_GOOGLE_MAPS_API_KEY` o app funciona normalmente: os endereços viram campos comuns e o mapa some.

**Chave do Google Maps:** é uma chave de navegador (fica visível no JavaScript do site), então ela **precisa** estar
restrita no Google Cloud Console: *Application restrictions → Websites* com o domínio do site (`https://SEU-DOMINIO/*`)
e `http://localhost:8080/*`; *API restrictions* só com **Maps JavaScript API** e **Places API (New)**, ambas ativadas,
com faturamento ligado no projeto do Google Cloud. Nunca coloque a chave no repositório, só no `.env` e na Vercel.

### Onboarding dinâmico — Etapa 1 (banco e motor de regras)
A configuração automática da empresa sai de **regras em tabelas**, não de IA. Para mudar uma regra, edite as tabelas
do catálogo (por migration ou no SQL Editor) e rode `apply_business_rules` de novo para cada empresa.

| Tabela | O que guarda |
| --- | --- |
| `service_categories` | As 13 categorias do assistente e as unidades de cobrança aceitas |
| `service_templates` | Serviços sugeridos por categoria (o usuário adiciona e define o preço) |
| `features` | Recursos do sistema e se já estão `disponivel` ou `em_breve` |
| `feature_rules` | "Se situação/categoria/operação/equipe = X, habilite o recurso Y" |
| `segment_modules` | Módulos em destaque no painel de iniciante, profissional e empresa |
| `business_categories` | Categorias de cada empresa (catálogo ou personalizadas), ativas ou não |
| `business_features` | Recursos ligados em cada empresa; `source = manual` quando o dono mexe à mão (o recálculo respeita) |
| `onboarding_profiles` | Respostas do assistente e etapa atual, por usuário (retomada após recarregar) |

Funções: `save_onboarding_step` (salva só o que mudou em cada etapa), `complete_onboarding` (cria ou reaproveita a
lavanderia, grava a identidade e aplica as regras), `apply_business_rules` (idempotente, só o dono) e
`get_setup_checklist` (primeiros passos calculados dos dados reais, não de cliques). `services` ganhou
`category_code` e `pricing_unit` (unidade, par, peça, kg, conjunto, m², orçamento); `businesses` ganhou e-mail,
região atendida, horário de funcionamento, logotipo e segmento.

### Onboarding dinâmico — Etapa 2 (assistente)
- `/onboarding` (quem ainda não tem lavanderia) e `/personalizar` (dono de lavanderia já cadastrada; convite no painel).
- 6 telas: situação, serviços (com serviços personalizados), atendimento, negócio hoje (pode pular), identidade
  (nome, endereço da página, WhatsApp, e-mail, endereço com Google, região, horário e logotipo) e resumo com a prévia do
  que será ativado, calculada pelas mesmas regras do banco.
- Salva sozinho 1 s depois de cada alteração e a cada Avançar/Voltar; ao recarregar, volta na mesma etapa.
- Logotipos no bucket público `logos` do Supabase Storage (migration `20261121000005_logos_storage.sql`): cada usuário
  só grava na própria pasta; a imagem é reduzida para 512 px em WebP no navegador.

### Onboarding dinâmico — Etapa 3 (painel personalizado)
- **Painel por segmento**: Começando (checklist e módulos para começar em destaque), Profissional (atalhos,
  indicadores e próximas entregas) e Empresa (indicadores e gestão). Lavanderias ainda não configuradas mantêm o
  painel de antes, com o convite "Personalize seu painel".
- **Menu e telas pelos recursos ligados** (`business_features`): recurso desligado some do menu e a tela mostra
  "está desligado"; recursos ainda não construídos aparecem como "Em breve".
- **Checklist** vindo de `get_setup_checklist` (só marca o que existe de verdade no sistema).
- **Configurações → Categorias e recursos**: ligar/desligar categorias (recalcula pelas regras), serviços
  personalizados, ligar/desligar recursos (fica como "ajustado por você"), **Restaurar automático**
  (`reset_business_features`) e **Refazer o assistente**.
- **Serviços**: categoria, forma de cobrança (unidade, par, peça, kg, conjunto, m², sob orçamento) e sugestões das
  categorias atendidas para adicionar com um clique, sempre sem preço sugerido.

### Onboarding dinâmico — Etapa 4 (ficha por categoria e orçamentos)
- **Ficha do item** conforme a categoria do serviço (só se o recurso estiver ligado): calçado (marca, modelo, cor,
  numeração), bolsa/mochila (marca, modelo, cor), roupas (tipo de peça, cor), cortinas e estofados (medidas em cm,
  lugares, tecido). Fica em `order_items.attributes`, limpa e validada no banco (`clean_item_attributes`).
- **Quantidade por forma de cobrança**: kg e m² aceitam decimais (2,5 kg); par, peça e unidade só inteiros.
- **Orçamento**: status `orcamento` antes de `recebido`. Dá para ajustar itens e valores (`update_quote_items`),
  mandar pelo WhatsApp com os itens e aprovar ("vira pedido", recebido na data da aprovação) ou recusar.
- **Configurações** agora editam também e-mail, região atendida, horário de funcionamento e logotipo.

### Onboarding dinâmico — Etapa 5 (fotos de antes e depois)
- Fotos no pedido, separadas em **Antes** e **Depois** (até 12 por pedido), com visualização em tela cheia.
- No celular o botão abre a câmera ou a galeria; a foto é reduzida no navegador (máx. 1600 px, JPEG) antes do envio.
- Arquivos no bucket **privado** `order-photos`, em `<empresa>/<pedido>/<arquivo>`: só membros da lavanderia leem,
  enviam e apagam (políticas no Storage + tabela `order_photos` com RLS); a tela usa links temporários de 1 hora.

### Onboarding dinâmico — Etapa 6 (calculadoras de custo e preço)
- `/app/calculadoras` (recurso `calculadoras`): **Quanto vale a sua hora** = (quanto quer tirar no mês + custos
  fixos) ÷ horas trabalhadas no mês; fica salvo em `business_settings`.
- **Custo e preço de um serviço**: materiais (produtos, água, energia, embalagem, outros) + tempo × valor da hora.
  Preço sugerido = custo ÷ (1 − margem − taxa da maquininha), também arredondado para o próximo ",90"; compara com o
  preço atual e mostra quanto sobra. Custos de cada serviço ficam em `service_costs`; "Usar como preço" atualiza o
  serviço (pedidos já criados não mudam). As contas estão em `src/features/calculators/calc.ts`.
- Tudo é apresentado como estimativa feita com os números do próprio usuário, sem promessa de lucro.

### Onboarding dinâmico — Etapa 7 (equipe)
- `/app/equipe` (recurso `equipe`, só o dono): gera um **link de convite** (código secreto de 64 caracteres, vale 7
  dias, uso único, até 20 pendentes) para mandar pelo WhatsApp ou copiar; lista quem tem acesso (nome, e-mail, papel)
  e os convites (aguardando, aceito, expirado, cancelado). O dono pode cancelar convites e remover funcionários.
- `/convite/<código>`: quem abre vê só o nome da lavanderia. Sem conta, cria ou entra e volta ao convite (o código
  fica guardado no navegador, inclusive depois de confirmar o e-mail); ao aceitar vira **funcionário** e cai no painel
  da lavanderia, sem passar pelo cadastro de lavanderia. Quem já pertence a uma lavanderia não aceita.
- Funcionários usam pedidos, clientes, serviços (só leitura de preços) e entregas; Equipe e Configurações de preços
  ficam com o dono. Tabela `team_invites` (RLS: só o dono lê; escrita só pelas funções `create_invite`,
  `accept_invite`, `revoke_invite`, `remove_member`; `get_invite` mostra ao visitante só nome e situação).

Financeiro, Agenda e Página pública aparecem no menu como "Em breve", desabilitados.

## Marketplace (PRD oficial: RJ, pagamento híbrido, logística opcional)

O plano completo está em etapas: 1) perfis, admin e municípios; 2) anunciante; 3) prestador no marketplace;
4) anúncios, propostas e contratação; 5) pagamento direto e pelo app; 6) logística; 7) painel administrativo.

### Marketplace — Etapa 1 (perfis, administração e municípios)
- `user_roles`: uma conta pode ter vários perfis — `anunciante`, `prestador`, `entregador`, `admin` — com situação
  `ativo`, `pendente` ou `suspenso`. Quem é dono ou funcionário de lavanderia vira `prestador` automaticamente.
  Entregador começa `pendente` e só vale depois da aprovação do admin. Ninguém se dá o perfil de admin pelo app:
  ele é concedido direto no banco (`insert into public.user_roles (user_id, role) ...`).
- `/comecar`: conta nova escolhe "Quero contratar", "Ofereço serviços" (vai para o assistente de sempre) ou
  "Faço entregas". `/conta`: perfis da conta, o que cada um já permite e "Acrescentar perfil".
  O menu da conta (canto superior) leva a Minha conta, Minha lavanderia e Administração.
- `states` / `municipalities`: os 92 municípios do RJ com código IBGE (lidos de servicodados.ibge.gov.br), situação
  `cadastrado` (aceita cadastros, não aparece como atendido), `ativo` ou `suspenso`. Leitura pública.
  `businesses` e `customers` ganham `municipality_id`, calculado pela cidade/UF (com ou sem acento);
  `businesses.provider_type` (autônomo ou empresa) vem da "situação" respondida no assistente.
- `/admin` (só perfil admin): resumo, busca e filtro dos municípios, mudança de situação, e aprovação/suspensão de
  entregadores. Funções `admin_municipality_overview`, `admin_set_municipality_status`, `admin_list_role`,
  `admin_set_role_status` checam `has_role('admin')` no banco.

### Marketplace — Etapa 2 (anunciante)
- `/cliente` (perfil anunciante): nome e WhatsApp (em `profiles`), endereços e "Meus pedidos". "Quero contratar" em
  `/comecar` leva direto para cá; o aviso "Complete seu cadastro" some quando há WhatsApp e endereço.
- `user_addresses`: até 10 endereços por conta, um principal (o primeiro; apagar o principal promove outro;
  `set_default_address`), município calculado pela cidade/UF. Fora do RJ fica sem município e a tela avisa.
  RLS: cada conta só vê e mexe nos próprios endereços; município, dono e principal não são gravados à mão.
- **CEP**: em todos os formulários de endereço (lavanderia, clientes, anunciante) o CEP vem primeiro e, completo,
  preenche rua, bairro, cidade e UF pelo ViaCEP (`src/lib/cep.ts`); número e complemento ficam com a pessoa.
- `orders.client_user_id` + `my_orders()`: o anunciante vê os próprios pedidos (lavanderia, situação, itens, total,
  link de WhatsApp da lavanderia), nunca notas internas nem a tabela de pedidos. O vínculo é criado pela
  contratação no marketplace (Etapa 4).



## Em produção

- **Site:** https://limpa-aqui-ls6290918-7294.vercel.app (projeto `limpa-aqui` na Vercel)
- **Banco:** projeto Supabase "Limpa aqui _ Supabase" (`uiokoaqzyhuyzrqpoqkl`), com as migrations das Etapas 1 e 2 aplicadas.
- As variáveis `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` e `VITE_GOOGLE_MAPS_API_KEY` estão gravadas no projeto da Vercel.
- **Como a publicação funciona hoje:** a Vercel não está ligada ao GitHub. O deploy envia um `build.sh` curto que baixa
  este repositório num commit fixo (`codeload.github.com/.../tar.gz/<commit>`), roda `npm ci && npm run build` em
  `limpa-aqui/` e publica `dist/`. Para publicar uma versão nova, faça um novo deploy trocando o commit.
  Para deploy automático a cada push, instale o app da Vercel no GitHub (github.com/apps/vercel) e ligue o
  repositório ao projeto com *Root Directory* = `limpa-aqui`.

## Como colocar no ar (do zero)

### 1. Criar o projeto no Supabase

1. Crie uma conta em https://supabase.com e um projeto novo (região: São Paulo).
2. Abra **SQL Editor** e rode, **nesta ordem**, cada arquivo de `supabase/migrations/` (cole o conteúdo e clique em **Run**):
   1. `20261118000001_etapa1_fundacao.sql`
   2. `20261118000002_etapa2_operacao.sql`
   3. `20261119000003_etapa2b_enderecos.sql`
   4. `20261120000004_onboarding_dinamico.sql`
   5. `20261121000005_logos_storage.sql`
   6. `20261122000006_restaurar_recursos.sql`
   7. `20261123000007_pedidos_por_categoria.sql`
   8. `20261124000008_fotos_pedido.sql`
   9. `20261125000009_calculadoras.sql`
   10. `20261126000010_equipe.sql`
   11. `20261127000011_perfis_geografia.sql`
   12. `20261128000012_anunciante.sql`

   Se você já tinha rodado a Etapa 1, rode só o segundo.
3. Confira: `select * from public.tables_without_rls();` deve retornar vazio.
4. Em **Authentication → Sign In / Providers → Email**, deixe **Confirm email** ativado.
5. Em **Authentication → URL Configuration**:
   - **Site URL**: o endereço onde o app vai rodar (ex.: `http://localhost:8080` no teste, depois o domínio final).
   - **Redirect URLs**: adicione `http://localhost:8080/**` e, depois, `https://SEU-DOMINIO/**`.
6. (Opcional) Em **Authentication → Email Templates**, traduza os e-mails de confirmação e recuperação para português.

### 2. Rodar no computador

Requer Node.js 18 ou superior.

```bash
cp .env.example .env      # preencha com Project URL e anon key (Project Settings → API)
npm install
npm run dev               # abre em http://localhost:8080
```

Use **somente** a chave `anon`/`public`. Nunca coloque a `service_role` no `.env` do frontend.

### 3. Publicar

Funciona em Vercel ou Netlify (os arquivos `vercel.json` e `public/_redirects` já tratam as rotas).
Configure as mesmas variáveis `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` no painel da hospedagem
e adicione o domínio publicado nas Redirect URLs do Supabase.

## Estrutura

```
supabase/
  migrations/   SQL versionado (tabelas, RLS, funções)
  tests/        testes do banco (rodam em PostgreSQL local, não no Supabase)
src/
  components/   layout (painel, telas de login, guardas de rota) e componentes visuais
  contexts/     sessão do usuário e lavanderia ativa
  features/     auth, onboarding, dashboard, settings, customers, services, orders
  lib/          cliente Supabase, formatação (BRL, datas, telefone, slug), mensagens de erro
```

## Banco de dados

| Tabela | Uso |
| --- | --- |
| `profiles` | Nome e telefone do usuário; criada automaticamente no cadastro |
| `businesses` | A lavanderia (nome, slug, contato, cidade) |
| `business_members` | Quem acessa cada lavanderia (owner ou staff) |
| `business_settings` | Prazo padrão de entrega, fuso horário |
| `reserved_slugs` | Endereços proibidos (app, login, rastrear...) |
| `customers` | Clientes da lavanderia (nome, WhatsApp, e-mail, observações) |
| `services` | Catálogo de serviços (preço, prazo em dias, ativo) |
| `orders` | Pedidos (número, cliente, status, data de entrega, total, pago, datas de cada etapa) |
| `order_items` | Itens do pedido; guardam nome e preço do serviço na hora do pedido |

Funções: `is_business_member`, `is_business_owner` (usadas pelo RLS), `check_slug_available`,
`create_business` (cria lavanderia + dono + configurações numa transação), `create_order` (pedido + itens + número + total
numa transação), `set_order_status` (só transições válidas) e `tables_without_rls` (diagnóstico).

Regras de segurança:

- O navegador não insere nem apaga lavanderias ou membros; só a função `create_business` faz isso.
- Membros leem os dados da própria lavanderia; só o dono edita.
- Slug e numeração de pedidos são protegidos por trigger.
- Pedidos e itens só são criados por `create_order`; status só muda por `set_order_status`. A tela só edita
  prazo, pago e observações. O total é sempre calculado no banco.
- Cliente e serviço de um pedido precisam ser da mesma lavanderia (chave estrangeira composta).
- Funcionário (staff) cria clientes e pedidos; serviços, preços e exclusões são só do dono.
- Visitante anônimo não lê nenhuma tabela.

## Testes do banco

Com um PostgreSQL 14+ local:

```bash
PGHOST=localhost PGUSER=postgres ./supabase/tests/run_local.sh
```

Resultado da última execução: **99 de 99 testes passaram** (15 da Etapa 1, 15 da Etapa 2, 7 de endereços, 47 do onboarding dinâmico e 15 do marketplace), incluindo isolamento
entre duas lavanderias (usuário B não lê, não altera, não apaga e não usa clientes, serviços ou pedidos do usuário A,
nem forjando o id), numeração sequencial, transições de status e permissões de funcionário.

## Pendências conhecidas

- Fotos dos calçados no pedido, link público de rastreio (`tracking_token` já existe na tabela) e pagamentos
  parciais ficam para as próximas etapas.
- Os e-mails do Supabase vêm em inglês até você traduzir os templates (passo 1.6).
- Domínio `limpaaqui.com.br`: decisão adiada; o app funciona em qualquer domínio.
