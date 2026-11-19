import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Copy, ShieldCheck } from "lucide-react";
import { Alert, Button, Field, InlineLoader, Input } from "@/components/shared/ui";
import { formatBRL } from "@/lib/format";
import { isValidCpf, maskCpf, syncpay, type CheckoutResult, type PixCharge } from "@/lib/syncpay";

/**
 * Pix pelo app (SyncPay) de um pedido ou de uma mensalidade de plano.
 * Pede o CPF (só segue para o gateway, não é guardado), mostra QR Code e copia e cola,
 * e consulta `onRefresh` a cada 5 s até o pagamento ser confirmado pelo aviso do banco.
 */
export function PixCheckout({
  kind,
  id,
  onRefresh,
  note,
}: {
  kind: "order" | "invoice";
  id: string;
  /** Recarrega o estado na tela; devolve true quando já está pago. */
  onRefresh: () => Promise<boolean>;
  note: string;
}) {
  const [amount, setAmount] = useState<number | null>(null);
  const [needsCpf, setNeedsCpf] = useState(false);
  const [cpf, setCpf] = useState("");
  const [pix, setPix] = useState<PixCharge | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const started = useRef(false);
  const idField = kind === "order" ? { order_id: id } : { invoice_id: id };

  const checkout = useCallback(
    async (withCpf?: string) => {
      setBusy(true);
      setError(null);
      try {
        const r = await syncpay<CheckoutResult>({ action: kind === "order" ? "checkout" : "invoice_checkout", ...idField, ...(withCpf ? { cpf: withCpf } : {}) });
        setAmount(Number(r.amount));
        if ("needs_cpf" in r) {
          setNeedsCpf(true);
        } else {
          setNeedsCpf(false);
          setCpf("");
          setPix(r);
          setQr(await QRCode.toDataURL(r.pix_code, { margin: 1, width: 260 }));
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kind, id],
  );

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void checkout();
  }, [checkout]);

  // o aviso da SyncPay confirma no banco: a tela só relê o estado (não consulta o gateway)
  useEffect(() => {
    if (!pix) return;
    const t = window.setInterval(() => void onRefresh(), 5000);
    return () => window.clearInterval(t);
  }, [pix, onRefresh]);

  async function generate() {
    if (!isValidCpf(cpf)) return setError("CPF inválido. Confira os números.");
    await checkout(cpf);
  }

  async function copy() {
    if (!pix) return;
    try {
      await navigator.clipboard.writeText(pix.pix_code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Não deu para copiar automaticamente. Selecione o código e copie.");
    }
  }

  async function iPaid() {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const r = await syncpay<{ paid: boolean }>({ action: kind === "order" ? "status" : "invoice_status", ...idField });
      const paid = await onRefresh();
      if (!r.paid && !paid) setInfo("Ainda não recebemos a confirmação do banco. Pode levar alguns instantes — esta tela atualiza sozinha.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {error && <Alert>{error}</Alert>}
      {info && <Alert kind="success">{info}</Alert>}
      {busy && !pix && !needsCpf ? (
        <InlineLoader />
      ) : needsCpf ? (
        <div className="space-y-4">
          <Field label="CPF de quem vai pagar" htmlFor="pay-cpf" hint="Exigido pelo banco para gerar o Pix. Usamos só para isso: o Limpa Aqui não guarda o seu CPF.">
            <Input id="pay-cpf" inputMode="numeric" autoComplete="off" placeholder="000.000.000-00" value={cpf} onChange={(e) => setCpf(maskCpf(e.target.value))} />
          </Field>
          <Button block loading={busy} onClick={() => void generate()}>
            Gerar Pix{amount != null ? ` de ${formatBRL(amount)}` : ""}
          </Button>
        </div>
      ) : pix ? (
        <div className="space-y-4 text-center">
          <p className="text-sm text-grafite">
            Abra o app do seu banco, escolha <strong>Pix</strong> e leia o QR Code ou use o copia e cola.
          </p>
          {qr && <img src={qr} alt="QR Code do Pix" className="mx-auto h-56 w-56 rounded-xl border border-grafite/10" data-testid="pix-qr" />}
          <p className="text-2xl font-semibold text-petroleo">{formatBRL(pix.amount)}</p>
          <div className="rounded-xl bg-nevoa p-3 text-left">
            <p className="break-all font-mono text-xs text-grafite" data-testid="pix-code">
              {pix.pix_code}
            </p>
          </div>
          <Button block variant="outline" onClick={() => void copy()}>
            <Copy className="h-4 w-4" aria-hidden /> {copied ? "Código copiado!" : "Copiar código Pix"}
          </Button>
          <Button block loading={busy} onClick={() => void iPaid()}>
            Já paguei
          </Button>
          <p className="text-xs text-grafite-500">Esta tela atualiza sozinha quando o banco confirmar.</p>
        </div>
      ) : (
        <Button block onClick={() => void checkout()}>
          Tentar de novo
        </Button>
      )}
      <p className="flex items-start gap-2 border-t border-grafite/5 pt-4 text-left text-xs text-grafite-500">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-agua-600" aria-hidden />
        {note}
      </p>
    </div>
  );
}
