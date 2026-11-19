import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Card, Field, Input, Modal, Select, Textarea, cn } from "@/components/shared/ui";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { formatBRL, formatDate, parseMoney } from "@/lib/format";
import { syncpay } from "@/lib/syncpay";

type Settings = { app_payment_enabled: boolean; app_payment_min_amount: number; updated_at: string };
type Payout = {
  id: string;
  payee_type: "prestador" | "entregador";
  payee_name: string | null;
  pix_key_type: string | null;
  pix_key: string | null;
  holder_name: string | null;
  order_number: number | null;
  business_name: string | null;
  amount: number;
  status: "pendente" | "bloqueado" | "pago" | "cancelado";
  reference: string | null;
  paid_at: string | null;
  created_at: string;
};
type Tx = {
  id: string;
  order_number: number | null;
  business_name: string | null;
  payer_name: string | null;
  amount: number;
  net_amount: number | null;
  status: string;
  applied: boolean;
  needs_refund: boolean;
  refund_requested_at: string | null;
  paid_at: string | null;
  created_at: string;
};

const PAYOUT_LABEL = { pendente: "A pagar", bloqueado: "Suspenso", pago: "Pago", cancelado: "Cancelado" } as const;
const TX_LABEL: Record<string, string> = {
  pending: "Aguardando Pix",
  completed: "Pago",
  failed: "Expirou",
  refused: "Recusado",
  three_ds_failed: "Recusado",
  refunding: "Estornando",
  refunded: "Estornado",
  chargeback: "Contestado",
  med: "MED aberto",
};
const REASONS = [
  ["buyer_withdrawal", "Cliente desistiu"],
  ["product_not_delivered", "Serviço não prestado"],
  ["product_divergent", "Serviço diferente do combinado"],
  ["duplicate_charge", "Cobrança em duplicidade"],
  ["unrecognized_purchase", "Cliente não reconheceu"],
  ["other", "Outro"],
] as const;

