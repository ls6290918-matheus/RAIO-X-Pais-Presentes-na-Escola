import { Link } from "react-router-dom";
import { Check, MessageCircle, QrCode } from "lucide-react";
import { buttonClass, cn } from "@/components/shared/ui";
import { formatBRL, formatDate, whatsappLink } from "@/lib/format";
import { LOGISTICS_LABEL, PAYMENT_LABEL } from "@/lib/marketplace";
import { OrderDeliveriesCard } from "@/features/orders/OrderDeliveriesCard";
import type { MyOrder } from "./clientTypes";
import { ChatButton } from "@/features/chat/Chat";
import { Star } from "lucide-react";
import { StarsDisplay } from "@/components/shared/Stars";
import type { ReviewStatus } from "./ReviewModal";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { DisputeModal, DisputePanel, StageBadge, TimelineToggle, stageOf, type StageInfo } from "@/features/orders/OrderTimeline";

const STEPS = [
  { key: "recebido", label: "Recebido" },
  { key: "em_lavagem", label: "Lavando" },
  { key: "pronto", label: "Pronto" },
  { key: "entregue", label: "Entregue" },
] as const;

const awaitingPix = (o: MyOrder) => o.payment_mode === "app" && !o.paid && o.status !== "cancelado";
const grandTotal = (o: MyOrder) => Number(o.total) + Number(o.delivery_fee_total ?? 0);

