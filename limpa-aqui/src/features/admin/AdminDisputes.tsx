import { useCallback, useEffect, useState } from "react";
import { Scale } from "lucide-react";
import { Alert, Button, Card, EmptyState, InlineLoader, Modal, Select, Textarea, cn } from "@/components/shared/ui";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { formatBRL, formatDateTime } from "@/lib/format";
import { PAYMENT_LABEL } from "@/lib/marketplace";
import { STATUS_LABEL } from "@/features/orders/status";
import { DISPUTE_REASON, OrderTimeline, RESOLUTION_LABEL, type DisputeReason } from "@/features/orders/OrderTimeline";
import type { OrderStatus, PaymentMode } from "@/lib/types";

type Row = {
  id: string;
  order_id: string;
  order_number: number;
  business_name: string;
  client_name: string;
  opened_by_role: "cliente" | "prestador";
  reason: DisputeReason;
  description: string;
  response: string | null;
  responded_at: string | null;
  status: "aberta" | "resolvida";
  resolution: keyof typeof RESOLUTION_LABEL | null;
  resolution_note: string | null;
  resolved_at: string | null;
  created_at: string;
  order_status: OrderStatus;
  payment_mode: PaymentMode | null;
  paid: boolean;
  amount: number;
  payouts_held: number;
  payouts_paid: number;
};

