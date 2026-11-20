# Limpa Aqui — Fase 1 (Etapas 1 e 2)

SaaS de gestão para lavanderias de tênis e calçados.
Stack: React + TypeScript + Vite + Tailwind CSS + Supabase (Auth, PostgreSQL, RLS).

## O que já está pronto

- **Nova home do cliente (Etapa 5):** endereço no topo (troca rápida), busca "Qual serviço você precisa hoje?" com sugestões das categorias, 8 categorias com ícones, banners cadastrados em Administração → Banners (só links internos; somem se não houver ativo), mural "Publique o que precisa" com quantidade, prazo e até 5 fotos (bucket privado `listing-photos`; só o cliente, o admin e prestadores da cidade veem), pedidos em andamento e prestadores perto. Barra inferior: Início, Buscar, Pedidos, Perfil.

- **Experiência inspirada na organização do iFood (Etapas 3–4):** cadastro em passos (uma pergunta por tela, barra de progresso, voltar sem perder dados; WhatsApp sem SMS); /comecar com **vários perfis de uma vez** e passo de localização (navegador ou CEP); componentes `StepScreen`, `StepTitle` e `Skeleton`. Plano completo em `docs/auditoria-ux-ifood.md`.

- **PRD Mestre — Fase 1 (fundação):** entrada com 4 opções (contratar, trabalhar de casa, lavanderia/empresa, entregas); assistente filtrado pelo caminho escolhido, com equipamentos, capacidade por dia e experiência para quem trabalha de casa (editáveis em Configurações → Perfil de trabalho); categorias do PRD (tapetes, higienização de calçados) gerenciadas em Administração → Categorias (criar, editar, desativar); "Adicionar outro perfil" no menu da conta. Auditoria em `docs/auditoria-fase0.md`.

- **Site institucional** em `/` (`src/features/landing/LandingPage.tsx`): capa, quem somos, serviços (levam à busca já filtrada), como funciona em 4 passos, área para lavanderias e entregadores e rodapé com os dados da empresa. Mostra quantos municípios já têm atendimento real.

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

### Marketplace — Etapa 3 (prestador no marketplace e busca pública)
- Configurações → **No marketplace** (dono): municípios atendidos (`service_areas`, até 30), "Faço coleta e
  devolução", pagamento direto (o pagamento pelo app aparece como "em breve"), descrição pública e o interruptor
  **Aparecer na busca**. Ele só liga pela RPC `set_marketplace_visible`, que exige município do RJ, 1 serviço ativo
  com preço, 1 área de atendimento e 1 forma de pagamento (`marketplace_requirements` lista o que falta). Mudança
  direta em `marketplace_visible` ou `accepts_app_payment` é bloqueada pelo gatilho. Lavanderias existentes começam
  fora da busca.
- `/buscar` (pública, sem login): município (só os com "Operação ativa" e com prestador visível —
  `marketplace_municipalities`), serviço e "Usar minha localização"; logado, usa o endereço principal e já escolhe o
  município. Resultados por distância em linha reta (`distance_km`, Haversine) via `search_providers`.
- `/p/:slug` (pública): perfil com serviços e preços, municípios atendidos, horário, coleta e pagamento
  (`get_public_provider`). Rua, número e WhatsApp nunca saem nessas funções. "Contratar" chega na Etapa 4.
- Visitantes não leem nenhuma tabela: tudo passa por essas funções (inclusive `public_categories`).

### Marketplace — Etapa 4 (anúncios, propostas e contratação)
- **Anúncio** (`listings`): o cliente descreve o que precisa (categoria, título, detalhes, endereço, se quer coleta)
  em "Meus anúncios" (`create_listing`, até 10 abertos, valem 14 dias). Prestadores só veem bairro e município.
- **Oportunidades** (`/app/oportunidades`, dono): anúncios abertos nos municípios que a lavanderia atende
  (`provider_open_listings`); **proposta** (`proposals`, uma por lavanderia por anúncio) com valor, prazo, mensagem e
  se busca/entrega (`send_proposal`, `withdraw_proposal`). Só quem aparece na busca propõe; ninguém vê a proposta do
  concorrente.
