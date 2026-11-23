# Notificações push (FCM) — o que configurar fora do código

O código já está pronto. Enquanto os passos abaixo não forem feitos, o app mostra
"As notificações no celular ainda estão sendo configuradas" e **nada é enviado** (o sino do app continua
funcionando normalmente).

## 1. Firebase (você)

1. Acesse <https://console.firebase.google.com> e crie o projeto **Limpa Aqui** (o Google Analytics é opcional).
2. Em **Configurações do projeto → Geral → Seus apps**, adicione um **app Web** (ícone `</>`), com o nome "Limpa Aqui Web".
   Não precisa do Firebase Hosting.
3. Copie os valores **públicos** mostrados (`apiKey`, `projectId`, `messagingSenderId`, `appId`). Eles podem ir no chat:
   não são segredo.
4. Em **Configurações do projeto → Cloud Messaging → Configuração da Web → Certificados push da Web**, clique em
   **Gerar par de chaves** e copie a **chave pública (VAPID)**. Também é pública.
5. Em **Configurações do projeto → Contas de serviço**, clique em **Gerar nova chave privada**. Baixa um arquivo JSON.
   **Esse arquivo é segredo: não envie no chat.** Guarde-o no Supabase:
   **Supabase → Edge Functions → Secrets → Add new secret**, nome `FCM_SERVICE_ACCOUNT`, valor = todo o conteúdo do JSON.

## 2. Vercel (eu faço, com os valores públicos do passo 1)

Variáveis de ambiente do projeto `limpa-aqui` (Production):
`VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`,
`VITE_FIREBASE_VAPID_KEY`. Depois, um novo deploy.

## 3. Supabase (eu faço, com a sua autorização)

1. Aplicar as migrations 38 (extensões `pg_net` e `pg_cron`) e 39 (notificações).
2. Publicar a Edge Function `notify-send` com **verify_jwt desligado** (quem chama é o banco, com o segredo
   gerado dentro do próprio banco; nenhum segredo passa pelo chat).
3. Ligar o envio (só depois do segredo `FCM_SERVICE_ACCOUNT` existir):
   ```sql
   update public.notify_dispatch_config
      set endpoint = 'https://uiokoaqzyhuyzrqpoqkl.supabase.co/functions/v1/notify-send', enabled = true
    where id;
   ```
   Para desligar a qualquer momento: `update public.notify_dispatch_config set enabled = false where id;`
   (os avisos continuam no sino; os pushes ficam pendentes e saem quando religar, por até 1 dia).

## 4. Teste em aparelhos reais (você)

- **Android (Chrome)**: abra o site, entre, vá em **Conta → Notificações → Ativar neste aparelho** e permita.
  Feche o navegador e peça para alguém mandar uma mensagem no chat ou mude a situação de um pedido.
- **iPhone (iOS 16.4 ou mais novo)**: no Safari, **Compartilhar → Adicionar à Tela de Início**, abra o Limpa Aqui pelo
  ícone e ative em **Conta → Notificações**. No navegador comum o iOS não entrega push (limitação da Apple).
- **Computador (Chrome/Edge/Firefox)**: igual ao Android.

## Limitações conhecidas

- **iPhone sem instalar na tela de início**: não recebe push (regra do iOS).
- **App nativo (Capacitor, futuro)**: Android usa o mesmo FCM; iOS exige conta Apple Developer (US$ 99/ano) e a
  **chave APNs (.p8)** enviada ao Firebase (Configurações → Cloud Messaging → Configuração do app Apple).
- O navegador/sistema pode atrasar ou agrupar notificações para economizar bateria; entrega garantida não existe em push.
- Se a pessoa bloquear as notificações no navegador, só ela pode liberar (nas configurações do navegador).

## Como acompanhar

- **Admin**: `select public.admin_notification_stats();` (aparelhos ativos, envios dos últimos 7 dias, principais erros).
- Falha definitiva (3 tentativas) gera um aviso para os administradores, no máximo 1 por hora.
- Tokens recusados pelo FCM (aparelho desinstalado/expirado) são desativados automaticamente.
