/* Service worker das notificações push do Limpa Aqui (FCM Web Push).
 * Sem SDK nem script externo: recebe a mensagem do FCM, mostra a notificação e abre o link ao tocar.
 * Não guarda páginas em cache (o app continua sempre atualizado). */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let msg = {};
  try {
    msg = event.data ? event.data.json() : {};
  } catch (e) {
    msg = { notification: { title: "Limpa Aqui", body: event.data ? event.data.text() : "" } };
  }
  const n = msg.notification || {};
  const data = msg.data || {};
  const link = (msg.fcmOptions && msg.fcmOptions.link) || data.link || "/";
  event.waitUntil(
    self.registration.showNotification(n.title || "Limpa Aqui", {
      body: n.body || "",
      icon: n.icon || "/icons/icon-192.png",
      badge: "/icons/badge-72.png",
      tag: data.notification_id || undefined, // o mesmo aviso não aparece duas vezes
      data: { link: link },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.link) || "/", self.location.origin);
  if (target.origin !== self.location.origin) return; // só abre páginas do próprio Limpa Aqui
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (new URL(c.url).origin === target.origin && "focus" in c) {
          c.navigate(target.href);
          return c.focus();
        }
      }
      return self.clients.openWindow(target.href);
    }),
  );
});