- **Contratação**, sempre por RPC, mostrando antes de confirmar como os itens vão e voltam e a forma de pagamento:
  `accept_proposal` (cliente escolhe uma proposta; as outras são recusadas) ou `hire_services` (pelo perfil público,
  com o preço do catálogo; serviços "sob orçamento" só por anúncio). Ambas usam `marketplace_place_order`, que cria o
  pedido em `orders` com `origin = marketplace`, `payment_mode` e `logistics_mode`, e liga ou cria a ficha do cliente
  na lavanderia (`customers.user_id`, ou o mesmo WhatsApp já cadastrado) com o endereço escolhido.
- Por enquanto: pagamento **direto ao prestador** (pelo app na Etapa 5b) e logística **sem logística** ou
  **o próprio prestador busca e entrega** (entregadores na Etapa 6). Exige WhatsApp na conta do cliente.
- O pedido aparece no painel com o selo "Limpa Aqui" e em "Meus pedidos" do cliente com a modalidade.
- Apagar a conta do cliente apaga os anúncios e mantém o pedido na lavanderia, sem o vínculo
  (chaves de `orders.listing_id`/`proposal_id` verificadas no fim da operação).

### Marketplace — Etapa 5a (pagamento direto, comissões e livro-razão)
- **Regras de comissão** (`commission_rules`), só pelo admin em Administração → Financeiro: percentual e/ou valor fixo
  por modalidade de pagamento, opcionalmente por serviço e/ou município. Sem regra, nenhuma comissão. Nova regra
  encerra a do mesmo recorte (histórico mantido); a mais específica vence; vale para pedidos feitos depois dela.
- **Comissão por pedido** (`platform_commissions`): criada quando o pedido do marketplace ganha valor, pela regra
  vigente na data do pedido (`prevista`); vira `a_cobrar` quando o prestador confirma o recebimento (sobre o valor
  recebido); `cancelada` se o pedido for cancelado; o admin marca `paga`. O dono vê a comissão no pedido.
- **Pagamento direto** (`external_payment_confirmations`): no pedido do marketplace, "Confirmar recebimento"
  (valor, forma — Pix, dinheiro, cartão, outro — e comprovante opcional no bucket privado `payment-evidence`).
  Uma vez só; o "pago" desses pedidos não muda pelo interruptor. O cliente vê "Pagamento confirmado".
- **Livro-razão** (`financial_ledger`): pedido, comissão prevista/a cobrar/paga/cancelada, pagamento confirmado,
  pedido cancelado e criação/encerramento de regras. Só inclusão: nem o dono do banco altera ou apaga um lançamento.
- **Resumo** (`admin_finance_summary`) separado por modalidade: pagamento direto é "declarado" pelo prestador e nunca
  somado ao que entra pelo app.

### Marketplace — Etapa 6 (logística opcional com entregadores)
- **Entregador** (`/entregas`): cadastra veículo, só os 4 últimos números do CPF, WhatsApp e municípios onde atende
  (`couriers`, `courier_areas`, `save_courier_profile`). A aprovação continua sendo do admin (perfil "entregador").
- **Tarifas por município** (`delivery_zones`, Administração → Logística): taxa base, valor por km, mínimo, fator de
  rota (ruas não são linha reta) e distância máxima — nada fixo no código. Um município "tem logística" quando tem
  tarifa ativa e pelo menos 1 entregador aprovado que atende lá (`municipality_has_logistics`).
- **Cotação antes de confirmar** (`quote_delivery`, `quote_proposal_delivery`): distância em linha reta × fator de
  rota; corrida = base + km × valor, nunca abaixo do mínimo; o pedido tem 2 corridas (coleta e devolução). Precisa das
  coordenadas do endereço do cliente (busca do Google no cadastro) e da lavanderia.
