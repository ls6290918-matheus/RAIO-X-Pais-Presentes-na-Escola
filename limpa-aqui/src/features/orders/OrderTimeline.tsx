import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, History, ShieldCheck } from "lucide-react";
import { Alert, Button, InlineLoader, Modal, Select, Textarea, cn } from "@/components/shared/ui";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import type { OrderStatus, PaymentMode } from "@/lib/types";

/* ---------------------------------------------------------------- tipos */

export type Dispute = {
  id: string;
  status: "aberta" | "resolvida";
  reason: DisputeReason;
  description: string;
  opened_by_role: "cliente" | "prestador";
  created_at: string;
  response: string | null;
  responded_at: string | null;
  resolution: "favor_cliente" | "favor_prestador" | "acordo" | null;
  resolution_note: string | null;
  resolved_at: string | null;
  can_respond: boolean;
};
export type StageInfo = {
  order_id: string;
  client_confirmed_at: string | null;
  delivered_at: string | null;
  auto_concluded: boolean;
  can_confirm: boolean;
  can_dispute: boolean;
  dispute: Dispute | null;
  discount_amount: number;
};
export type DisputeReason = "nao_recebido" | "dano" | "item_faltando" | "qualidade" | "cobranca" | "atraso" | "outro";

export const DISPUTE_REASON: Record<DisputeReason, string> = {
  nao_recebido: "Não recebi o pedido",
  dano: "Peça danificada ou manchada",
  item_faltando: "Faltou alguma peça",
  qualidade: "Serviço mal feito",
  cobranca: "Problema na cobrança",
  atraso: "Atraso grande",
  outro: "Outro motivo",
};
export const RESOLUTION_LABEL = { favor_cliente: "A favor do cliente", favor_prestador: "A favor da lavanderia", acordo: "Acordo entre as partes" } as const;

/** Carrega a situação (concluído, disputa, o que dá para fazer) de vários pedidos de uma vez. */
export async function loadStageInfo(ids: string[]) {
  if (!ids.length) return new Map<string, StageInfo>();
  const { data } = await supabase.rpc("order_stage_info", { p_order_ids: ids });
  return new Map(((data as StageInfo[]) ?? []).map((s) => [s.order_id, s]));
}

/** Etapa mostrada ao usuário: as do PRD (aguardando pagamento, em disputa, concluído) por cima da situação gravada. */
export type Stage = "aguardando_pagamento" | "em_disputa" | "concluido" | OrderStatus;
export function stageOf(o: { status: OrderStatus; paid: boolean; payment_mode?: PaymentMode | null }, s?: StageInfo): Stage {
  if (s?.dispute?.status === "aberta") return "em_disputa";
  if (o.status === "entregue" && (s?.client_confirmed_at || s?.auto_concluded)) return "concluido";
  if (o.payment_mode === "app" && !o.paid && o.status !== "cancelado") return "aguardando_pagamento";
  return o.status;
}
export function StageBadge({ stage }: { stage: Stage }) {
  if (stage === "em_disputa")
    return <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-900"><AlertTriangle className="h-3 w-3" aria-hidden /> Em disputa</span>;
  if (stage === "concluido")
    return <span className="inline-flex items-center gap-1 rounded-full bg-agua-50 px-2.5 py-1 text-[11px] font-bold text-petroleo"><CheckCircle2 className="h-3 w-3" aria-hidden /> Concluído</span>;
  if (stage === "aguardando_pagamento") return <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-800">Aguardando pagamento</span>;
  return null;
}

/* ---------------------------------------------------------- linha do tempo */

type Ev = { event: string; from: string | null; to: string | null; note: string | null; at: string; actor: "cliente" | "lavanderia" | "admin" | "sistema" };
type Del = { leg: "pickup" | "return"; status: string; created_at: string; accepted_at: string | null; picked_at: string | null; completed_at: string | null; canceled_at: string | null };
type Item = { at: string; title: string; detail?: string | null; tone: "ok" | "warn" | "bad" | "info" };

const TO_LABEL: Record<string, string> = {
  orcamento: "Virou orçamento",
  recebido: "Pedido recebido pela lavanderia",
  em_lavagem: "Em lavagem",
  pronto: "Pronto",
  entregue: "Entregue",
  cancelado: "Pedido cancelado",
};
const ACTOR: Record<Ev["actor"], string> = { cliente: "pelo cliente", lavanderia: "pela lavanderia", admin: "pela administração", sistema: "" };