/** Administração → Disputas: relato das duas partes, histórico do pedido e decisão (com efeito nos repasses). */
export function AdminDisputes() {
  const [filter, setFilter] = useState<"aberta" | "resolvida" | "todas">("aberta");
  const [list, setList] = useState<Row[] | null>(null);
  const [open, setOpen] = useState<Row | null>(null);
  const [decision, setDecision] = useState<"" | keyof typeof RESOLUTION_LABEL>("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setList(null);
    const { data, error: err } = await supabase.rpc("admin_disputes", { p_status: filter === "todas" ? null : filter });
    if (err) setError(friendlyError(err));
    setList((data as Row[]) ?? []);
  }, [filter]);
  useEffect(() => {
    void load();
  }, [load]);

  async function resolve() {
    if (!open) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.rpc("admin_resolve_dispute", { p_dispute_id: open.id, p_resolution: decision, p_note: note });
    setBusy(false);
    if (err) return setError(friendlyError(err));
    setOpen(null);
    await load();
  }

  const appPaid = open?.payment_mode === "app" && open.paid;
  return (
    <div className="space-y-4" data-testid="admin-disputes">
      {error && !open && <Alert>{error}</Alert>}
      <div className="sm:w-56">
        <Select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Filtrar disputas">
          <option value="aberta">Abertas</option>
          <option value="resolvida">Resolvidas</option>
          <option value="todas">Todas</option>
        </Select>
      </div>
      {list === null ? (
        <InlineLoader />
      ) : list.length === 0 ? (
        <Card>
          <EmptyState icon={<Scale className="h-6 w-6" />} title={filter === "aberta" ? "Nenhuma disputa aberta" : "Nenhuma disputa"} description="Quando um cliente ou uma lavanderia relatar um problema num pedido, ele aparece aqui." />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-grafite/5">
            {list.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-grafite">
                    Pedido nº {r.order_number} · {r.client_name} ↔ {r.business_name}
                  </p>
                  <p className="text-xs text-grafite-500">
                    {DISPUTE_REASON[r.reason]} · aberta {r.opened_by_role === "cliente" ? "pelo cliente" : "pela lavanderia"} em {formatDateTime(r.created_at)}
                    {r.response ? " · respondida" : " · sem resposta"}
                  </p>
                  <p className="mt-1 text-xs text-grafite-500">
                    {formatBRL(Number(r.amount))} · {r.payment_mode ? PAYMENT_LABEL[r.payment_mode] : "—"} {r.paid ? "(pago)" : "(não pago)"}
                    {Number(r.payouts_held) > 0 && <strong className="text-amber-800"> · {formatBRL(Number(r.payouts_held))} retidos</strong>}
                  </p>
                </div>
                <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", r.status === "aberta" ? "bg-amber-50 text-amber-800" : "bg-nevoa text-grafite-500")}>
                  {r.status === "aberta" ? "Aberta" : RESOLUTION_LABEL[r.resolution!]}
                </span>
                <Button
                  variant="outline"
                  className="h-9"
                  onClick={() => {
                    setOpen(r);
                    setDecision("");
                    setNote("");
                    setError(null);
                  }}
                >
                  {r.status === "aberta" ? "Analisar" : "Ver"}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {open && (
        <Modal open title={`Disputa · pedido nº ${open.order_number}`} onClose={() => setOpen(null)}>
          <div className="space-y-4" data-testid="dispute-review">
            <div className="rounded-xl bg-nevoa p-3 text-sm">
              <p className="text-[11px] font-semibold uppercase text-grafite-500">
                {open.opened_by_role === "cliente" ? `Cliente (${open.client_name})` : `Lavanderia (${open.business_name})`} · {DISPUTE_REASON[open.reason]}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-grafite">{open.description}</p>
            </div>
            <div className="rounded-xl bg-nevoa p-3 text-sm">
              <p className="text-[11px] font-semibold uppercase text-grafite-500">
                Resposta {open.opened_by_role === "cliente" ? `da lavanderia (${open.business_name})` : `do cliente (${open.client_name})`}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-grafite">{open.response ?? "Ainda sem resposta."}</p>
            </div>
            <p className="text-xs text-grafite-500">
              Pedido {STATUS_LABEL[open.order_status].toLowerCase()} · {formatBRL(Number(open.amount))} · {open.payment_mode ? PAYMENT_LABEL[open.payment_mode] : "—"} {open.paid ? "(pago)" : "(não pago)"} · repasses retidos{" "}
              {formatBRL(Number(open.payouts_held))} · já pagos {formatBRL(Number(open.payouts_paid))}
            </p>
            <details className="rounded-xl border border-grafite/10 p-3">
              <summary className="cursor-pointer text-sm font-semibold text-petroleo">Histórico do pedido</summary>
              <div className="mt-3">
                <OrderTimeline orderId={open.order_id} />
              </div>
            </details>
            {open.status === "aberta" ? (
              <div className="space-y-3">
                {error && <Alert>{error}</Alert>}
                <Select value={decision} onChange={(e) => setDecision(e.target.value as typeof decision)} aria-label="Decisão">
                  <option value="">Escolha a decisão</option>
                  <option value="favor_cliente">A favor do cliente</option>
                  <option value="favor_prestador">A favor da lavanderia</option>
                  <option value="acordo">Acordo entre as partes</option>
                </Select>
                {decision && (
                  <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    {decision === "favor_cliente"
                      ? appPaid
                        ? "O Pix vai para a fila de devolução em Pagamentos pelo app, os repasses não pagos são cancelados e a comissão é cancelada."
                        : "Pagamento direto: a plataforma não guarda o dinheiro. A decisão fica registrada e as duas partes são avisadas."
                      : "Os repasses retidos por esta disputa voltam a valer e podem ser pagos."}
                  </p>
                )}
                <Textarea rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Explicação da decisão" placeholder="Explique a decisão. As duas partes recebem este texto." />
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setOpen(null)}>
                    Fechar
                  </Button>
                  <Button loading={busy} disabled={!decision || !note.trim()} onClick={() => void resolve()}>
                    Registrar decisão
                  </Button>
                </div>
              </div>
            ) : (
              <div className="rounded-xl bg-agua-50 p-3 text-sm text-petroleo">
                <strong>{RESOLUTION_LABEL[open.resolution!]}</strong> em {formatDateTime(open.resolved_at!)}: {open.resolution_note}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