- **Corridas** (`deliveries`, independentes): a coleta nasce com o pedido; a devolução, quando a lavanderia marca
  "pronto" (gatilho `order_logistics`). Cada uma pode ter um entregador diferente. Antes de aceitar, o entregador vê
  só bairros, distância e valor (`courier_available_deliveries`); depois de aceitar, endereços completos, WhatsApp e
  link de rota (`my_deliveries`). Coletei → Entreguei (`advance_delivery`) ou Desistir (`release_delivery`, antes de
  coletar). Devolução entregue marca o pedido como entregue. Cancelar o pedido cancela as corridas pendentes.
- No pagamento direto, o cliente paga cada corrida ao entregador; a conclusão vai para o livro-razão
  (`corrida_criada`, `corrida_concluida`). A lavanderia e o cliente acompanham as corridas no pedido.

### Marketplace — Etapa 7 (painel administrativo)
- Administração → **Painel** (aba inicial), com filtro de período (7 dias, 30 dias, este mês, mês passado ou datas):
  - **Pedidos e dinheiro por modalidade** (`admin_dashboard`): pedidos, valor, pagamentos confirmados, valor recebido e
    cancelados, com "direto (declarado)" e "pelo app" em colunas separadas — o externo nunca é somado ao processado.
  - **Comissões**: geradas, previstas, a cobrar, pagas e o total a cobrar hoje.
  - **Logística**: pedidos por tipo de logística, corridas concluídas e valor, fila de corridas, entregadores
    aprovados e aguardando.
  - **Cobertura**: municípios cadastrados, com operação ativa, com prestadores na busca, com logística, ativos sem
    logística e suspensos.
  - **Marketplace**: clientes, prestadores na busca (autônomos/empresas), anúncios, propostas, pedidos por anúncio/perfil.
- **Conciliação** (`admin_reconciliation`): pedidos de pagamento direto prontos/entregues (ou com mais de 7 dias) sem
  confirmação do prestador, e comissões a cobrar agrupadas por prestador.
- **Repasses a entregadores** (`admin_courier_report`): corridas e valores por entregador no período, com CSV.
- **Livro-razão** (`admin_ledger`): eventos do período com prestador e pedido, filtro por evento e exportação CSV
  (separador ";" e acentos corretos no Excel).
- Repasses a prestadores e entregadores do pagamento pelo app ficam em Administração → Pagamentos pelo app (Etapa 5b).

### Marketplace — Etapa 5b (pagamento pelo app: Pix via SyncPay)
- **Modelo:** todo pagamento pelo app entra na conta SyncPay do Limpa Aqui. A plataforma retém a comissão (regra de
  comissão da modalidade `app`) e registra o **repasse** devido a cada prestador e entregador; o admin paga pelo Pix do
  banco e marca como pago. Nada de taxa fixa no código: liga/desliga e valor mínimo ficam em `platform_settings` (admin).
- **CPF:** o cliente digita o CPF a cada pagamento; ele vai direto para a SyncPay e **não é gravado** (nem no banco,
  nem nos logs, nem no livro-razão — o CPF que volta nos avisos da SyncPay também é descartado).
- **Banco** (`20261204000018_pagamento_app.sql`): `payment_transactions` (cobranças; o status só muda pelo gateway),
  `payment_webhook_events` (deduplicação), `payouts` (repasses: pendente, bloqueado, pago, cancelado),
  `payout_accounts` (chave Pix de repasse da lavanderia — só o dono — ou do entregador), `platform_settings`.
  - Pedido pelo app nasce "aguardando pagamento": não avança nem muda de valor até o Pix ser confirmado; com entregador,
    a corrida de coleta só é criada depois do pagamento. O valor cobrado é serviço + taxas de entrega.
  - `completed` → pedido pago, comissão retida, repasse ao prestador (total − comissão); corrida concluída → repasse
    ao entregador. Taxa do gateway (valor bruto − líquido) vai ao livro-razão.
  - `med`/`refunding` suspendem os repasses; voltando a `completed`, liberam. `refunded`/`chargeback` cancelam pedido,
    comissão e repasses pendentes; repasse já pago vira "a recuperar" no livro-razão.
  - Pix pago em duplicidade, de pedido cancelado ou com valor diferente vira **"a devolver"**; o admin estorna pela tela.
  - Funções que aplicam resultado do gateway só rodam como servidor (`service_role`).