/** Administração → Pagamentos pelo app: liga/desliga, repasses a fazer e cobranças a devolver. */
export function AdminPayments() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [min, setMin] = useState("");
  const [filter, setFilter] = useState<"pendente" | "bloqueado" | "pago" | "">("pendente");
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [paying, setPaying] = useState<Payout | null>(null);
  const [ref, setRef] = useState("");
  const [refunding, setRefunding] = useState<Tx | null>(null);
  const [reason, setReason] = useState<string>("duplicate_charge");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  const load = useCallback(async () => {
    const [s, p, t] = await Promise.all([
      supabase.rpc("admin_platform_settings"),
      supabase.rpc("admin_list_payouts", { p_status: filter || null }),
      supabase.rpc("admin_app_transactions", { p_only_attention: false }),
    ]);
    const err = s.error ?? p.error ?? t.error;
    if (err) setMsg({ kind: "error", text: friendlyError(err) });
    const st = s.data as Settings | null;
    setSettings(st);
    if (st) setMin(String(st.app_payment_min_amount).replace(".", ","));
    setPayouts((p.data as Payout[]) ?? []);
    setTxs((t.data as Tx[]) ?? []);
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(key: string, fn: () => PromiseLike<{ error: unknown }>, ok: string) {
    setBusy(key);
    setMsg(null);
    const { error } = await fn();
    setBusy(null);
    if (error) return setMsg({ kind: "error", text: friendlyError(error) }), false;
    setMsg({ kind: "success", text: ok });
    await load();
    return true;
  }

  const toggle = (on: boolean) => {
    if (on && !window.confirm("Ligar o pagamento pelo app? Só ligue depois de configurar as credenciais da SyncPay e o aviso (webhook).")) return;
    void run("switch", () => supabase.rpc("admin_set_app_payment", { p_enabled: on, p_min_amount: parseMoney(min) ?? null }), on ? "Pagamento pelo app ligado." : "Pagamento pelo app desligado.");
  };

  async function refund() {
    if (!refunding) return;
    setBusy("refund");
    setMsg(null);
    try {
      await syncpay({ action: "refund", transaction_id: refunding.id, reason, details });
      setRefunding(null);
      setMsg({ kind: "success", text: "Estorno pedido à SyncPay. O status muda sozinho quando ela concluir." });
      await load();
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const toRefund = txs.filter((t) => t.needs_refund || ["refunding", "med", "chargeback"].includes(t.status));
  const totalShown = payouts.filter((p) => p.status === "pendente").reduce((s, p) => s + Number(p.amount), 0);

  return (
    <div className="space-y-6">
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      <Card className="space-y-4 p-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-petroleo">Pagamento pelo app (Pix via SyncPay)</h2>
            <p className="mt-1 text-xs text-grafite-500">
              O cliente paga ao Limpa Aqui; a plataforma retém a comissão e repassa a prestadores e entregadores. Desligado, ninguém contrata pelo app (pedidos já pagos seguem normalmente).
            </p>
          </div>
          <span className={cn("rounded-full px-3 py-1 text-xs font-semibold", settings?.app_payment_enabled ? "bg-agua-50 text-agua-600" : "bg-nevoa text-grafite-500")} data-testid="app-switch-state">
            {settings?.app_payment_enabled ? "Ligado" : "Desligado"}
          </span>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-40">
            <Field label="Valor mínimo (R$)" htmlFor="app-min">
              <Input id="app-min" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} />
            </Field>
          </div>
          {settings?.app_payment_enabled ? (
            <>
              <Button variant="outline" loading={busy === "switch"} onClick={() => toggle(true)}>
                Salvar mínimo
              </Button>
              <Button variant="outline" disabled={busy === "switch"} onClick={() => toggle(false)}>
                Desligar
              </Button>
            </>
          ) : (
            <Button loading={busy === "switch"} onClick={() => toggle(true)}>
              Ligar pagamento pelo app
            </Button>
          )}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 p-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-petroleo">Repasses</h2>
            <p className="text-xs text-grafite-500">Pague pelo Pix do seu banco e marque como pago com a referência (ex.: código da transferência).</p>
          </div>
          <div className="w-40">
            <Select aria-label="Filtrar repasses" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
              <option value="pendente">A pagar</option>
              <option value="bloqueado">Suspensos</option>
              <option value="pago">Pagos</option>
              <option value="">Todos</option>
            </Select>
          </div>
        </div>
        {filter === "pendente" && payouts.length > 0 && <p className="px-4 pb-2 text-sm text-grafite">Total a pagar: <strong>{formatBRL(totalShown)}</strong></p>}
        {payouts.length === 0 ? (
          <p className="px-4 pb-5 text-sm text-grafite-500">Nenhum repasse aqui.</p>
        ) : (
          <ul className="divide-y divide-grafite/5 border-t border-grafite/5" data-testid="payout-list">
            {payouts.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-semibold text-grafite">
                    {p.payee_name ?? "—"} <span className="font-normal text-grafite-500">· {p.payee_type === "prestador" ? "prestador" : "entregador"}</span>
                  </p>
                  <p className="break-all text-xs text-grafite-500">
                    {p.pix_key ? `Pix ${p.pix_key} (${p.holder_name})` : "Sem chave Pix cadastrada"}
                    {p.order_number ? ` · pedido nº ${p.order_number}${p.payee_type === "entregador" && p.business_name ? ` (${p.business_name})` : ""}` : ""} · {formatDate(p.created_at)}
                    {p.reference ? ` · ref. ${p.reference}` : ""}
                  </p>
                </div>
                <span className="text-sm font-semibold text-grafite">{formatBRL(Number(p.amount))}</span>
                <span className="rounded-full bg-nevoa px-2.5 py-1 text-xs font-semibold text-grafite-500">{PAYOUT_LABEL[p.status]}</span>
                {p.status === "pendente" && (
                  <Button
                    className="h-9"
                    disabled={!p.pix_key}
                    onClick={() => {
                      setPaying(p);
                      setRef("");
                    }}
                  >
                    Marcar pago
                  </Button>
                )}
                {p.status === "bloqueado" && (
                  <Button variant="outline" className="h-9" loading={busy === p.id} onClick={() => void run(p.id, () => supabase.rpc("admin_set_payout_status", { p_payout_id: p.id, p_status: "pendente" }), "Repasse liberado.")}>
                    Liberar
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="p-4">
          <h2 className="text-base font-semibold text-petroleo">Cobranças que pedem atenção</h2>
          <p className="text-xs text-grafite-500">Pix pago em duplicidade, de pedido cancelado ou com valor diferente (a devolver), estornos em andamento e contestações.</p>
        </div>
        {toRefund.length === 0 ? (
          <p className="px-4 pb-5 text-sm text-grafite-500">Nada pendente.</p>
        ) : (
          <ul className="divide-y divide-grafite/5 border-t border-grafite/5" data-testid="tx-attention">
            {toRefund.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-semibold text-grafite">
                    {t.payer_name ?? "Cliente"} {t.order_number ? `· pedido nº ${t.order_number}` : ""} {t.business_name ? `· ${t.business_name}` : ""}
                  </p>
                  <p className="text-xs text-grafite-500">
                    {TX_LABEL[t.status] ?? t.status}
                    {t.needs_refund && " · a devolver ao cliente"}
                    {t.refund_requested_at && ` · estorno pedido em ${formatDate(t.refund_requested_at)}`}
                  </p>
                </div>
                <span className="text-sm font-semibold text-grafite">{formatBRL(Number(t.amount))}</span>
                {t.status === "completed" && !t.refund_requested_at && (
                  <Button
                    variant="outline"
                    className="h-9"
                    onClick={() => {
                      setRefunding(t);
                      setReason(t.needs_refund && t.applied ? "buyer_withdrawal" : "duplicate_charge");
                      setDetails("");
                    }}
                  >
                    Estornar
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {paying && (
        <Modal open title="Marcar repasse como pago" onClose={() => setPaying(null)}>
          <div className="space-y-4">
            <p className="text-sm text-grafite">
              {formatBRL(Number(paying.amount))} para {paying.holder_name} (Pix {paying.pix_key}). Marque só depois de transferir.
            </p>
            <Field label="Referência (opcional)" htmlFor="payout-ref" hint="Ex.: ID da transferência no seu banco.">
              <Input id="payout-ref" maxLength={120} value={ref} onChange={(e) => setRef(e.target.value)} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setPaying(null)}>
                Voltar
              </Button>
              <Button
                loading={busy === "pay"}
                onClick={() =>
                  void run("pay", () => supabase.rpc("admin_set_payout_status", { p_payout_id: paying.id, p_status: "pago", p_reference: ref.trim() || null }), "Repasse marcado como pago.").then(
                    (ok) => ok && setPaying(null),
                  )
                }
              >
                Confirmar pagamento
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {refunding && (
        <Modal open title="Estornar Pix ao cliente" onClose={() => setRefunding(null)}>
          <div className="space-y-4">
            <p className="text-sm text-grafite">
              {formatBRL(Number(refunding.amount))} voltam para {refunding.payer_name ?? "o cliente"}. A SyncPay retém o valor + R$ 1,00 de taxa do seu saldo até concluir.
            </p>
            <Field label="Motivo" htmlFor="rf-reason">
              <Select id="rf-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
                {REASONS.map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="O que aconteceu" htmlFor="rf-details" hint={`${details.trim().length}/1000 (mínimo 20). A SyncPay lê isto para aprovar.`}>
              <Textarea id="rf-details" rows={3} maxLength={1000} value={details} onChange={(e) => setDetails(e.target.value)} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setRefunding(null)}>
                Voltar
              </Button>
              <Button loading={busy === "refund"} disabled={details.trim().length < 20} onClick={() => void refund()}>
                Pedir estorno
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
