// Integração com a SyncPay (Pix). Sem dependências externas: só fetch e Web Crypto.
// Credenciais vêm dos segredos da função (nunca do código): SYNCPAY_CLIENT_ID, SYNCPAY_CLIENT_SECRET,
// SYNCPAY_WEBHOOK_SECRET (assinatura dos avisos). SYNCPAY_BASE_URL só existe para testes.

export const STATUSES = [
  "pending", "completed", "failed", "refused", "three_ds_failed", "refunding", "refunded", "chargeback", "med",
] as const;

export function onlyDigits(v: unknown): string {
  return String(v ?? "").replace(/\D/g, "");
}

// CPF com dígitos verificadores válidos (o CPF nunca é gravado: só segue para o gateway)
export function isValidCpf(value: unknown): boolean {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const digit = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

// X-SyncPay-Signature: t=<unix>,v1=<hex> ; assinado: "{t}.{corpo bruto}" ; janela de 5 minutos
export async function verifySignature(header: string | null, rawBody: string, secret: string, nowSec = Math.floor(Date.now() / 1000)): Promise<boolean> {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => {
    const i = p.indexOf("=");
    return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
  }));
  const t = Number(parts.t);
  const v1 = String(parts.v1 ?? "").toLowerCase();
  if (!Number.isFinite(t) || !/^[0-9a-f]{64}$/.test(v1) || Math.abs(nowSec - t) > 300) return false;
  return safeEqual(await hmacHex(secret, `${parts.t}.${rawBody}`), v1);
}

export class SyncPayError extends Error {
  constructor(public status: number, public body: unknown) {
    super(`SyncPay respondeu ${status}`);
  }
}

export class SyncPay {
  private token: string | null = null;
  private tokenExp = 0;

  constructor(private clientId: string, private clientSecret: string, private baseUrl = "https://api.syncpayments.com.br") {}

  private async call(method: string, path: string, body?: unknown, retry = true): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(path.endsWith("/auth-token") ? {} : { Authorization: `Bearer ${await this.accessToken()}` }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text.slice(0, 300); }
    if (res.status === 401 && retry && !path.endsWith("/auth-token")) {
      this.token = null; // token vencido: pede outro uma vez
      return this.call(method, path, body, false);
    }
    if (!res.ok) throw new SyncPayError(res.status, json);
    return json;
  }

  // Token vale 1 hora: reaproveita e renova com 5 minutos de folga
  async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExp) return this.token;
    const r = await this.call("POST", "/api/partner/v1/auth-token", { client_id: this.clientId, client_secret: this.clientSecret });
    if (!r?.access_token) throw new SyncPayError(500, "sem access_token");
    this.token = r.access_token;
    this.tokenExp = Date.now() + (Math.max(Number(r.expires_in) || 3600, 600) - 300) * 1000;
    return this.token!;
  }

  cashIn(input: { amount: number; description: string; webhookUrl: string; name: string; document: string; email: string; phone: string }) {
    return this.call("POST", "/api/partner/v1/cash-in", {
      amount: Number(input.amount.toFixed(2)),
      description: input.description,
      ...(input.webhookUrl ? { webhook_url: input.webhookUrl } : {}),
      client: { name: input.name, document: input.document, email: input.email, phone: input.phone },
    }) as Promise<{ pix_code: string; identifier: string }>;
  }

  // Conta no limite de 5 consultas por cobrança (controlado no banco)
  async transaction(identifier: string): Promise<{ status: string; amount?: number }> {
    const r = await this.call("GET", `/api/partner/v1/transaction/${encodeURIComponent(identifier)}`);
    return { status: String(r?.data?.status ?? ""), amount: r?.data?.amount };
  }

  refund(identifier: string, reason: string, details: string) {
    return this.call("POST", `/api/partner/v1/transaction/${encodeURIComponent(identifier)}/refund`, {
      reason, reason_details: details,
    }) as Promise<{ data?: { code?: string; status?: string } }>;
  }
}
