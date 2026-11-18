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

Financeiro, Agenda e Página pública aparecem no menu como "Em breve", desabilitados.

## Em produção

- **Site:** https://limpa-aqui-ls6290918-7294.vercel.app (projeto `limpa-aqui` na Vercel)
- **Banco:** projeto Supabase "Limpa aqui _ Supabase" (`uiokoaqzyhuyzrqpoqkl`), com as migrations das Etapas 1 e 2 aplicadas.
- As variáveis `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` estão gravadas no projeto da Vercel.
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

Resultado da última execução: **30 de 30 testes passaram** (15 da Etapa 1 e 15 da Etapa 2), incluindo isolamento
entre duas lavanderias (usuário B não lê, não altera, não apaga e não usa clientes, serviços ou pedidos do usuário A,
nem forjando o id), numeração sequencial, transições de status e permissões de funcionário.

## Pendências conhecidas

- Fotos dos calçados no pedido, link público de rastreio (`tracking_token` já existe na tabela) e pagamentos
  parciais ficam para as próximas etapas.
- Os e-mails do Supabase vêm em inglês até você traduzir os templates (passo 1.6).
- Domínio `limpaaqui.com.br`: decisão adiada; o app funciona em qualquer domínio.
