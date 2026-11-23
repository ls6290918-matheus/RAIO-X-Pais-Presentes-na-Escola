// Testes da função notify-send com o FCM, o Google OAuth e o banco simulados (nenhuma chamada real).
// Rodar: deno test --allow-env supabase/functions/notify-send/notify-send.test.ts
import { createHandler } from "./index.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const SECRET = "s".repeat(64);
const DELIVERY = "11111111-1111-4111-8111-111111111111";

async function makeServiceAccount() {
  const kp = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der)).match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----\n`;
  return { sa: { project_id: "limpa-teste", client_email: "fcm@limpa-teste.iam.gserviceaccount.com", private_key: pem }, publicKey: kp.publicKey };
}

/** Banco + Google simulados. tokens: o que cada aparelho "responde" no FCM. */
function fakeWorld(tokens: Array<{ id: string; token: string }>, opts: { publicKey?: CryptoKey } = {}) {
  const calls = { oauth: 0, fcm: [] as Array<{ auth: string; body: any }>, results: [] as any[], jwtValid: [] as boolean[] };
  let payloadServed = 0;
  const f: typeof fetch = async (input, init) => {
    const url = String(input);
    const body = init?.body ? String(init.body) : "";
    if (url.endsWith("/rpc/notify_check_secret")) return Response.json(JSON.parse(body).p_secret === SECRET);
    if (url.endsWith("/rpc/notify_delivery_payload")) {
      payloadServed++;
      return Response.json({
        delivery_id: DELIVERY, channel: "push", attempt: payloadServed,
        notification: { id: "n1", kind: "pedido_pronto", title: "Pedido nº 7 está pronto", body: "Lavanderia do João", link: "/cliente/pedidos" },
        tokens: tokens.map((t) => ({ ...t, platform: "web" })),
      });
    }
    if (url.endsWith("/rpc/notify_delivery_result")) {
      calls.results.push(JSON.parse(body));
      return new Response(null, { status: 204 });
    }
    if (url.endsWith("/rpc/notify_pending_deliveries")) return Response.json([DELIVERY, DELIVERY]);
    if (url === "https://oauth2.googleapis.com/token") {
      calls.oauth++;
      const assertion = new URLSearchParams(body).get("assertion")!;
      if (opts.publicKey) {
        const [h, c, s] = assertion.split(".");
        const sig = Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (x) => x.charCodeAt(0));
        calls.jwtValid.push(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", opts.publicKey, sig, new TextEncoder().encode(`${h}.${c}`)));
      }
      return Response.json({ access_token: "google-access-token", expires_in: 3600 });
    }
    if (url.startsWith("https://fcm.googleapis.com/v1/projects/limpa-teste/messages:send")) {
      const b = JSON.parse(body);
      calls.fcm.push({ auth: String((init?.headers as Record<string, string>).Authorization), body: b });
      const tok = b.message.token as string;
      if (tok.startsWith("ok")) return Response.json({ name: `projects/limpa-teste/messages/${tok}` });
      if (tok.startsWith("morto")) return Response.json({ error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } }, { status: 404 });
      if (tok.startsWith("invalido")) return Response.json({ error: { status: "INVALID_ARGUMENT", message: "The registration token is not a valid FCM registration token" } }, { status: 400 });
      if (tok.startsWith("payload")) return Response.json({ error: { status: "INVALID_ARGUMENT", message: "Invalid JSON payload received." } }, { status: 400 });
      return Response.json({ error: { status: "UNAVAILABLE" } }, { status: 503 });
    }
    throw new Error("URL inesperada: " + url);
  };
  return { f, calls };
}

const req = (body: unknown, secret = SECRET) =>
  new Request("http://x/notify-send", { method: "POST", headers: { "x-notify-secret": secret, "Content-Type": "application/json" }, body: JSON.stringify(body) });
const env = (sa: unknown) => (n: string) => ({ SUPABASE_URL: "http://db", SUPABASE_SERVICE_ROLE_KEY: "service", FCM_SERVICE_ACCOUNT: sa ? JSON.stringify(sa) : undefined, APP_URL: "https://app.limpa" } as Record<string, string | undefined>)[n];

Deno.test("recusa chamada sem o segredo do banco", async () => {
  const { sa } = await makeServiceAccount();
  const w = fakeWorld([]);
  const h = createHandler(env(sa), w.f);
  assert((await h(req({ delivery_id: DELIVERY }, "curto"))).status === 401, "segredo curto");
  assert((await h(req({ delivery_id: DELIVERY }, "x".repeat(64)))).status === 401, "segredo errado");
  assert(w.calls.fcm.length === 0, "não enviou nada");
});

Deno.test("envia para os aparelhos: parcial, desativa token morto, link absoluto, JWT assinado", async () => {
  const { sa, publicKey } = await makeServiceAccount();
  const w = fakeWorld([{ id: "a", token: "ok-aparelho-1" }, { id: "b", token: "morto-aparelho-2" }, { id: "c", token: "ocupado-aparelho-3" }], { publicKey });
  const res = await createHandler(env(sa), w.f)(req({ delivery_id: DELIVERY }));
  const out = await res.json();
  assert(out.result === "parcial", "parcial: " + JSON.stringify(out));
  const r = w.calls.results[0];
  assert(r.p_status === "parcial" && r.p_invalid_tokens?.length === 1 && r.p_invalid_tokens[0] === "b", "token morto desativado");
  assert(r.p_error === "UNAVAILABLE", "erro temporário registrado");
  assert(r.p_message_id === "projects/limpa-teste/messages/ok-aparelho-1", "id do provedor");
  const m = w.calls.fcm[0].body.message;
  assert(m.webpush.fcm_options.link === "https://app.limpa/cliente/pedidos", "link absoluto");
  assert(m.notification.title === "Pedido nº 7 está pronto" && m.data.kind === "pedido_pronto", "conteúdo");
  assert(w.calls.fcm.every((c) => c.auth === "Bearer google-access-token"), "usa o token do Google");
  assert(w.calls.oauth === 1 && w.calls.jwtValid[0] === true, "JWT assinado com a chave da conta de serviço e reaproveitado");
});

Deno.test("todos os aparelhos ok → enviado; todos inválidos → sem dispositivo", async () => {
  const { sa } = await makeServiceAccount();
  let w = fakeWorld([{ id: "a", token: "ok-1" }, { id: "b", token: "ok-2" }]);
  assert((await (await createHandler(env(sa), w.f)(req({ delivery_id: DELIVERY }))).json()).result === "enviado", "enviado");
  w = fakeWorld([{ id: "a", token: "morto-1" }, { id: "b", token: "invalido-2" }]);
  const out = await (await createHandler(env(sa), w.f)(req({ delivery_id: DELIVERY }))).json();
  assert(out.result === "sem_dispositivo" && w.calls.results[0].p_invalid_tokens.length === 2, "dois tokens desativados");
});

Deno.test("erro de conteúdo (INVALID_ARGUMENT que não é do token) não desativa o aparelho", async () => {
  const { sa } = await makeServiceAccount();
  const w = fakeWorld([{ id: "a", token: "payload-1" }]);
  const out = await (await createHandler(env(sa), w.f)(req({ delivery_id: DELIVERY }))).json();
  assert(out.result === "falhou" && !w.calls.results[0].p_invalid_tokens, "aparelho preservado");
});

Deno.test("sem FCM configurado: registra falha clara (o banco avisa o admin na 3ª)", async () => {
  const w = fakeWorld([{ id: "a", token: "ok-1" }]);
  const out = await (await createHandler(env(null), w.f)(req({ delivery_id: DELIVERY }))).json();
  assert(out.result === "falhou" && w.calls.results[0].p_error === "fcm_nao_configurado", "falha registrada");
  assert(w.calls.fcm.length === 0, "nada enviado");
});

Deno.test("reenvio: processa a lista de pendentes", async () => {
  const { sa } = await makeServiceAccount();
  const w = fakeWorld([{ id: "a", token: "ok-1" }]);
  const out = await (await createHandler(env(sa), w.f)(req({ retry: true }))).json();
  assert(out.processed === 2 && out.enviado === 2, JSON.stringify(out));
});

Deno.test("pedido inválido e método errado", async () => {
  const { sa } = await makeServiceAccount();
  const w = fakeWorld([]);
  const h = createHandler(env(sa), w.f);
  assert((await h(req({ delivery_id: "nao-e-uuid" }))).status === 400, "uuid inválido");
  assert((await h(new Request("http://x", { method: "GET" }))).status === 405, "GET");
});
