// Edge Function "notify-send": entrega das notificações push do Limpa Aqui pelo FCM.
//   Chamada SOMENTE pelo banco (pg_net), com o cabeçalho x-notify-secret conferido no próprio banco:
//     { delivery_id }  → envia um aviso pendente para os aparelhos da pessoa
//     { retry: true }  → reenvia os pendentes/falhos (até 3 tentativas), chamado pelo pg_cron
// Segredos da função: FCM_SERVICE_ACCOUNT (JSON da conta de serviço do Firebase) e APP_URL (opcional).
// Tokens de aparelho e credenciais nunca vão para o log.
import { Fcm, readServiceAccount, type SendResult } from "./fcm.ts";

type Env = (name: string) => string | undefined;
type Payload = {
  delivery_id: string;
  channel: string;
  attempt: number;
  notification: { id: string; kind: string; title: string; body: string | null; link: string | null };
  tokens: Array<{ id: string; token: string; platform: string }>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export function createHandler(env: Env, fetchImpl: typeof fetch = fetch) {
  const supabaseUrl = env("SUPABASE_URL") ?? "";
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const appUrl = (env("APP_URL") ?? "https://limpa-aqui-ls6290918-7294.vercel.app").replace(/\/$/, "");
  const read = readServiceAccount(env("FCM_SERVICE_ACCOUNT"));
  const fcm = "sa" in read ? new Fcm(read.sa, fetchImpl) : null;
  // diz o que falta (e só o tamanho/forma do texto), sem expor o conteúdo
  const configProblem = "problem" in read ? [read.problem, read.detail].filter(Boolean).join(":") : null;

  async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const bearer = serviceKey.startsWith("sb_") ? null : serviceKey;
    const res = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: serviceKey, "Content-Type": "application/json", ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      body: JSON.stringify(args),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`rpc ${fn} ${res.status}`);
    return (text ? JSON.parse(text) : null) as T;
  }

  async function processDelivery(id: string): Promise<string> {
    const p = await rpc<Payload | null>("notify_delivery_payload", { p_delivery_id: id });
    if (!p) return "ignorado"; // já tratado, em uso ou esgotado
    if (!fcm) {
      await rpc("notify_delivery_result", { p_delivery_id: id, p_status: "falhou", p_error: configProblem ?? "fcm_nao_configurado" });
      return "falhou";
    }
    if (p.tokens.length === 0) {
      await rpc("notify_delivery_result", { p_delivery_id: id, p_status: "sem_dispositivo" });
      return "sem_dispositivo";
    }
    const msg = { title: p.notification.title, body: p.notification.body, link: p.notification.link, kind: p.notification.kind, notificationId: p.notification.id };
    const results: Array<{ id: string; r: SendResult }> = await Promise.all(
      p.tokens.map(async (t) => ({ id: t.id, r: await fcm.send(t.token, msg, appUrl) })),
    );
    const sent = results.filter((x) => x.r.ok);
    const invalid = results.filter((x) => !x.r.ok && x.r.invalidToken).map((x) => x.id);
    const failed = results.filter((x) => !x.r.ok && !x.r.invalidToken);
    const status = sent.length === results.length ? "enviado"
      : sent.length > 0 ? "parcial"
      : failed.length === 0 ? "sem_dispositivo" // todos os tokens eram inválidos
      : "falhou";
    const firstError = failed[0]?.r.ok === false ? failed[0].r.code : null;
    await rpc("notify_delivery_result", {
      p_delivery_id: id,
      p_status: status,
      p_message_id: sent[0]?.r.ok ? sent[0].r.messageId : null,
      p_error: status === "enviado" ? null : firstError ?? (invalid.length ? "UNREGISTERED" : null),
      p_invalid_tokens: invalid.length ? invalid : null,
    });
    return status;
  }

  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") return json({ error: "método não permitido" }, 405);
    const secret = req.headers.get("x-notify-secret") ?? "";
    if (secret.length < 32) return json({ error: "não autorizado" }, 401);
    try {
      if (!(await rpc<boolean>("notify_check_secret", { p_secret: secret }))) return json({ error: "não autorizado" }, 401);
      const body = await req.json().catch(() => ({}));
      if (typeof body?.delivery_id === "string" && UUID.test(body.delivery_id)) {
        return json({ result: await processDelivery(body.delivery_id) });
      }
      if (body?.retry === true) {
        const ids = (await rpc<string[]>("notify_pending_deliveries", { p_limit: 100 })) ?? [];
        const out: Record<string, number> = {};
        for (let i = 0; i < ids.length; i += 5) {
          const batch = await Promise.all(ids.slice(i, i + 5).map((id) => processDelivery(id).catch(() => "erro")));
          batch.forEach((s) => (out[s] = (out[s] ?? 0) + 1));
        }
        return json({ result: "retry", processed: ids.length, ...out });
      }
      return json({ error: "pedido inválido" }, 400);
    } catch (e) {
      console.error("notify-send", String((e as Error).message).slice(0, 120));
      return json({ error: "falha interna" }, 500);
    }
  };
}

// No Supabase a função sempre serve; nos testes ela é importada sem servir
if (import.meta.main ?? true) {
  Deno.serve(createHandler((n) => Deno.env.get(n)));
}
