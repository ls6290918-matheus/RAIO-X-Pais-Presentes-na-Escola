# Limpa Aqui — Fase 1, Etapa 1 (Fundação)

SaaS de gestão para lavanderias de tênis e calçados.
Stack: React + TypeScript + Vite + Tailwind CSS + Supabase (Auth, PostgreSQL, RLS).

## O que esta etapa entrega

- Identidade visual (paleta do PRD, fonte Inter), painel com menu lateral e menu mobile.
- Cadastro com confirmação de e-mail, login, recuperação e redefinição de senha.
- Onboarding: nome da lavanderia, endereço público (slug) com verificação em tempo real, WhatsApp, cidade, UF e bairro.
- Dashboard inicial (sem números fictícios) e tela de Configurações que salva no banco.
- Banco multiempresa com RLS em todas as tabelas, testado com 15 testes automáticos.

Módulos das próximas etapas aparecem no menu como "Em breve", desabilitados.

## Como colocar no ar

### 1. Criar o projeto no Supabase

1. Crie uma conta em https://supabase.com e um projeto novo (região: São Paulo).
2. Abra **SQL Editor**, cole todo o conteúdo de `supabase/migrations/20261118000001_etapa1_fundacao.sql` e clique em **Run**.
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
  features/     auth, onboarding, dashboard, settings
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

Funções: `is_business_member`, `is_business_owner` (usadas pelo RLS), `check_slug_available`,
`create_business` (cria lavanderia + dono + configurações numa transação) e `tables_without_rls` (diagnóstico).

Regras de segurança:

- O navegador não insere nem apaga lavanderias ou membros; só a função `create_business` faz isso.
- Membros leem os dados da própria lavanderia; só o dono edita.
- Slug e numeração de pedidos são protegidos por trigger.
- Visitante anônimo não lê nenhuma tabela.

## Testes do banco

Com um PostgreSQL 14+ local:

```bash
PGHOST=localhost PGUSER=postgres ./supabase/tests/run_local.sh
```

Resultado da última execução: **15 de 15 testes passaram**, incluindo isolamento entre duas lavanderias
(usuário B não lê, não altera e não apaga dados do usuário A, nem forjando o id).

## Pendências conhecidas

- Os e-mails do Supabase vêm em inglês até você traduzir os templates (passo 1.6).
- Domínio `limpaaqui.com.br`: decisão adiada; o app funciona em qualquer domínio.
