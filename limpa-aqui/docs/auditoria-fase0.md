# Limpa Aqui: auditoria da Fase 0 (PRD Mestre v1.0)

Data: 20/11/2026 · Base: commit `e9ddd37` (branch `claude/new-session-mhq2ab`) e o projeto Supabase de produção.
Nada foi alterado para fazer esta auditoria.

## 1. Arquitetura atual

```
Navegador (React SPA)  ──supabase-js──►  Supabase (Postgres + RLS + Auth + Storage)
        │                                     │
        │  /functions/v1/syncpay  ◄───────────┤  Edge Function "syncpay" (Pix: cobrança, status, estorno, webhook)
        │                                     │      └─► API SyncPay (cash-in, consulta, estorno)
        └─ Google Maps (Places, mapa, rotas)  └─ Vault (credenciais da SyncPay)
Hospedagem do site: Vercel (build do repositório).
```

A regra de negócio fica **no banco**, em funções `security definer` com checagem de papel e em gatilhos.
A tela só chama essas funções. Por isso as regras valem mesmo que alguém chame a API direto.

## 2. Tecnologias

| Camada | Em uso | PRD sugere | Decisão proposta |
|---|---|---|---|
| Frontend | React 18 + Vite + TypeScript + Tailwind, componentes próprios (`ui.tsx`) | Next.js + shadcn/ui "caso compatível" | **Manter.** É um app logado, não precisa de SSR. Trocar o framework custaria semanas sem ganho para o MVP. |
| Backend | Supabase: Postgres, Auth, Storage, RLS, Edge Functions, Vault | Supabase | Igual |
| Tempo real | Avisos atualizados a cada 60 s | Supabase Realtime | Usar Realtime no chat e nos avisos (Fase 2) |
| Pagamentos | SyncPay (Pix) atrás de um adaptador (`syncpay.ts`) | SyncPay via adaptador | Igual. Falta o teste com dinheiro real |
| Mapas | Google Maps (Places, Directions) | Google ou Mapbox | Igual |
| Testes | 157 testes de banco (SQL); E2E Playwright e testes da Edge Function **fora do repositório** | Testes obrigatórios | Trazer os E2E para o repositório |

## 3. Estrutura de pastas

```
limpa-aqui/
  src/
    features/  account admin auth calculators client courier customers dashboard landing
               legal marketplace onboarding orders plan routes services settings team
    contexts/  AuthContext, BusinessContext (lavanderia + plano + recursos), RolesContext (perfis)
    components/ layout (AppLayout, Guards, NotificationBell…) e shared (ui, PixCheckout…)
    lib/       supabase, format, legal, syncpay, marketplace, pricing…
  supabase/
    migrations/  24 migrations versionadas (1 a 24)
    functions/syncpay/  index.ts + syncpay.ts
    tests/       testes de banco (run_local.sh)
  docs/        emails-supabase.md, esta auditoria
```

Cerca de 15,9 mil linhas de TypeScript. Os módulos do PRD já existem com nomes parecidos.

## 4. Tabelas no Supabase (45, todas com RLS ligada)

Os nomes do PRD foram **mapeados** para tabelas existentes; não serão criadas duplicadas.

| Grupo do PRD | Já existe | Equivalência / observação |
|---|---|---|
| Usuários e permissões | `profiles`, `user_roles`, `user_addresses`, `onboarding_profiles` | `provider_profiles` e `business_profiles` = `businesses` (+ `provider_type` autônomo/empresa); `courier_profiles` = `couriers`; `addresses` = `user_addresses` |
| Equipe | `business_members`, `team_invites` | Dono e funcionário; não há permissões finas |
| Catálogo | `service_categories`, `services`, `service_templates`, `business_categories`, `segment_modules`, `features`, `feature_rules`, `business_features` | Faltam `service_photos` e portfólio |
| Marketplace | `listings`, `proposals`, `service_areas` | Faltam `listing_photos`, `proposal_items`, `conversations`, `messages` |
| Operação | `orders`, `order_items`, `order_photos`, `customers`, `service_costs` | Faltam `order_status_history`, agenda e capacidade |
| Logística | `couriers`, `courier_areas`, `deliveries` (coleta e devolução separadas), `delivery_zones` | Faltam `delivery_events` e `delivery_proofs` |
| Financeiro | `payment_transactions`, `payment_webhook_events`, `external_payment_confirmations`, `platform_commissions`, `commission_rules`, `payouts`, `payout_accounts`, `financial_ledger` (imutável) | Estorno fica em `payment_transactions` (status + valores); `payment_splits` não existe porque **não há split real** (ver 10) |
| Assinaturas | `plans`, `plan_features`, `subscriptions`, `subscription_invoices` | Pagas por Pix |
| Geografia | `states`, `municipalities` (92 do RJ), `service_areas`, `courier_areas`, `delivery_zones` | Igual ao PRD |
| Comunicação | `notifications` | Faltam preferências, push e WhatsApp |
| Administração | `platform_settings`, `reserved_slugs` | Faltam `audit_logs`, cupons e banners |
| Reputação | — | **Faltam** `reviews`, `complaints`, `disputes` |

