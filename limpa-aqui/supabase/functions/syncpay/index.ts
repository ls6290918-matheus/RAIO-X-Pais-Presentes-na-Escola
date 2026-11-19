// Edge Function "syncpay": pagamento pelo app (Pix) do Limpa Aqui.
//   POST /functions/v1/syncpay            (com o login do usuário)
//        { action: "checkout", order_id, cpf? }  → gera (ou reaproveita) o Pix do pedido
//        { action: "status",   order_id }        → "Já paguei": consulta o gateway (limite de 5 por cobrança)
//        { action: "refund",   transaction_id, reason, details } → admin pede o estorno
//   POST /functions/v1/syncpay/webhook    (avisos da SyncPay; sem login, com assinatura HMAC)
// O CPF de quem paga só passa por aqui a caminho do gateway: nunca é gravado nem registrado em log.
import { isValidCpf, onlyDigits, STATUSES, SyncPay, SyncPayError, verifySignature } from "./syncpay.ts";

type Env = (name: string) => string | undefined;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REFUND_REASONS = ["buyer_withdrawal", "product_not_delivered", "product_divergent", "duplicate_charge", "unrecognized_purchase", "other"];

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

export function createHandler(env: Env) {
  const supabaseUrl = env("SUPABASE_URL") ?? "";
  const anonKey = env("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const webhookSecret = env("SYNCPAY_WEBHOOK_SECRET") ?? "";
  const webhookUrl = env("SYNCPAY_WEBHOOK_URL") ?? `${supabaseUrl}/functions/v1/syncpay/webhook`;
  const clientId = env("SYNCPAY_CLIENT_ID");
  const clientSecret = env("SYNCPAY_CLIENT_SECRET");
  const gateway = clientId && clientSecret ? new SyncPay(clientId, clientSecret, env("SYNCPAY_BASE_URL") || undefined) : null;

  // Chama uma função do banco: com o login do usuário (as regras do banco valem para ele) ou como servidor
  async function rpc<T = any>(fn: string, args: Record<string, unknown>, userToken: string | null): Promise<T> {
    const key = userToken ? anonKey : serviceKey;
    const bearer = userToken ?? (serviceKey.startsWith("sb_") ? null : serviceKey);
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: key, "Content-Type": "application/json", ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      body: JSON.stringify(args),
    });
    const text = await res.text();
    const body = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const msg = typeof body?.message === "string" ? body.message : "Erro ao falar com o banco.";
      if (res.status === 401 || body?.code === "PGRST301" || body?.code === "28000") throw new HttpError(401, "Faça login de novo para continuar.");
      if (body?.code === "42501") throw new HttpError(403, msg);
      if (res.status >= 500 && !body?.code?.match?.(/^(P0001|22023)$/)) {
        console.error("rpc", fn, res.status, body?.code);
        throw new HttpError(502, "Erro ao falar com o banco. Tente de novo.");
      }
      throw new HttpError(400, msg);
    }
    return body as T;
  }

  function requireGateway(): SyncPay {
    if (!gateway) throw new HttpError(503, "O pagamento pelo app ainda não está configurado. Escolha pagar direto ao prestador.");
    return gateway;
  }

  async function applyFromGateway(identifier: string) {
    const t = await requireGateway().transaction(identifier);
    if ((STATUSES as readonly string[]).includes(t.status)) {
      await rpc("app_payment_apply", { p_identifier: identifier, p_status: t.status, p_amount: t.amount ?? null }, null);
    }
    return t.status;
  }

  async function checkout(token: string, body: any) {
    if (!UUID.test(String(body?.order_id ?? ""))) throw new HttpError(400, "Pedido inválido.");
    const c = await rpc("app_payment_checkout", { p_order_id: body.order_id }, token);
    if (c.pending) {
      return { pix_code: c.pending.pix_code, amount: Number(c.pending.amount), created_at: c.pending.created_at, reused: true };
    }
    if (!body?.cpf) return { needs_cpf: true, amount: Number(c.amount) };
    if (!isValidCpf(body.cpf)) throw new HttpError(400, "CPF inválido. Confira os números.");
    const phone = onlyDigits(c.phone);
    if (!c.email || phone.length < 10) throw new HttpError(400, "Complete seu e-mail e WhatsApp na sua área de cliente para pagar pelo app.");

    let r: { pix_code: string; identifier: string };
    try {
      r = await requireGateway().cashIn({
        amount: Number(c.amount), description: c.description, webhookUrl: webhookSecret ? "" : webhookUrl,
        name: c.name, document: onlyDigits(body.cpf), email: c.email, phone,
      });
    } catch (e) {
      if (e instanceof HttpError) throw e;
      // não registra o corpo: pode conter dados pessoais
      console.error("cash-in falhou", e instanceof SyncPayError ? e.status : String(e));
      if (e instanceof SyncPayError && e.status === 422) throw new HttpError(400, "A SyncPay não aceitou esses dados. Confira o CPF e tente de novo.");
      throw new HttpError(502, "Não foi possível gerar o Pix agora. Tente de novo em instantes.");
    }
    if (!r?.identifier || !r?.pix_code) throw new HttpError(502, "Não foi possível gerar o Pix agora. Tente de novo em instantes.");
    const saved = await rpc("app_payment_register", {
      p_order_id: body.order_id, p_user_id: c.user_id, p_identifier: r.identifier, p_pix_code: r.pix_code, p_amount: c.amount,
    }, null);
    return { pix_code: saved.pix_code, amount: Number(saved.amount), created_at: saved.created_at, reused: false };
  }

  async function status(token: string, body: any) {
    if (!UUID.test(String(body?.order_id ?? ""))) throw new HttpError(400, "Pedido inválido.");
    const s = await rpc("app_payment_status_check", { p_order_id: body.order_id }, token);
    if (!s.query) return { paid: Boolean(s.paid), status: s.status, checked: false };
    try {
      const st = await applyFromGateway(s.identifier);
      return { paid: Boolean(s.paid) || st === "completed", status: st, checked: true };
    } catch (e) {
      if (e instanceof HttpError) throw e;
      console.error("consulta falhou", e instanceof SyncPayError ? e.status : String(e));
      return { paid: Boolean(s.paid), status: s.status, checked: false };
    }
  }

  async function refund(token: string, body: any) {
    if (!UUID.test(String(body?.transaction_id ?? ""))) throw new HttpError(400, "Cobrança inválida.");
    if (!REFUND_REASONS.includes(body?.reason)) throw new HttpError(400, "Escolha o motivo do estorno.");
    const details = String(body?.details ?? "").trim();
    if (details.length < 20 || details.length > 1000) throw new HttpError(400, "Descreva o caso com 20 a 1000 caracteres.");
    const p = await rpc("app_payment_refund_prepare", { p_transaction_id: body.transaction_id }, token);
    let r: any;
    try {
      r = await requireGateway().refund(p.identifier, body.reason, details);
    } catch (e) {
      if (e instanceof HttpError) throw e;
      const b = e instanceof SyncPayError ? (e.body as any) : null;
      console.error("estorno falhou", e instanceof SyncPayError ? e.status : String(e), b?.error);
      throw new HttpError(400, `A SyncPay recusou o estorno${typeof b?.message === "string" ? `: ${b.message}` : "."}`);
    }
    await rpc("app_payment_refund_mark", {
      p_transaction_id: body.transaction_id, p_code: String(r?.data?.code ?? "solicitado"), p_reason: body.reason, p_admin: p.admin_id,
    }, null);
    return { requested: true, code: r?.data?.code ?? null, status: r?.data?.status ?? null };
  }

  async function webhook(req: Request) {
    const raw = await req.text();
    const signature = req.headers.get("X-SyncPay-Signature");
    if (signature) {
      if (!(await verifySignature(signature, raw, webhookSecret))) return json({ error: "assinatura inválida" }, 401);
      const ev = JSON.parse(raw);
      const t = ev?.transaction;
      if (!t?.reference_id || !t?.status) return json({ result: "ignored" });
      const r = await rpc("app_payment_apply", {
        p_identifier: String(t.reference_id), p_status: String(t.status), p_event_id: ev.event_id ? String(ev.event_id) : null,
        p_amount: t.amount ?? null, p_net_amount: t.net_amount ?? null, p_end_to_end: t.end_to_end_id ?? null, p_paid_at: t.paid_at ?? null,
      }, null);
      return json(r);
    }
    // Aviso sem assinatura (padrão antigo): o conteúdo não é confiável → confere direto no gateway
    let id: unknown = null;
    let claimed: unknown = null;
    try {
      const b = JSON.parse(raw);
      id = b?.id ?? b?.data?.id ?? b?.transaction?.reference_id;
      claimed = b?.status ?? b?.data?.status ?? b?.transaction?.status;
    } catch { /* corpo inválido */ }
    if (typeof id !== "string" || id.length < 8 || id.length > 80 || claimed === "pending") return json({ result: "ignored" });
    const allowed = await rpc<boolean>("app_payment_claim_check", { p_identifier: id }, null);
    if (!allowed || !gateway) return json({ result: "ignored" });
    try {
      return json({ result: "checked", status: await applyFromGateway(id) });
    } catch (e) {
      console.error("conferência falhou", e instanceof SyncPayError ? e.status : String(e));
      return json({ result: "error" }, 502);
    }
  }

  return async function handler(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    try {
      const path = new URL(req.url).pathname;
      if (path.endsWith("/webhook")) {
        if (req.method !== "POST") return json({ error: "método" }, 405);
        return await webhook(req);
      }
      if (req.method !== "POST") return json({ error: "método" }, 405);
      const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
      if (!token || token === anonKey) throw new HttpError(401, "Faça login para continuar.");
      const body = await req.json().catch(() => null);
      switch (body?.action) {
        case "checkout": return json(await checkout(token, body));
        case "status": return json(await status(token, body));
        case "refund": return json(await refund(token, body));
        default: throw new HttpError(400, "Ação inválida.");
      }
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error("erro", String(e));
      return json({ error: "Erro inesperado. Tente de novo." }, 500);
    }
  };
}

// No Supabase a função sempre serve; nos testes ela é importada sem servir
if (import.meta.main ?? true) {
  Deno.serve(createHandler((n) => Deno.env.get(n)));
}
