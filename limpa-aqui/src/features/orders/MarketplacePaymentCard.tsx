import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Paperclip } from "lucide-react";
import { Alert, Button, Card, Field, Input, Modal, Select } from "@/components/shared/ui";
import { useBusiness } from "@/contexts/BusinessContext";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { formatBRL, formatDateTime, moneyInput, parseMoney } from "@/lib/format";
import { uploadEvidence } from "@/lib/evidence";
import { PAYMENT_LABEL } from "@/lib/marketplace";
import type { PaymentMode } from "@/lib/types";

type Finance = {
  confirmation: { amount: number; method: "pix" | "dinheiro" | "cartao" | "outro"; confirmed_at: string; has_evidence: boolean } | null;
  commission: { amount: number; percent: number; fixed: number; status: "prevista" | "a_cobrar" | "paga" | "cancelada" } | null;
};

const METHOD_LABEL = { pix: "Pix", dinheiro: "Dinheiro", cartao: "Cartão", outro: "Outro" } as const;
const COMMISSION_LABEL = { prevista: "prevista", a_cobrar: "a pagar ao Limpa Aqui", paga: "paga", cancelada: "cancelada" } as const;

/** Pagamento de pedido do marketplace: o prestador confirma o recebimento (o "pago" não muda por interruptor). */
export function MarketplacePaymentCard({
  order,
  onChanged,
}: {
  order: { id: string; business_id: string; total: number; status: string; paid: boolean; payment_mode?: PaymentMode | null };
  onChanged: () => Promise<void>;
}) {
  const { role } = useBusiness();
  const [fin, setFin] = useState<Finance | null>(null);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<keyof typeof METHOD_LABEL>("pix");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc("order_finance", { p_order_id: order.id });
    setFin((data as Finance) ?? { confirmation: null, commission: null });
  }, [order.id]);

  useEffect(() => {
    void load();
  }, [load, order.paid, order.status]);

  async function confirm() {
    const value = parseMoney(amount);
    if (!value || value <= 0) return setError("Informe o valor recebido.");
    setBusy(true);
    setError(null);
    try {
      const path = file ? await uploadEvidence(file, order.business_id, order.id) : null;
      const { error: err } = await supabase.rpc("confirm_direct_payment", { p_order_id: order.id, p_amount: value, p_method: method, p_evidence_path: path });
      if (err) throw new Error(friendlyError(err));
      setOpen(false);
      await onChanged();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const c = fin?.confirmation;
  return (
    <Card className="p-6" >
      <h2 className="text-base font-semibold text-petroleo">Pagamento</h2>
      <p className="mt-1 text-xs text-grafite-500">{order.payment_mode ? PAYMENT_LABEL[order.payment_mode] : ""} · pedido feito pelo Limpa Aqui</p>
      {c ? (
        <p className="mt-3 flex items-start gap-2 text-sm text-grafite" data-testid="payment-confirmed">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-agua-600" aria-hidden />
          <span>
            Recebido {formatBRL(c.amount)} por {METHOD_LABEL[c.method]} em {formatDateTime(c.confirmed_at)}
            {c.has_evidence && (
              <span className="ml-1 inline-flex items-center gap-1 text-xs text-grafite-500">
                <Paperclip className="h-3 w-3" aria-hidden /> comprovante anexado
              </span>
            )}
          </span>
        </p>
      ) : order.status === "cancelado" ? (
        <p className="mt-3 text-sm text-grafite-500">Pedido cancelado.</p>
      ) : (
        <>
          <p className="mt-3 text-sm text-grafite">A receber: {formatBRL(order.total)}</p>
          <Button
            className="mt-3"
            block
            onClick={() => {
              setAmount(moneyInput(order.total));
              setFile(null);
              setError(null);
              setOpen(true);
            }}
          >
            Confirmar recebimento
          </Button>
        </>
      )}
      {role === "owner" && fin?.commission && (
        <p className="mt-3 border-t border-grafite/5 pt-3 text-xs text-grafite-500" data-testid="commission-line">
          Comissão do Limpa Aqui: <strong className="text-grafite">{formatBRL(fin.commission.amount)}</strong> ({COMMISSION_LABEL[fin.commission.status]}
          {Number(fin.commission.percent) > 0 && ` · ${String(fin.commission.percent).replace(".", ",")}%`}
          {Number(fin.commission.fixed) > 0 && ` + ${formatBRL(fin.commission.fixed)}`})
        </p>
      )}

      {open && (
        <Modal open title="Confirmar recebimento" onClose={() => setOpen(false)}>
          <div className="space-y-4">
            <p className="text-sm text-grafite-500">Confirme só depois de receber de verdade. A confirmação fica registrada e não pode ser desfeita.</p>
            {error && <Alert>{error}</Alert>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Valor recebido (R$)" htmlFor="pay-amount">
                <Input id="pay-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </Field>
              <Field label="Forma" htmlFor="pay-method">
                <Select id="pay-method" value={method} onChange={(e) => setMethod(e.target.value as keyof typeof METHOD_LABEL)}>
                  {Object.entries(METHOD_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Comprovante (opcional)" htmlFor="pay-file" hint="Foto ou print do Pix/recibo. Fica guardado só para você e a administração.">
              <Input id="pay-file" type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Voltar
              </Button>
              <Button loading={busy} onClick={() => void confirm()}>
                Confirmar recebimento
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </Card>
  );
}