function toItems(events: Ev[], deliveries: Del[]): Item[] {
  const items: Item[] = events.map((e) => {
    const by = ACTOR[e.actor];
    switch (e.event) {
      case "criado":
        return { at: e.at, title: "Pedido criado", detail: e.note, tone: "info" };
      case "aguardando_pagamento":
        return { at: e.at, title: "Aguardando pagamento pelo app", tone: "warn" };
      case "pagamento_confirmado":
        return { at: e.at, title: "Pagamento confirmado", detail: by || null, tone: "ok" };
      case "pagamento_desfeito":
        return { at: e.at, title: "Pagamento desfeito", detail: by || null, tone: "bad" };
      case "concluido":
        return { at: e.at, title: "Concluído: o cliente confirmou o recebimento", tone: "ok" };
      case "disputa_aberta":
        return { at: e.at, title: "Disputa aberta", detail: e.note, tone: "warn" };
      case "disputa_respondida":
        return { at: e.at, title: "Disputa respondida", detail: e.note, tone: "info" };
      case "disputa_resolvida":
        return { at: e.at, title: "Disputa resolvida pela administração", detail: e.note, tone: "ok" };
      default: {
        const t = TO_LABEL[e.to ?? ""] ?? "Situação alterada";
        const back = e.from && ["pronto", "entregue"].includes(e.from) && ["recebido", "em_lavagem", "pronto"].includes(e.to ?? "");
        return { at: e.at, title: back ? `Voltou para: ${t.toLowerCase()}` : t, detail: e.note ?? (by || null), tone: e.to === "cancelado" ? "bad" : "ok" };
      }
    }
  });
  for (const d of deliveries) {
    const leg = d.leg === "pickup" ? "Coleta" : "Devolução";
    items.push({ at: d.created_at, title: `${leg}: procurando entregador`, tone: "info" });
    if (d.accepted_at) items.push({ at: d.accepted_at, title: `${leg}: entregador a caminho`, tone: "info" });
    if (d.picked_at) items.push({ at: d.picked_at, title: d.leg === "pickup" ? "Coleta: peças retiradas com o cliente" : "Devolução: peças retiradas na lavanderia", tone: "info" });
    if (d.completed_at) items.push({ at: d.completed_at, title: d.leg === "pickup" ? "Coleta: peças entregues na lavanderia" : "Devolução: peças entregues ao cliente", tone: "ok" });
    if (d.canceled_at) items.push({ at: d.canceled_at, title: `${leg}: corrida cancelada`, tone: "bad" });
  }
  return items.sort((a, b) => a.at.localeCompare(b.at));
}

const DOT: Record<Item["tone"], string> = { ok: "bg-agua-600", warn: "bg-amber-400", bad: "bg-red-500", info: "bg-grafite/30" };

/** Histórico do pedido (situações, pagamento, corridas e disputas), do mais antigo ao mais novo. */
export function OrderTimeline({ orderId, refreshKey }: { orderId: string; refreshKey?: unknown }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void supabase.rpc("order_timeline", { p_order_id: orderId }).then(({ data, error: err }) => {
      if (!alive) return;
      if (err) return setError(friendlyError(err));
      const d = data as { events: Ev[]; deliveries: Del[] };
      setItems(toItems(d.events ?? [], d.deliveries ?? []));
    });
    return () => {
      alive = false;
    };
  }, [orderId, refreshKey]);
  if (error) return <Alert>{error}</Alert>;
  if (items === null) return <InlineLoader />;
  if (items.length === 0) return <p className="text-sm text-grafite-500">Nada registrado ainda.</p>;
  return (
    <ol className="relative space-y-3 border-l border-grafite/10 pl-5" data-testid="order-timeline">
      {items.map((it, i) => (
        <li key={i} className="relative">
          <span className={cn("absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-white", DOT[it.tone])} aria-hidden />
          <p className="text-sm font-medium text-grafite">{it.title}</p>
          <p className="text-[11px] text-grafite-500">
            {formatDateTime(it.at)}
            {it.detail ? ` · ${it.detail}` : ""}
          </p>
        </li>
      ))}
    </ol>
  );
}