Storage: `logos` (público), `order-photos` (privado), `payment-evidence` (privado).
Banco: 152 funções e 46 gatilhos. Status de pedido hoje: `orcamento, recebido, em_lavagem, pronto, entregue, cancelado`.
Status de corrida: `disponivel, aceita, coletada, entregue, cancelada`.

## 5. Edge Functions

- `syncpay` (sem JWT do Supabase; valida o token do usuário por conta própria):
  - **Ações:** `checkout`, `status` e `refund` do pedido; `invoice_checkout` e `invoice_status` da mensalidade.
  - **Webhook:** `POST /syncpay/webhook` com assinatura HMAC, janela de 5 minutos e evento duplicado ignorado.

## 6. Políticas RLS

- Todas as 45 tabelas têm RLS. A verificação `tables_without_rls()` volta vazia.
- Leitura própria:
  - membro lê os dados da própria lavanderia;
  - cliente lê o próprio anúncio, endereço e pedido (estes por RPC);
  - entregador lê as corridas permitidas.
- Gravação sensível só por RPC: dinheiro, status, comissões, papéis e aprovação.
- `payment_webhook_events` e `reserved_slugs` não têm política: só o servidor acessa.
- Testes cobrem isolamento entre lavanderias, clientes e entregadores, admin e financeiro.

## 7. Integrações

- **SyncPay:** Pix de entrada, consulta, estorno e webhook. Credenciais no Vault; webhook 16347 cadastrado. Ainda **não houve transação real**.
- **Google Maps:** endereço, mapa e rotas. A chave fica só na Vercel.
- **ViaCEP:** preenchimento pelo CEP.
- **E-mail de login:** envio padrão do Supabase, que tem limite baixo. Falta SMTP próprio.

## 8. O que já funciona (em produção)

| Critério do PRD (seção 21) | Situação |
|---|---|
| Quatro perfis | **Sim.** Cliente, prestador (autônomo ou empresa), entregador e admin |
| Uma conta com vários perfis | **Sim no sistema** (`user_roles`, "Adicionar perfil" em /conta, troca no menu da conta). Você marcou "não": precisa me dizer onde não funcionou |
| Onboarding guiado | Parcial: /comecar tem **3** opções (o PRD pede 4) e o assistente de 5 passos da lavanderia salva o progresso |
| Publicar anúncios | Sim, mas **sem fotos, quantidade e prazo desejado** |
| Enviar propostas | Sim (uma por prestador por anúncio) |
| Comparar propostas | Lista na página do anúncio; falta a tela de comparação com avaliação e quantidade de serviços |
| Contratação direta | Sim (catálogo → pedido) |
| Empresas cadastram serviços | Sim (preço, categoria, tipo de cobrança) |
| Portfólio | **Não** |
| Comunicação (chat) | **Não** |
| Histórico de pedidos | Parcial: livro-razão financeiro, mas sem histórico de status com autor |
| Logística opcional | Sim (cliente leva, prestador busca ou entregador) |
| Coleta e devolução independentes | Sim (duas corridas, entregadores diferentes) |
| Entregadores aceitam corridas | Sim (só depois de aprovados) |
| Comprovantes de transferência | Parcial: fotos do pedido; falta código de confirmação e comprovante por corrida |
| Pagamentos híbridos registrados | Sim (app × direto separados, comissão e livro-razão) |
| Integração financeira testada | Só em simulação e assinatura; **falta o Pix real** |
| Admin acompanha a operação | Sim (painel, municípios, entregadores, logística, financeiro, pagamentos, planos) |
| Municípios configuráveis | Sim |
| RLS implementada e testada | Sim (157 testes) |
| Funciona no celular | Sim |
| Sem dados fictícios em produção | **Não ainda:** a conta, a lavanderia, o plano e a mensalidade de teste do Pix seguem lá |

Também prontos e fora da lista: gestão da lavanderia, assinaturas por Pix, avisos internos, termos com aceite, site institucional.

## 9. O que falta (pelo PRD)