- **Edge Function `syncpay`** (`supabase/functions/syncpay/`, Deno, sem dependências):
  - `POST /functions/v1/syncpay` com o login do usuário: `checkout` (gera ou reaproveita o Pix do pedido), `status`
    ("Já paguei": consulta a SyncPay no máximo 5 vezes por cobrança, a partir de 1 minuto), `refund` (admin).
  - `POST /functions/v1/syncpay/webhook`: aviso `transaction.updated` com assinatura HMAC (`X-SyncPay-Signature`,
    janela de 5 minutos, deduplicado por `event_id`). Aviso sem assinatura nunca é confiado: só dispara uma consulta
    direta à SyncPay. Token de acesso reaproveitado por 1 hora.
  - Segredos (nunca no código): `SYNCPAY_CLIENT_ID`, `SYNCPAY_CLIENT_SECRET`, `SYNCPAY_WEBHOOK_SECRET` — nos segredos
    da Edge Function ou, se faltarem lá, no **Vault** do Supabase (`vault.create_secret('<valor>', '<NOME>')`), lido pela
    função `syncpay_config()`, que só o servidor chama (migração `20261206000020_syncpay_vault.sql`). Publicada com verificação de JWT desligada (o webhook não tem login; as ações do
    usuário são validadas pelo banco com o token dele).
- **Telas:** opção "Pelo app, com Pix" ao contratar (perfil e proposta); `/cliente/pagar/:id` com CPF, QR Code,
  copia e cola, "Já paguei" e atualização automática; "Aguardando Pix" para o prestador (lista e pedido); chave Pix e
  interruptor "Pagamento pelo app" em Configurações; "Recebimentos pelo app" para o entregador; aba
  **Pagamentos pelo app** no admin (liga/desliga, repasses com chave Pix, cobranças a devolver com estorno) e bloco
  "Dinheiro que passa pela plataforma" no Painel.
- **Para funcionar de verdade** (passos do dono da conta SyncPay): criar a chave de API (Consulta, Venda, Rastreio),
  gravar os 3 segredos no Supabase, cadastrar o webhook `https://<projeto>.supabase.co/functions/v1/syncpay/webhook`
  (evento `transaction`) e pedir à SyncPay a liberação de IP (Edge Functions não têm IP fixo). Só então ligar em
  Administração → Pagamentos pelo app.


### Marketplace — Etapa 8 (planos e assinaturas dos prestadores)
- **Planos editáveis pelo admin** (`plans`, `plan_features`; Administração → Planos): nome, preço, período em dias,
  recursos liberados (do catálogo `features`), limite de pedidos de balcão por mês, limite de funcionários, destaque na
  busca, visível/ativo. Nada de preço fixo no código.
- **Plano padrão "Grátis"** (`is_default`): sempre gratuito e ativo, libera todos os recursos que existem hoje — quem não
  assina (incluindo lavanderias antigas) não perde nada.
- **Plano que vale** (`business_plan_id`): assinatura ativa e dentro do período + tolerância (`platform_settings.subscription_grace_days`,
  padrão 5 dias, editável); senão, o padrão. Calculado na hora, sem rotina agendada.
- **Mensalidade por Pix** (`subscription_invoices`): o dono escolhe o plano em **Meu plano** (`/app/plano`), paga pelo mesmo
  fluxo de Pix da Etapa 5b (CPF não guardado; ações `invoice_checkout`/`invoice_status` da função `syncpay`). Pago → plano
  ativo pelo período; renovar antes do fim soma os dias; estorno da mensalidade cancela o período; Pix de mensalidade já paga
  ou cancelada vira "a devolver". Sem repasse (a mensalidade é receita da plataforma).
