# Limpa Aqui: auditoria de UX com referência no iFood (Etapas 1 e 2)

Data: 20/11/2026 · Base: commit `93f74d9`, no ar. Nada foi alterado para esta auditoria.
Referência: 12 telas do arquivo `iFood iOS Onboarding.zip`. Elas servem só como estudo de organização e UX: **nada de marca, textos, imagens ou cores do iFood**.

## 1. O que as 12 telas ensinam

| # | Tela do iFood | Princípio de UX | Como fica no Limpa Aqui |
|---|---|---|---|
| 01 | Abertura em cor sólida com o logo | Marca forte no primeiro segundo | Abertura petróleo com o logo do sorriso (PWA/carregamento inicial) |
| 02 | "Permitir localização" com prévia de card | Explicar **por que** pede a localização antes do pedido do navegador | "Ative a localização para ver quem lava perto de você", com prévia de um card de prestador e a alternativa "Digitar meu CEP" |
| 03 | Foto + "Já tenho conta" / "Criar conta" | Duas ações claras e uma só decisão por tela | Boas-vindas com ilustração própria, "Entrar" e "Criar conta" |
| 04–05 | "Qual é o seu e-mail?" com botão desativado até ficar válido | **Uma pergunta por tela**, rótulo flutuante, botão principal fixo embaixo | Cadastro em passos curtos com barra de progresso |
| 06 | Código de 6 dígitos + "Reenviar" | Confirmar o e-mail sem senha | Código OTP real do Supabase Auth (depende da decisão D1) |
| 07–09 | Telefone + SMS com contagem regressiva, erro e "Enviar via WhatsApp" | Erro no próprio campo, temporizador para reenviar | WhatsApp do usuário; validação por SMS só com provedor real (decisão D2) |
| 10–11 | "Complete as informações": nome e CPF, termos no rodapé | Pedir dados de identificação no fim, com termos ao continuar | Nome e sobrenome + aceite dos termos (já existe). **CPF não é pedido no cadastro**: só no Pix (já é assim) e do entregador |
| 12 | Home: endereço no topo, sino, grade de categorias com ícones, carrossel de banners, cards de ofertas, "Ver mais", barra inferior | Hierarquia: onde estou → o que procuro → ofertas → lista; navegação fixa embaixo | Home do cliente reorganizada (seção 4) |

## 2. O que já existe (e serve de base)

| Área | Já pronto | Situação diante da referência |
|---|---|---|
| Stack | React + Vite + TypeScript + Tailwind; Supabase Auth, RLS e RPCs | Mantém |
| Identidade | Petróleo `#102C35`, verde-água `#61D6C3`, névoa, grafite; Inter; logo do sorriso (`Logo`) | Mantém; vira **tokens documentados** |
| Componentes | `ui.tsx`: Button, Field, Input, Select, Textarea, Alert, Card, StatCard, Badge, EmptyState, Modal, loaders, Logo, PageHeader; `ProviderCard`, `OrderTracker`, `NotificationBell`, `PixCheckout`, barras inferiores do cliente e do prestador | Base boa; faltam busca, card de categoria, banner, OTP, progresso de passos, skeleton e avaliação |
| Entrada | Site institucional `/`, `/login` e `/cadastro` (e-mail + senha), `/comecar` com **4 opções** (Fase 1), aceite dos termos | Falta o fluxo em passos (uma pergunta por tela), a localização e a **escolha de mais de um perfil** de uma vez |
| Cliente | `/cliente` (início com busca, categorias, pedidos em andamento, perto de você), `/buscar`, `/p/:slug`, anúncios, propostas, pedidos, Pix, barra inferior (Início, Buscar, Pedidos, Conta) | Reorganizar no padrão da referência: endereço no topo, grade de categorias, banners, mural |
| Prestador | Painel de ganhos, pedidos, clientes, serviços, rotas, calculadoras, equipe, plano, oportunidades, barra inferior | Ajustes de navegação; agenda, capacidade e avaliações vêm do PRD |
| Entregador | `/entregas` (cadastro, corridas livres, aceitar, coletar e entregar) | Falta online/offline e o visual tipo app de corridas |
| Admin | Menu lateral, gráficos, categorias | Banners entram aqui |

## 3. Riscos e limites (não serão simulados)

1. **SMS de verificação do telefone** precisa de um provedor pago configurado no Supabase (Twilio, MessageBird, Vonage ou Textlocal). Hoje não há. Sem ele não existe validação real por SMS (D2).
2. **Código por e-mail (OTP)** funciona no Supabase, mas:
   - o modelo do e-mail precisa mostrar o código;
   - o envio padrão do Supabase tem limite baixo por hora, então o cadastro em produção trava sem **SMTP próprio**, como o Resend (D1).