/** Etapas do pedido (Recebido → Lavando → Pronto → Entregue), no estilo de acompanhamento do app. */
export function OrderSteps({ order, dark = false }: { order: MyOrder; dark?: boolean }) {
  const current = STEPS.findIndex((s) => s.key === order.status);
  return (
    <ol className="flex items-center gap-1" aria-label="Etapas do pedido">
      {STEPS.map((s, i) => {
        const done = current >= 0 && i <= current;
        return (
          <li key={s.key} className="flex flex-1 items-center gap-1.5">
            <span
              className={cn(
                "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                done ? "border-agua bg-agua text-petroleo" : dark ? "border-white/40" : "border-grafite/25",
              )}
              aria-hidden
            >
              {done && <Check className="h-3 w-3" strokeWidth={3} />}
            </span>
            <span className={cn("text-[11px] font-medium", done ? (dark ? "text-white" : "text-grafite") : dark ? "text-white/60" : "text-grafite-500")}>
              {s.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Cartão escuro de pedido em andamento (Início). */
export function ActiveOrderCard({ order }: { order: MyOrder }) {
  const pix = awaitingPix(order);
  return (
    <Link to={pix ? `/cliente/pagar/${order.id}` : "/cliente/pedidos"} className="block rounded-2xl bg-petroleo p-4 text-white shadow-sm" data-testid="active-order">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{order.business_name}</p>
          <p className="text-xs text-white/60">
            Pedido nº {order.number} · {formatDate(order.created_at)}
          </p>
        </div>
        <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold", pix ? "bg-amber-300 text-amber-950" : "bg-agua text-petroleo")}>
          {pix ? "Pagar Pix" : "Em andamento"}
        </span>
      </div>
      <div className="mt-4">
        <OrderSteps order={order} dark />
      </div>
    </Link>
  );
}

/** Pedido completo na lista "Pedidos". */
export function OrderCard({ order: o, review, onReview, stage, onChanged }: { order: MyOrder; review?: ReviewStatus; onReview?: () => void; stage?: StageInfo; onChanged?: () => void }) {
  const pix = awaitingPix(o);
  const [disputing, setDisputing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function confirm() {
    if (!window.confirm("Confirmar que você recebeu tudo certo? Depois disso o pedido fica concluído e não dá mais para abrir disputa.")) return;
    setBusy(true);
    const { error } = await supabase.rpc("confirm_order_received", { p_order_id: o.id });
    setBusy(false);
    if (error) return setErr(friendlyError(error));
    onChanged?.();
  }
  return (
    <li className="rounded-2xl bg-white p-4 shadow-sm sm:p-5" data-testid="order-card">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-grafite">{o.business_name}</p>
          <p className="text-xs text-grafite-500">
            Pedido nº {o.number} · feito em {formatDate(o.created_at)}
            {o.status !== "cancelado" && o.status !== "entregue" && ` · previsão ${formatDate(`${o.due_date}T12:00:00`)}`}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="text-base font-semibold text-petroleo">{formatBRL(grandTotal(o))}</span>
          <StageBadge stage={stageOf(o, stage)} />
        </div>
      </div>

      {o.status === "cancelado" ? (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">Pedido cancelado</p>
      ) : (
        <div className="mt-3">
          <OrderSteps order={o} />
        </div>
      )}

      <p className="mt-3 text-sm text-grafite-500">{o.items.map((i) => `${i.quantity}× ${i.name}`).join(", ") || "Sem itens"}</p>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-grafite-500">
        {o.payment_mode && <span>{PAYMENT_LABEL[o.payment_mode]}</span>}
        {o.logistics_mode && <span>{LOGISTICS_LABEL[o.logistics_mode]}</span>}
        {o.paid && <span className="font-semibold text-agua-600">Pagamento confirmado</span>}
        {Number(o.delivery_fee_total) > 0 && (
          <span>
            Entregas: {formatBRL(Number(o.delivery_fee_total))} ({o.payment_mode === "app" ? "pagas pelo app" : "pagas ao entregador"})
          </span>
        )}
      </div>

      {o.status !== "cancelado" && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <ChatButton kind="pedido" args={{ orderId: o.id }} basePath="/cliente/mensagens" label="Falar com a lavanderia" />
          {review?.can_review_provider &&
            (review.provider_rating ? (
              <button type="button" onClick={onReview} className="inline-flex items-center gap-2 rounded-xl px-2 py-1 text-xs text-grafite-500 hover:bg-nevoa" data-testid="review-done">
                <StarsDisplay value={review.provider_rating} /> Sua avaliação · alterar
              </button>
            ) : (
              <button type="button" onClick={onReview} className={buttonClass("primary") + " h-9"} data-testid="review-open">
                <Star className="h-4 w-4" aria-hidden /> Avaliar pedido
              </button>
            ))}
        </div>
      )}
      {err && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{err}</p>}
      {stage?.can_confirm && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl bg-agua-50 p-3" data-testid="confirm-box">
          <span className="flex-1 text-sm text-petroleo">
            <strong>Recebeu tudo certo?</strong> Confirme para concluir o pedido. Se algo deu errado, relate o problema.
          </span>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setDisputing(true)} className={buttonClass("outline") + " h-9"} data-testid="dispute-open">
              Relatar problema
            </button>
            <button type="button" disabled={busy} onClick={() => void confirm()} className={buttonClass("primary") + " h-9"} data-testid="confirm-received">
              <Check className="h-4 w-4" aria-hidden /> Confirmar recebimento
            </button>
          </div>
        </div>
      )}
      {stage?.dispute && (stage.dispute.status === "aberta" || o.status !== "cancelado") && (
        <div className="mt-3">
          <DisputePanel dispute={stage.dispute} viewer="cliente" onChanged={() => onChanged?.()} />
        </div>
      )}
      {pix && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl bg-amber-50 p-3">
          <span className="flex-1 text-sm font-semibold text-amber-800">Aguardando pagamento: o pedido começa depois do Pix.</span>
          <Link to={`/cliente/pagar/${o.id}`} className={buttonClass("primary")}>
            <QrCode className="h-4 w-4" aria-hidden /> Pagar {formatBRL(grandTotal(o))}
          </Link>
        </div>
      )}
      {o.logistics_mode === "entregador" && (
        <div className="mt-3 rounded-xl bg-nevoa p-2">
          <OrderDeliveriesCard orderId={o.id} compact />
        </div>
      )}
      {o.business_whatsapp && (
        <a
          href={whatsappLink(o.business_whatsapp, `Olá! Sobre o meu pedido nº ${o.number}.`)}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-petroleo hover:underline"
        >
          <MessageCircle className="h-4 w-4" aria-hidden /> Falar com a lavanderia
        </a>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-grafite/5 pt-3">
        <TimelineToggle orderId={o.id} refreshKey={`${o.status}-${o.paid}-${stage?.dispute?.status ?? ""}-${stage?.client_confirmed_at ?? ""}`} />
        {stage?.can_dispute && !stage.can_confirm && (
          <button type="button" onClick={() => setDisputing(true)} className="text-xs font-semibold text-grafite-500 hover:text-red-700 hover:underline" data-testid="dispute-open">
            Relatar um problema
          </button>
        )}
      </div>
      {disputing && (
        <DisputeModal
          orderId={o.id}
          orderNumber={o.number}
          side="cliente"
          onClose={() => setDisputing(false)}
          onDone={() => {
            setDisputing(false);
            onChanged?.();
          }}
        />
      )}
    </li>
  );
}