1. Onboarding com **4 opções** ("trabalhar de casa" separado de "tenho lavanderia"), com o fluxo de autônomo: equipamentos, capacidade e disponibilidade.
2. Anúncio com fotos, quantidade e prazo desejado. Proposta com validade, edição ou cancelamento e encerramento de novas propostas pelo cliente.
3. **Chat** por anúncio ou pedido: tempo real, imagens, bloqueio e denúncia.
4. **Portfólio** e fotos de serviços.
5. **Histórico de status** do pedido (quem, quando, observação) e ciclo de status mais completo, com aguardando pagamento, concluído pelo cliente e em disputa.
6. **Avaliações** (cliente avalia prestador e entregador) e reputação no perfil e nas propostas.
7. **Disputas e denúncias**, com análise do admin e trava de repasse quando houver disputa aberta.
8. Entregador **online/offline**, comprovantes por corrida (código, foto, quantidade, estado) e documentos.
9. Agenda e capacidade diária do prestador.
10. Admin: usuários, pedidos, anúncios, disputas, categorias, cupons, banners e trilha de auditoria (`audit_logs`).
11. Preferências de aviso e base para push e WhatsApp.
12. Permissões finas de funcionários e várias unidades (só preparar).

## 10. Problemas técnicos encontrados

1. **Repasses não são split real.** Hoje o dinheiro do Pix pelo app entra na conta SyncPay da plataforma. O repasse ao prestador é **registrado** e pago pelo admin fora do sistema (manual).
   - O PRD proíbe simular split. A tela já diz "repasse manual", mas falta confirmar com a SyncPay se ela oferece cash-out, split ou retenção.
   - Até lá, o repasse continua manual, sem ser apresentado como automático.
2. **Pix real nunca testado:** sem isso a integração não pode ser dada como concluída (regra 18 do PRD).
3. **Dados de teste em produção:** a conta do teste do Pix ainda existe, até o teste ser feito.
4. **Testes E2E e da Edge Function fora do repositório** (estão só na sessão de trabalho). Precisam entrar no repositório.
5. **Status de pedido curto** (6 estados). Mudar exige cuidado: telas, gatilhos, comissões e testes dependem dele (ver plano).
6. **Avisos sem tempo real** (atualizam a cada 60 s).
7. **Pendências do dono do projeto:**
   - e-mail de contato (LGPD);
   - SMTP próprio;
   - proteção contra senhas vazadas no Supabase;
   - restringir a chave do Maps;
   - trocar o segredo da SyncPay;
   - domínio próprio.

## 11. Plano de implementação (sem quebrar o que existe)

Princípios:
- **Só acrescentar.** Colunas novas são opcionais, tabelas novas não substituem as atuais e funções antigas continuam respondendo.
- Cada fase tem migration, testes e E2E, e só começa depois da sua aprovação.

| Fase | Entrega | Migration(s) previstas |
|---|---|---|
| **1. Fundação (complemento)** | /comecar com 4 opções; fluxo "trabalhar de casa"; categorias do PRD (tapetes, cortinas, sapatos…) gerenciáveis no admin; conferir o "vários perfis" | `25_onboarding_categorias`: `businesses.equipment`, `daily_capacity`, `availability`; RPCs de categoria no admin |
| **2. Marketplace** | fotos, quantidade e prazo no anúncio; validade, edição e encerramento das propostas; tela de comparação; portfólio; **chat** em tempo real | `26_anuncio_proposta_v2` (`listing_photos`, colunas novas, `proposals.valid_until`); `27_portfolio` (`service_photos`, `portfolio_items`); `28_chat` (`conversations`, `messages`, `blocks`, bucket privado) |
| **3. Operação** | histórico de status com autor; "concluído" pelo cliente; avaliações; disputas e denúncias; agenda e capacidade | `29_historico_status` (`order_status_history` + gatilho); `30_reputacao` (`reviews`, `complaints`, `disputes`, trava de repasse em disputa) |
| **4. Logística** | entregador online/offline; comprovantes por corrida (código de 4 dígitos, foto, quantidade, estado); documentos; avaliação do entregador | `31_comprovantes_corrida` (`delivery_events`, `delivery_proofs`, `couriers.online`, bucket `courier-docs`) |
| **5. Financeiro** | Pix real; confirmar com a SyncPay cash-out/split (se houver, `payment_splits` + repasse pela API; se não, segue manual e conciliado); estorno ligado a disputa | `32_split` (só se a SyncPay oferecer) |
| **6. Admin e lançamento** | usuários, pedidos, anúncios, disputas, cupons, banners; `audit_logs`; E2E no repositório; testes de carga; limpeza dos dados de teste | `33_auditoria_admin` (`audit_logs`, `coupons`, `banners`) |

### Decisão que precisa da sua aprovação: status do pedido

O PRD lista 14 status em inglês. Proposta:
- **Manter** os 6 atuais, que já são usados em telas, gatilhos, comissões e testes.
- **Acrescentar** só o que muda o fluxo:
  - `aguardando_pagamento` (Pix pelo app ainda não pago);
  - `concluido` (o cliente confirmou que recebeu);
  - `em_disputa`.
- As etapas de logística (aguardando coleta, coletado, recebido pelo prestador, aguardando devolução, devolvido) **já existem nas corridas**. Elas aparecem na linha do tempo do pedido junto com o histórico, sem duplicar status.
- Resultado: o fluxo do PRD fica completo e nada do que funciona hoje quebra.
