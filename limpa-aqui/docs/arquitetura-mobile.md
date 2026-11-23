# Arquitetura para app nativo (Capacitor) e rastreamento futuro

**Decisão:** começar com PWA e preparar o Capacitor para o rastreamento em segundo plano. O backend não depende de
qual interface o entregador usa.

## O que já existe (Fase 1)

| Camada | Arquivo | Web/PWA (hoje) | Capacitor (futuro) |
|---|---|---|---|
| Plataforma | `src/lib/platform/index.ts` | detecta `web`/`pwa`; `deviceId()` estável por navegador | detecta `android`/`ios` via `window.Capacitor` |
| Push | `src/lib/platform/push.ts` | `WebFcmProvider` (FCM no navegador + `public/firebase-messaging-sw.js`) | `NativePushProvider` (hoje responde "não suportado"; trocar pelo plugin de push) |
| Localização | `src/lib/platform/location.ts` | `WebLocationProvider` (só com a tela aberta; `background = false`) | `NativeLocationProvider` (plugin de localização em segundo plano; `background = true`) |
| Registro do aparelho | `register_device(device_id, platform, token, nome)` | `platform` = `web`/`pwa` | `platform` = `android`/`ios`, mesmo RPC |
| Envio | Edge Function `notify-send` (FCM HTTP v1) | Web Push via FCM | Android via FCM; iOS via FCM + APNs |

Os componentes visuais não chamam o navegador direto: usam `pushProvider()` e `locationProvider()`. Trocar a
plataforma é trocar o provedor, sem mexer nas telas.

## Login no app nativo

O Supabase Auth funciona igual no Capacitor (o SDK guarda a sessão). Pontos para a fase do app:
- links de confirmação/recuperação de senha precisam de *deep link* (`limpaaqui://` ou App Links/Universal Links)
  cadastrado nas URLs de redirecionamento do Supabase;
- OTP de 6 dígitos (Subetapa 4) evita depender de link no celular.

## Rastreamento (Fase 5 — ainda não implementado)

Nada de posição é gravado nesta fase. O desenho previsto:

- **`courier_locations`**: só a **última posição** de cada entregador online (`geography(Point)` com índice GiST,
  precisão em metros, horário da leitura, online/offline). Atualizada no máximo a cada ~10 s e só com corrida ativa
  ou online.
- **Ao vivo para cliente/lavanderia**: **Realtime Broadcast** (canal por corrida), sem gravar cada ponto no banco.
- **Histórico**: opcional, só da corrida em andamento, com retenção curta (ex.: 30 dias) para disputas.
- **Consentimento**: o entregador aceita explicitamente o uso da localização ao ficar online; ficar offline para o
  envio imediatamente.
- **Segundo plano**: só no app nativo, com as permissões do Android ("Sempre permitir" + serviço em primeiro plano
  com notificação fixa) e do iOS ("Sempre" + *background modes: location*). No PWA a posição só é enviada com a tela aberta.
- **Despacho automático**: usa a última posição + PostGIS para escolher o entregador e envia a oferta por push
  (tipo de aviso já previsto: `corrida_*`, categoria "logística").