- **Limites no banco:** pedidos de balcão por mês (gatilho em `orders`; pedidos do marketplace nunca são barrados) e
  funcionários (gatilho em `business_members`; trocar para um plano menor que a equipe atual é recusado).
- **Recursos fora do plano** somem do menu e a tela mostra "não faz parte do plano X" com link para os planos.
  (Os recursos de tela são bloqueados na interface; limites numéricos são garantidos pelo banco.)
- **Destaque:** `search_providers` devolve `featured` e ordena quem tem plano com destaque primeiro (selo na busca).
- **Admin:** assinantes pagantes, MRR, recebido em 30 dias, em tolerância/vencidos, lista de assinaturas, cortesia
  (`admin_grant_plan`, até uma data ou sem fim) e tolerância.

### Termos de Uso e Política de Privacidade
- Páginas públicas `/termos` e `/privacidade` (texto em `src/features/legal/LegalPages.tsx`; dados da empresa e versão em
  `src/lib/legal.ts`). Links no rodapé das páginas públicas e do login/cadastro.
- Cadastro exige marcar "Li e aceito"; a versão aceita e a data ficam em `profiles.terms_version`/`terms_accepted_at`.
- Contas antigas (ou quando `TERMS_VERSION` muda) veem um aviso único ao entrar e aceitam (`accept_terms`).
- Os textos são um modelo inicial: revise com um advogado antes da abertura comercial.
### Avisos (notificações no app)
- Tabela `notifications` (cada pessoa só vê as suas; "lido" por `mark_notifications_read`). Sininho com contador ao lado
  do menu da conta, atualizado a cada minuto e ao voltar para a aba.
- Gerados no banco por gatilhos: pedido novo do marketplace (equipe da lavanderia), Pix confirmado (cliente e prestador),
  situação do pedido para o cliente (em lavagem, pronto, entregue, cancelado), proposta nova (anunciante) e aceita (dono),
  corrida disponível (entregadores aprovados do município), repasse pago e plano ativado. Uma falha ao avisar nunca
  desfaz o evento.
- `emailed_at` já existe para o envio por e-mail, que entra quando houver um serviço de envio (Resend/Brevo) configurado.

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
   13. `20261129000013_marketplace_prestador.sql`
   14. `20261130000014_contratacao.sql`
   15. `20261201000015_pagamento_direto.sql`
   16. `20261202000016_logistica.sql`
   17. `20261203000017_painel_admin.sql`
   18. `20261204000018_pagamento_app.sql`
   19. `20261205000019_assinaturas.sql`
   20. `20261206000020_syncpay_vault.sql`
   21. `20261207000021_aceite_termos.sql`
   22. `20261208000022_avisos.sql`
   23. `20261209000023_painel_prestador.sql`
   24. `20261210000024_admin_series.sql`
   25. `20261211000025_fundacao_perfis.sql`
   26. `20261212000026_cadastro_whatsapp.sql`
   27. `20261213000027_home_mural_banners.sql`

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

Resultado da última execução: **162 de 162 testes passaram** (15 da Etapa 1, 15 da Etapa 2, 7 de endereços, 47 do onboarding dinâmico, 68 do marketplace, 1 do aceite dos termos, 2 dos avisos, 1 do painel do prestador, 1 dos gráficos do admin , 3 da fundação do PRD Mestre e 2 da nova home), incluindo isolamento
entre duas lavanderias (usuário B não lê, não altera, não apaga e não usa clientes, serviços ou pedidos do usuário A,
nem forjando o id), numeração sequencial, transições de status e permissões de funcionário.

## Pendências conhecidas

- Fotos dos calçados no pedido, link público de rastreio (`tracking_token` já existe na tabela) e pagamentos
  parciais ficam para as próximas etapas.
- Os e-mails do Supabase vêm em inglês até você traduzir os templates (passo 1.6).
- Domínio `limpaaqui.com.br`: decisão adiada; o app funciona em qualquer domínio.