3. **"Mensagens" na barra inferior** depende do chat (PRD Fase 2), que ainda não existe (D3).
4. **Avaliações (estrelas) nos cards**: ainda não há avaliações (PRD Fase 3). Até lá os cards **não mostram nota**, para não inventar.
5. **Banners**: precisam de cadastro pelo admin (tabela nova `banners`, com RLS). Sem banner ativo, o espaço não aparece.
6. **Contas atuais** entram com e-mail e senha. Qualquer novo fluxo mantém o login por senha funcionando.
7. **Fotos dos prestadores**: hoje existe só o logotipo; foto de capa e portfólio vêm com o PRD Fase 2.

## 4. Arquitetura visual e navegação proposta (Etapa 2)

```
/ (site)  →  Entrar | Criar conta
Criar conta:  [1 E-mail] → [2 Código ou senha] → [3 Nome e sobrenome] → [4 WhatsApp] → [5 Termos]
           → [6 O que você quer fazer? (marcar 1 ou mais)] → [7 Localização (permitir ou CEP)]
           → painel do primeiro perfil escolhido (os outros ficam em "Trocar de perfil")
```

| Perfil | Barra inferior (celular) | Topo |
|---|---|---|
| Cliente | Início · Buscar · Pedidos · Mensagens · Perfil | endereço atual (troca) · sino · avatar |
| Prestador (autônomo ou empresa) | Painel · Pedidos · **+** · Mensagens · Mais | nome do negócio · sino · avatar |
| Entregador | Corridas · Minhas corridas · Ganhos · Perfil | **botão Online/Offline** · sino |
| Admin | menu lateral (já feito) | |

**Home do cliente** (de cima para baixo):
1. Endereço atual (troca) e sino.
2. Busca "Qual serviço você precisa hoje?".
3. Grade de 8 categorias com ícone: Roupas, Tênis, Sapatos, Tapetes, Cortinas, Estofados, Higienização e Outros.
4. Carrossel de banners (só se houver banner ativo).
5. "Publicar o que preciso lavar" (mural).
6. Pedidos em andamento.
7. Prestadores perto de você: logo ou foto, nome, serviços, "a partir de R$", distância, prazo quando informado e "Ver serviços".
8. "Ver mais".

## 5. Design system (Etapa 3)

- **Tokens** (no Tailwind e documentados):
  - cores da marca já existentes + estados (sucesso, aviso, erro);
  - raio 12/16/24;
  - espaçamento em grade de 4;
  - sombras `card`/`float`;
  - tipografia Inter: 28/22/18/16/14/12.
- **Componentes novos ou reorganizados** em `src/components/shared/`:
  - `SearchBar`, `CategoryTile`, `BannerCarousel`, `ProviderCard` (já existe; padronizar), `ServiceCard`, `OrderCard` (já existe);
  - `StepHeader` (voltar, título e progresso), `OtpInput` (6 caixas, colar, erro, reenviar com tempo);
  - `BottomBar` única por perfil (unifica as duas que existem);
  - `Skeleton`, `EmptyState` (já existe), `Rating` (só aparece com nota real), `StickyAction` (botão principal fixo embaixo).
- Uma página interna `/design` (só para admin) mostrando os componentes, para conferir a consistência.

## 6. Plano de implementação

| Etapa | Entrega | Banco |
|---|---|---|
| 3. Design system | tokens + componentes acima; troca nas telas existentes sem mudar o comportamento | — |
| 4. Onboarding | boas-vindas; cadastro em passos; **várias opções marcadas de uma vez**; localização (navegador ou CEP); redireciona ao painel certo | `add_my_roles(roles[])` (vários de uma vez) |
| 5. Home do cliente | layout da seção 4; mural com fotos, quantidade e prazo; banners | `listing_photos`, colunas `quantity`/`desired_date` em `listings` (já previsto no PRD Fase 2); `banners` + aba no admin |
| 6. Painéis | prestador com Mensagens na barra; entregador com Online/Offline e visual de corridas | `couriers.online` (PRD Fase 4) |
| 7. Integração | tudo ligado a dados reais; sem dados fictícios | — |
| 8. Testes | E2E de cada fluxo (celular e computador), permissões e estados de erro; os testes de navegador passam a ficar no repositório | testes de banco das funções novas |

Mensagens/chat: se aprovado em D3, entra entre as Etapas 5 e 6, junto com o PRD Fase 2.

## 7. Decisões que precisam da aprovação do dono

- **D1 — Cadastro por e-mail:**
  - (a) código de 6 dígitos sem senha, como na referência. Exige configurar SMTP próprio e o modelo de e-mail antes de ligar.
  - (b) manter e-mail + senha, já organizado em passos.

  Recomendação: (b) agora, e (a) quando houver SMTP. O login por senha continua nos dois casos.
- **D2 — Telefone:**
  - (a) só pedir o WhatsApp, sem validar por SMS, até contratar um provedor;
  - (b) contratar provedor de SMS agora.

  Recomendação: (a).
- **D3 — "Mensagens":**
  - (a) construir o chat (PRD Fase 2) e ligar a aba;
  - (b) mostrar a aba como "em breve".

  Recomendação: (a), logo depois da home.
