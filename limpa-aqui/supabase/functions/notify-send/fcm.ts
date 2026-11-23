// Cliente mínimo do Firebase Cloud Messaging (API HTTP v1) para a Edge Function notify-send.
// A credencial é a conta de serviço do Firebase (JSON), guardada como segredo da função
// (FCM_SERVICE_ACCOUNT). Nada disso vai para o navegador.

export type ServiceAccount = { project_id: string; client_email: string; private_key: string; token_uri?: string };
export type PushMessage = { title: string; body?: string | null; link?: string | null; kind: string; notificationId: string };
export type SendResult =
  | { ok: true; messageId: string }
  | { ok: false; invalidToken: boolean; retry: boolean; code: string };

type Fetch = typeof fetch;
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlText = (s: string) => b64url(new TextEncoder().encode(s));

function pemToDer(pem: string): ArrayBuffer {
  const body = pem.replace(/-----BEGIN [^-]+-----|-----END [^-]+-----|\s/g, "");
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0)).buffer as ArrayBuffer;
}

export function parseServiceAccount(raw: string | undefined | null): ServiceAccount | null {
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw);
    if (typeof sa?.project_id === "string" && typeof sa?.client_email === "string" && typeof sa?.private_key === "string") return sa;
  } catch { /* JSON inválido */ }
  return null;
}

export class Fcm {
  private token: { value: string; exp: number } | null = null;
  private pending: Promise<string> | null = null; // pedidos simultâneos dividem a mesma busca do token
  constructor(private sa: ServiceAccount, private fetchImpl: Fetch = fetch, private now: () => number = () => Date.now()) {}

  /** Token OAuth2 do Google (JWT assinado com a chave da conta de serviço), reaproveitado até perto de expirar. */
  async accessToken(): Promise<string> {
    const nowS = Math.floor(this.now() / 1000);
    if (this.token && this.token.exp - 60 > nowS) return this.token.value;
    this.pending ??= this.fetchToken(nowS).finally(() => (this.pending = null));
    return this.pending;
  }

  private async fetchToken(nowS: number): Promise<string> {
    const header = b64urlText(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const aud = this.sa.token_uri ?? "https://oauth2.googleapis.com/token";
    const claims = b64urlText(JSON.stringify({ iss: this.sa.client_email, scope: SCOPE, aud, iat: nowS, exp: nowS + 3600 }));
    const key = await crypto.subtle.importKey("pkcs8", pemToDer(this.sa.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
    const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`)));
    const assertion = `${header}.${claims}.${b64url(sig)}`;
    const res = await this.fetchImpl(aud, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || typeof body?.access_token !== "string") throw new Error(`oauth_${res.status}`);
    this.token = { value: body.access_token, exp: nowS + Number(body.expires_in ?? 3600) };
    return this.token.value;
  }

  /** Envia um push para um aparelho. Classifica o erro: token inválido (desativar), temporário (tentar de novo) ou definitivo. */
  async send(deviceToken: string, msg: PushMessage, appUrl: string): Promise<SendResult> {
    let access: string;
    try {
      access = await this.accessToken();
    } catch (e) {
      return { ok: false, invalidToken: false, retry: true, code: String((e as Error).message).slice(0, 60) };
    }
    const link = msg.link && msg.link.startsWith("/") ? `${appUrl}${msg.link}` : appUrl;
    const message = {
      token: deviceToken,
      notification: { title: msg.title.slice(0, 120), body: (msg.body ?? "").slice(0, 300) },
      data: { kind: msg.kind, link: msg.link ?? "/", notification_id: msg.notificationId },
      webpush: { fcm_options: { link }, notification: { icon: `${appUrl}/icons/icon-192.png`, badge: `${appUrl}/icons/badge-72.png` } },
      android: { priority: "high" },
      apns: { payload: { aps: { sound: "default" } } },
    };
    const res = await this.fetchImpl(`https://fcm.googleapis.com/v1/projects/${this.sa.project_id}/messages:send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && typeof body?.name === "string") return { ok: true, messageId: body.name };
    const fcmCode: string =
      body?.error?.details?.find?.((d: { errorCode?: string }) => d?.errorCode)?.errorCode ?? body?.error?.status ?? `http_${res.status}`;
    // só é "token inválido" quando o FCM diz isso do token; outro INVALID_ARGUMENT seria erro nosso (não desativa aparelho)
    const invalidToken = fcmCode === "UNREGISTERED" || (res.status === 400 && /registration token/i.test(String(body?.error?.message ?? "")));
    if (res.status === 401) this.token = null; // credencial vencida: pede outra na próxima
    const retry = !invalidToken && (res.status === 429 || res.status >= 500 || res.status === 401);
    return { ok: false, invalidToken, retry, code: fcmCode.slice(0, 60) };
  }
}
