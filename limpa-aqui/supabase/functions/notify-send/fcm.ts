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

export type ServiceAccountProblem = "fcm_segredo_ausente" | "fcm_segredo_json_invalido" | "fcm_segredo_incompleto";

/** Reconstrói a chave privada no formato PEM a partir de qualquer texto que contenha o bloco BEGIN/END. */
function rebuildPem(text: string): string | null {
  const m = text.match(/-----BEGIN PRIVATE KEY-----([\s\S]*?)-----END PRIVATE KEY-----/);
  if (!m) return null;
  const b64 = m[1].replace(/\\n|\\r|[^A-Za-z0-9+/=]/g, "");
  if (b64.length < 100) return null;
  return `-----BEGIN PRIVATE KEY-----\n${b64.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----\n`;
}

/** Plano B: tira os 3 campos necessários direto do texto (colagem com quebras de linha trocadas, vírgula sobrando etc.). */
function salvage(text: string): ServiceAccount | null {
  const field = (name: string) => text.match(new RegExp(`["“”]${name}["“”]\\s*:\\s*["“”]([^"“”]+)["“”]`))?.[1]?.trim();
  const project_id = field("project_id");
  const client_email = field("client_email");
  const private_key = rebuildPem(text);
  return project_id && client_email && private_key ? { project_id, client_email, private_key } : null;
}

/** Só a forma do texto (tamanho e começo/fim), para diagnosticar colagem cortada sem expor o conteúdo. */
const shape = (t: string) => `len${t.length}${t.startsWith("{") ? "_abre" : ""}${t.endsWith("}") ? "_fecha" : ""}`;

/** Lê a conta de serviço; tolera erros comuns de colagem (espaços, aspas em volta, base64, quebras de linha). */
export function readServiceAccount(raw: string | undefined | null): { sa: ServiceAccount } | { problem: ServiceAccountProblem; detail?: string } {
  let text = (raw ?? "").trim();
  if (!text) return { problem: "fcm_segredo_ausente" };
  if ((text.startsWith("'") && text.endsWith("'")) || (text.startsWith('"') && text.endsWith('"') && !text.startsWith('"{'))) text = text.slice(1, -1).trim();
  if (!text.startsWith("{")) {
    try {
      const decoded = atob(text.replace(/\s/g, ""));
      if (decoded.trim().startsWith("{")) text = decoded.trim();
    } catch { /* não é base64 */ }
  }
  let sa: unknown;
  try {
    sa = JSON.parse(text);
    if (typeof sa === "string") sa = JSON.parse(sa); // JSON colado como texto entre aspas
  } catch {
    const rescued = salvage(text);
    return rescued ? { sa: rescued } : { problem: "fcm_segredo_json_invalido", detail: shape(text) };
  }
  const o = sa as Record<string, unknown>;
  if (typeof o?.project_id !== "string" || typeof o?.client_email !== "string" || typeof o?.private_key !== "string" || !o.private_key.includes("PRIVATE KEY")) {
    return { problem: "fcm_segredo_incompleto", detail: shape(text) };
  }
  return { sa: o as unknown as ServiceAccount };
}

export function parseServiceAccount(raw: string | undefined | null): ServiceAccount | null {
  const r = readServiceAccount(raw);
  return "sa" in r ? r.sa : null;
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
