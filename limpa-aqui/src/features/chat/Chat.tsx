import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Ban, Flag, ImagePlus, Loader2, MessageCircle, MoreVertical, Package, Megaphone, Send } from "lucide-react";
import { Alert, Button, EmptyState, Modal, Textarea, cn } from "@/components/shared/ui";
import { Skeleton } from "@/components/shared/steps";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { useAuth } from "@/contexts/AuthContext";
import { signedChatUrls, uploadChatImage, type Conversation, type Message } from "./chatApi";

const TIME = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
const DAY = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", timeZone: "America/Sao_Paulo" });
const when = (iso: string) => {
  const d = new Date(iso);
  return DAY.format(new Date()) === DAY.format(d) ? TIME.format(d) : DAY.format(d);
};

/** Total de mensagens não lidas (bolinha da aba), atualizado pelo tempo real e a cada 60 s. */
export function useUnreadMessages(businessId: string | null) {
  const { user } = useAuth();
  const [count, setCount] = useState(0);
  const refresh = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase.rpc("unread_messages", { p_business_id: businessId });
    setCount(Number(data ?? 0));
  }, [user, businessId]);
  useEffect(() => {
    void refresh();
    const t = window.setInterval(() => void refresh(), 60000);
    const ch = supabase
      .channel(`unread-${businessId ?? "cliente"}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, () => void refresh())
      .subscribe();
    const onRead = () => void refresh();
    window.addEventListener("limpaaqui:chat-read", onRead);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("limpaaqui:chat-read", onRead);
      void supabase.removeChannel(ch);
    };
  }, [refresh, businessId]);
  return count;
}

/** Caixa de entrada: conversas do cliente (businessId nulo) ou da lavanderia. */
export function ChatInbox({ businessId, basePath }: { businessId: string | null; basePath: string }) {
  const [list, setList] = useState<Conversation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const { data, error: err } = await supabase.rpc("my_conversations", { p_business_id: businessId });
    if (err) setError(friendlyError(err));
    setList(((data as Conversation[]) ?? []).map((c) => ({ ...c, unread: Number(c.unread) })));
  }, [businessId]);
  useEffect(() => {
    void load();
    const ch = supabase
      .channel(`inbox-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, () => void load())
      .subscribe();
    return () => void supabase.removeChannel(ch);
  }, [load]);

  if (error) return <Alert>{error}</Alert>;
  if (list === null)
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
    );
  if (list.length === 0)
    return (
      <div className="rounded-3xl bg-white p-2 shadow-sm">
        <EmptyState
          icon={<MessageCircle className="h-6 w-6" />}
          title="Nenhuma conversa ainda"
          description={
            businessId
              ? "Pergunte algo a um cliente em Oportunidades ou converse pelo pedido."
              : "Converse com quem mandou proposta no seu anúncio ou com a lavanderia de um pedido."
          }
        />
      </div>
    );
  return (
    <ul className="divide-y divide-grafite/5 overflow-hidden rounded-3xl bg-white shadow-sm" data-testid="chat-inbox">
      {list.map((c) => (
        <li key={c.id}>
          <Link to={`${basePath}/${c.id}`} className="flex items-center gap-3 px-4 py-3 transition hover:bg-nevoa">
            <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl", c.kind === "pedido" ? "bg-agua-50 text-petroleo" : "bg-amber-50 text-amber-700")}>
              {c.kind === "pedido" ? <Package className="h-5 w-5" aria-hidden /> : <Megaphone className="h-5 w-5" aria-hidden />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className={cn("truncate text-sm text-petroleo", c.unread > 0 ? "font-bold" : "font-semibold")}>{c.counterpart}</p>
                {c.last_message_at && <span className="shrink-0 text-[11px] text-grafite-500">{when(c.last_message_at)}</span>}
              </div>
              <p className="truncate text-xs text-grafite-500">{c.subject}</p>
              <p className={cn("truncate text-xs", c.unread > 0 ? "font-semibold text-grafite" : "text-grafite-500")}>
                {c.blocked ? "Conversa bloqueada" : c.last_message ? `${c.last_mine ? "Você: " : ""}${c.last_message}` : "Sem mensagens ainda"}
              </p>
            </div>
            {c.unread > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-agua-600 px-1.5 text-[10px] font-bold text-white" aria-label={`${c.unread} não lidas`}>
                {c.unread}
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Conversa em tempo real. A altura vem de quem usa (ocupa a tela até a barra de baixo). */
export function ChatThread({ conversationId, businessId, backTo, className }: { conversationId: string; businessId: string | null; backTo: string; className?: string }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [meta, setMeta] = useState<Conversation | null | undefined>(undefined);
  const [blockedByMe, setBlockedByMe] = useState(false);
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const stick = useRef(true);

  const addUrls = useCallback(async (list: Message[]) => {
    const paths = list.map((m) => m.image_path).filter(Boolean) as string[];
    if (!paths.length) return;
    const s = await signedChatUrls(paths);
    setUrls((u) => new Map([...u, ...s]));
  }, []);

  const markRead = useCallback(async () => {
    await supabase.rpc("mark_conversation_read", { p_conversation_id: conversationId });
    window.dispatchEvent(new Event("limpaaqui:chat-read"));
  }, [conversationId]);

  const loadMeta = useCallback(async () => {
    const [c, raw] = await Promise.all([
      supabase.rpc("my_conversations", { p_business_id: businessId }),
      supabase.from("conversations").select("blocked_by").eq("id", conversationId).maybeSingle(),
    ]);
    const found = ((c.data as Conversation[]) ?? []).find((x) => x.id === conversationId) ?? null;
    setMeta(found);
    setBlockedByMe(raw.data?.blocked_by === user?.id);
  }, [businessId, conversationId, user?.id]);

  useEffect(() => {
    let alive = true;
    stick.current = true;
    void (async () => {
      await loadMeta();
      const { data, error: err } = await supabase.rpc("conversation_messages", { p_conversation_id: conversationId });
      if (!alive) return;
      if (err) return setError(friendlyError(err));
      const list = ((data as Message[]) ?? []).reverse();
      setMsgs(list);
      setHasMore(list.length === 50);
      void addUrls(list);
      void markRead();
    })();
    // novas mensagens em tempo real (a RLS entrega só as das conversas da pessoa)
    const ch = supabase
      .channel(`conv-${conversationId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` }, (payload) => {
        const m = payload.new as { id: string; sender_id: string; body: string | null; image_path: string | null; created_at: string };
        setMsgs((cur) => (cur.some((x) => x.id === m.id) ? cur : [...cur, { ...m, mine: m.sender_id === user?.id }]));
        void addUrls([{ ...m, mine: false }]);
        if (m.sender_id !== user?.id) void markRead();
      })
      .subscribe();
    return () => {
      alive = false;
      void supabase.removeChannel(ch);
    };
  }, [conversationId, user?.id, addUrls, markRead, loadMeta]);

  // rola para o fim quando chega mensagem (se a pessoa estiver no fim)
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  async function older() {
    const first = msgs[0];
    if (!first) return;
    stick.current = false;
    const { data } = await supabase.rpc("conversation_messages", { p_conversation_id: conversationId, p_before: first.created_at });
    const list = ((data as Message[]) ?? []).reverse();
    setHasMore(list.length === 50);
    setMsgs((cur) => [...list, ...cur]);
    void addUrls(list);
  }

  async function send(imagePath: string | null = null) {
    const body = text.trim();
    if (!body && !imagePath) return;
    setSending(true);
    setError(null);
    stick.current = true;
    const { data, error: err } = await supabase.rpc("send_message", { p_conversation_id: conversationId, p_body: imagePath ? body || null : body, p_image_path: imagePath });
    setSending(false);
    if (err) return setError(friendlyError(err));
    if (!imagePath || body) setText("");
    // aparece na hora mesmo se o tempo real demorar
    setMsgs((cur) => (cur.some((x) => x.id === data) ? cur : [...cur, { id: data as string, sender_id: user!.id, mine: true, body: body || null, image_path: imagePath, created_at: new Date().toISOString() }]));
    if (imagePath) void addUrls([{ id: "", sender_id: "", mine: true, body: null, image_path: imagePath, created_at: "" }]);
  }

  async function sendImage(file: File) {
    setSending(true);
    try {
      const path = await uploadChatImage(file, conversationId);
      await send(path);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Imagem inválida.");
    }
    setSending(false);
  }

  async function toggleBlock() {
    setMenu(false);
    const block = !meta?.blocked;
    if (block && !window.confirm("Bloquear esta conversa? Ninguém mais consegue mandar mensagens nela até você desbloquear.")) return;
    const { error: err } = await supabase.rpc("set_conversation_blocked", { p_conversation_id: conversationId, p_blocked: block });
    if (err) return setError(friendlyError(err));
    await loadMeta();
  }

  async function report() {
    const { error: err } = await supabase.rpc("report_conversation", { p_conversation_id: conversationId, p_reason: reason });
    if (err) return setError(friendlyError(err));
    setReporting(false);
    setReason("");
    setError(null);
    window.alert("Denúncia enviada. A administração do Limpa Aqui vai analisar a conversa.");
  }

  if (meta === null)
    return (
      <div className="rounded-3xl bg-white p-2 shadow-sm">
        <EmptyState icon={<MessageCircle className="h-6 w-6" />} title="Conversa não encontrada" description="Ela pode ter sido apagada junto com o anúncio." />
      </div>
    );

  return (
    <div className={cn("flex flex-col overflow-hidden rounded-3xl bg-white shadow-sm", className)} data-testid="chat-thread">
      <header className="flex items-center gap-2 border-b border-grafite/5 px-2 py-2">
        <button type="button" onClick={() => navigate(backTo)} className="flex h-10 w-10 items-center justify-center rounded-full text-petroleo hover:bg-nevoa" aria-label="Voltar">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-petroleo">{meta?.counterpart ?? "…"}</p>
          <p className="truncate text-xs text-grafite-500">{meta?.subject ?? ""}</p>
        </div>
        <div className="relative">
          <button type="button" onClick={() => setMenu((m) => !m)} className="flex h-10 w-10 items-center justify-center rounded-full text-grafite-500 hover:bg-nevoa" aria-label="Opções da conversa">
            <MoreVertical className="h-5 w-5" />
          </button>
          {menu && (
            <div className="absolute right-0 z-10 mt-1 w-52 rounded-xl border border-grafite/10 bg-white p-1.5 shadow-card" role="menu">
              {(!meta?.blocked || blockedByMe) && (
                <button role="menuitem" type="button" onClick={() => void toggleBlock()} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-grafite hover:bg-nevoa">
                  <Ban className="h-4 w-4" aria-hidden /> {meta?.blocked ? "Desbloquear" : "Bloquear conversa"}
                </button>
              )}
              <button role="menuitem" type="button" onClick={() => (setMenu(false), setReporting(true))} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-700 hover:bg-red-50">
                <Flag className="h-4 w-4" aria-hidden /> Denunciar
              </button>
            </div>
          )}
        </div>
      </header>

      <div
        ref={scroller}
        className="flex-1 space-y-2 overflow-y-auto bg-nevoa/50 px-3 py-4"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        data-testid="chat-messages"
      >
        {hasMore && (
          <button type="button" onClick={() => void older()} className="mx-auto block rounded-full bg-white px-3 py-1 text-xs font-semibold text-grafite-500 shadow-sm">
            Mensagens anteriores
          </button>
        )}
        {meta === undefined && <Skeleton className="h-10 w-2/3" />}
        {meta && msgs.length === 0 && <p className="py-8 text-center text-sm text-grafite-500">Mande a primeira mensagem. Seja educado e não compartilhe senhas ou dados de cartão.</p>}
        {msgs.map((m) => (
          <div key={m.id} className={cn("flex", m.mine ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm", m.mine ? "rounded-br-md bg-agua text-petroleo" : "rounded-bl-md bg-white text-grafite")} data-testid="chat-bubble">
              {m.image_path &&
                (urls.get(m.image_path) ? (
                  <a href={urls.get(m.image_path)} target="_blank" rel="noreferrer">
                    <img src={urls.get(m.image_path)} alt="Imagem enviada" className="mb-1 max-h-60 rounded-xl object-cover" />
                  </a>
                ) : (
                  <div className="mb-1 h-32 w-40 animate-pulse rounded-xl bg-grafite/10" />
                ))}
              {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
              <p className={cn("mt-0.5 text-right text-[10px]", m.mine ? "text-petroleo/60" : "text-grafite-500")}>{TIME.format(new Date(m.created_at))}</p>
            </div>
          </div>
        ))}
      </div>

      {error && (
        <div className="px-3 pt-2">
          <Alert>{error}</Alert>
        </div>
      )}
      {meta?.blocked ? (
        <p className="border-t border-grafite/5 px-4 py-3 text-center text-sm text-grafite-500">
          {blockedByMe ? "Você bloqueou esta conversa." : "Esta conversa foi bloqueada."}
        </p>
      ) : (
        <form
          className="flex items-end gap-2 border-t border-grafite/5 p-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={sending}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-grafite-500 hover:bg-nevoa disabled:opacity-50"
            aria-label="Enviar foto"
          >
            <ImagePlus className="h-5 w-5" />
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => (e.target.files?.[0] && void sendImage(e.target.files[0]), (e.target.value = ""))} />
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
            maxLength={2000}
            placeholder="Escreva uma mensagem"
            aria-label="Mensagem"
            className="max-h-32 min-h-11 flex-1 resize-none rounded-2xl bg-nevoa px-4 py-2.5 text-sm text-grafite placeholder:text-grafite-500 focus:outline-none focus:ring-2 focus:ring-agua"
            data-testid="chat-input"
          />
          <button
            type="submit"
            disabled={sending || !text.trim()}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-petroleo text-white disabled:opacity-40"
            aria-label="Enviar"
            data-testid="chat-send"
          >
            {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
          </button>
        </form>
      )}

      {reporting && (
        <Modal open title="Denunciar conversa" onClose={() => setReporting(false)}>
          <div className="space-y-3">
            <p className="text-sm text-grafite-500">A administração do Limpa Aqui vai ler esta conversa para analisar. Conte o que aconteceu.</p>
            <Textarea rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Motivo da denúncia" />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setReporting(false)}>
                Cancelar
              </Button>
              <Button onClick={() => void report()} disabled={reason.trim().length < 5}>
                Enviar denúncia
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Botão que abre (ou reabre) a conversa e vai para ela. */
export function ChatButton({
  kind,
  args,
  basePath,
  label = "Conversar",
  variant = "outline",
  className,
}: {
  kind: "proposta" | "pedido" | "anuncio";
  args: { proposalId?: string; orderId?: string; listingId?: string; businessId?: string };
  basePath: "/cliente/mensagens" | "/app/mensagens";
  label?: string;
  variant?: "outline" | "primary" | "ghost";
  className?: string;
}) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant={variant}
      className={cn("h-9", className)}
      loading={busy}
      data-testid="chat-open"
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        setBusy(true);
        const { openConversation } = await import("./chatApi");
        const r = await openConversation(kind, args);
        setBusy(false);
        if (r.error) return window.alert(r.error);
        navigate(`${basePath}/${r.id}`);
      }}
    >
      <MessageCircle className="h-4 w-4" aria-hidden /> {label}
    </Button>
  );
}