/** Botão "Ver histórico" que abre a linha do tempo no próprio cartão. */
export function TimelineToggle({ orderId, refreshKey }: { orderId: string; refreshKey?: unknown }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1 text-xs font-semibold text-petroleo hover:underline" aria-expanded={open} data-testid="timeline-toggle">
        <History className="h-3.5 w-3.5" aria-hidden /> {open ? "Esconder histórico" : "Ver histórico"} {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {open && (
        <div className="mt-3">
          <OrderTimeline orderId={orderId} refreshKey={refreshKey} />
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- disputa */

/** Janela para abrir uma disputa (motivo + o que aconteceu). */
export function DisputeModal({ orderId, orderNumber, side, onClose, onDone }: { orderId: string; orderNumber: number; side: "cliente" | "prestador"; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState<DisputeReason | "">("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send() {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.rpc("open_dispute", { p_order_id: orderId, p_reason: reason, p_description: text });
    setBusy(false);
    if (err) return setError(friendlyError(err));
    onDone();
  }
  return (
    <Modal open title={`Relatar um problema · pedido nº ${orderNumber}`} onClose={onClose}>
      <div className="space-y-4" data-testid="dispute-modal">
        <p className="text-sm text-grafite-500">
          {side === "cliente"
            ? "A lavanderia é avisada e pode responder. A administração do Limpa Aqui analisa e decide. Enquanto isso, o pagamento à lavanderia fica retido."
            : "O cliente é avisado e pode responder. A administração do Limpa Aqui analisa e decide. Enquanto isso, os repasses deste pedido ficam retidos."}
        </p>
        {error && <Alert>{error}</Alert>}
        <Select value={reason} onChange={(e) => setReason(e.target.value as DisputeReason)} aria-label="Motivo">
          <option value="">Escolha o motivo</option>
          {(Object.keys(DISPUTE_REASON) as DisputeReason[])
            .filter((k) => side === "cliente" || ["cobranca", "outro", "nao_recebido"].includes(k))
            .map((k) => (
              <option key={k} value={k}>
                {side === "prestador" && k === "nao_recebido" ? "Cliente não entregou ou não retirou as peças" : DISPUTE_REASON[k]}
              </option>
            ))}
        </Select>
        <Textarea rows={4} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} aria-label="O que aconteceu" placeholder="Conte o que aconteceu, com detalhes. Fotos podem ser enviadas pelo chat do pedido." />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Voltar
          </Button>
          <Button loading={busy} disabled={!reason || text.trim().length < 10} onClick={() => void send()}>
            Abrir disputa
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Quadro da disputa: o relato, a resposta da outra parte e a decisão. Quem pode, responde aqui. */
export function DisputePanel({ dispute: d, viewer, onChanged }: { dispute: Dispute; viewer: "cliente" | "prestador"; onChanged: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const respond = useCallback(async () => {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.rpc("respond_dispute", { p_dispute_id: d.id, p_response: text });
    setBusy(false);
    if (err) return setError(friendlyError(err));
    setText("");
    onChanged();
  }, [d.id, text, onChanged]);
  const mine = d.opened_by_role === viewer;
  const open = d.status === "aberta";
  return (
    <section className={cn("space-y-3 rounded-2xl p-4", open ? "bg-amber-50" : "bg-nevoa")} data-testid="dispute-panel">
      <p className={cn("flex items-center gap-2 text-sm font-semibold", open ? "text-amber-900" : "text-petroleo")}>
        {open ? <AlertTriangle className="h-4 w-4" aria-hidden /> : <ShieldCheck className="h-4 w-4" aria-hidden />}
        {open ? "Disputa em análise pela administração" : `Disputa resolvida: ${RESOLUTION_LABEL[d.resolution!].toLowerCase()}`}
      </p>
      <div className="rounded-xl bg-white/70 p-3 text-sm">
        <p className="text-[11px] font-semibold uppercase text-grafite-500">
          {mine ? "Seu relato" : d.opened_by_role === "cliente" ? "Relato do cliente" : "Relato da lavanderia"} · {DISPUTE_REASON[d.reason]} · {formatDateTime(d.created_at)}
        </p>
        <p className="mt-1 whitespace-pre-wrap text-grafite">{d.description}</p>
      </div>
      {d.response && (
        <div className="rounded-xl bg-white/70 p-3 text-sm">
          <p className="text-[11px] font-semibold uppercase text-grafite-500">
            {mine ? "Resposta da outra parte" : "Sua resposta"} · {formatDateTime(d.responded_at!)}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-grafite">{d.response}</p>
        </div>
      )}
      {d.resolution_note && (
        <div className="rounded-xl bg-white p-3 text-sm">
          <p className="text-[11px] font-semibold uppercase text-grafite-500">Decisão da administração</p>
          <p className="mt-1 text-grafite">{d.resolution_note}</p>
        </div>
      )}
      {open && d.can_respond && (
        <div className="space-y-2">
          {error && <Alert>{error}</Alert>}
          <Textarea rows={3} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} aria-label="Sua resposta" placeholder={d.response ? "Atualize a sua resposta" : "Explique o seu lado para a administração"} />
          <Button className="h-9" loading={busy} disabled={text.trim().length < 2} onClick={() => void respond()}>
            {d.response ? "Atualizar resposta" : "Enviar resposta"}
          </Button>
        </div>
      )}
      {open && (
        <p className="text-xs text-grafite-500">
          {viewer === "prestador" ? "Os repasses deste pedido ficam retidos até a decisão." : "O pagamento à lavanderia fica retido até a decisão."}
        </p>
      )}
    </section>
  );
}
