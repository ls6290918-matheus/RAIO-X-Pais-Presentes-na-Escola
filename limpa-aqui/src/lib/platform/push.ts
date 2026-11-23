// Push: um provedor por plataforma, todos com a mesma interface.
//  * Web/PWA: Firebase Cloud Messaging no navegador (service worker próprio em /firebase-messaging-sw.js)
//  * Android/iOS (Capacitor, futuro): plugin nativo de push entrega o token FCM/APNs — mesma interface,
//    o backend (register_device + notify-send) já aceita as plataformas "android" e "ios"
import { isIosBrowser, isNative } from "./index";

export type PushState = "unsupported" | "not_configured" | "ios_needs_install" | "denied" | "default" | "granted";

export interface PushProvider {
  /** Situação atual neste aparelho, sem pedir nada ao usuário. */
  state(): Promise<PushState>;
  /** Pede permissão (se preciso) e devolve o token do aparelho. */
  enable(): Promise<string>;
  /** Devolve o token se a permissão já foi dada (não pergunta nada). */
  currentToken(): Promise<string | null>;
  /** Apaga o token deste aparelho no provedor. */
  disable(): Promise<void>;
}

const cfg = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};
const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;
export const pushConfigured = () => Boolean(cfg.apiKey && cfg.projectId && cfg.messagingSenderId && cfg.appId && vapidKey);

/** Navegador / PWA com Firebase Cloud Messaging. O SDK só é baixado quando a pessoa ativa as notificações. */
class WebFcmProvider implements PushProvider {
  private async messaging() {
    const [{ initializeApp, getApps }, m] = await Promise.all([import("firebase/app"), import("firebase/messaging")]);
    const app = getApps()[0] ?? initializeApp(cfg as Required<typeof cfg>);
    return { m, messaging: m.getMessaging(app) };
  }

  private async registration() {
    // a configuração pública vai na URL do service worker (ele não lê variáveis de ambiente)
    const q = new URLSearchParams({ projectId: cfg.projectId ?? "", messagingSenderId: cfg.messagingSenderId ?? "" });
    return navigator.serviceWorker.register(`/firebase-messaging-sw.js?${q}`, { scope: "/firebase-cloud-messaging-push-scope" });
  }

  async state(): Promise<PushState> {
    if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      return isIosBrowser() ? "ios_needs_install" : "unsupported";
    }
    if (!pushConfigured()) return "not_configured";
    const { isSupported } = await import("firebase/messaging");
    if (!(await isSupported().catch(() => false))) return isIosBrowser() ? "ios_needs_install" : "unsupported";
    return Notification.permission as PushState;
  }

  async enable(): Promise<string> {
    const st = await this.state();
    if (st !== "default" && st !== "granted") throw new Error(st);
    if (Notification.permission !== "granted" && (await Notification.requestPermission()) !== "granted") throw new Error("denied");
    return this.token();
  }

  async currentToken(): Promise<string | null> {
    if ((await this.state()) !== "granted") return null;
    return this.token().catch(() => null);
  }

  private async token(): Promise<string> {
    const { m, messaging } = await this.messaging();
    const token = await m.getToken(messaging, { vapidKey, serviceWorkerRegistration: await this.registration() });
    if (!token) throw new Error("no_token");
    return token;
  }

  async disable(): Promise<void> {
    if (!pushConfigured()) return;
    const { m, messaging } = await this.messaging();
    await m.deleteToken(messaging).catch(() => undefined);
  }
}

/** App nativo (Capacitor): reservado para a fase do aplicativo. Responde "não suportado" até o plugin existir. */
class NativePushProvider implements PushProvider {
  async state(): Promise<PushState> {
    return "unsupported";
  }
  async enable(): Promise<string> {
    throw new Error("unsupported");
  }
  async currentToken(): Promise<string | null> {
    return null;
  }
  async disable(): Promise<void> {}
}

let provider: PushProvider | null = null;
export function pushProvider(): PushProvider {
  provider ??= isNative() ? new NativePushProvider() : new WebFcmProvider();
  return provider;
}
