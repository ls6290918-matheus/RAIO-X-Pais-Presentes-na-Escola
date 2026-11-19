import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import QRCode from "qrcode";
import { ArrowLeft, CheckCircle2, Copy, QrCode, ShieldCheck } from "lucide-react";
import { Alert, Button, Card, EmptyState, Field, InlineLoader, Input, PageHeader, buttonClass } from "@/components/shared/ui";
import { SimpleLayout } from "@/components/layout/SimpleLayout";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { formatBRL } from "@/lib/format";
import { isValidCpf, maskCpf, syncpay, type CheckoutResult, type PixCharge } from "@/lib/syncpay";

type MyOrder = { id: string; number: number; status: string; paid: boolean; payment_mode: string | null; total: number; delivery_fee_total: number; business_name: string };

/** /cliente/pagar/:id — Pix do pedido pago pelo app. O CPF só segue para o gateway: não é guardado. */
export default function PayPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState<MyOrder | null | undefined>(undefined);
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

  const loadOrder = useCallback(async () => {
    const { data } = await supabase.rpc("my_orders");
    const o = ((data as MyOrder[]) ?? []).find((x) => x.id === id) ?? null;
    setOrder(o);
    return o;
  }, [id]);

  const checkout = useCallback(
    async (withCpf?: string) => {
      setBusy(true);
      setError(null);
      try {
        const r = await syncpay<CheckoutResult>({ action: "checkout", order_id: id, ...(withCpf ? { cpf: withCpf } : {}) });
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
    [id],
  );

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void loadOrder().then((o) => {
      if (o && o.payment_mode === "app" && !o.paid && o.status !== "cancelado") void checkout();
    });
  }, [loadOrder, checkout]);

  // o webhook confirma o pagamento no banco: a tela só olha o pedido (não consulta o gateway)
  useEffect(() => {
    if (!pix || order?.paid) return;
    const t = window.setInterval(() => void loadOrder(), 5000);
    return () => window.clearInterval(t);
  }, [pix, order?.paid, loadOrder]);

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
      const r = await syncpay<{ paid: boolean; checked: boolean; status: string | null }>({ action: "status", order_id: id });
      const o = await loadOrder();
      if (!r.paid && !o?.paid) setInfo("Ainda não recebemos a confirmação do banco. Pode levar alguns instantes — esta tela atualiza sozinha.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!window.confirm("Cancelar este pedido? Se você já pagou, não cancele: aguarde a confirmação.")) return;
    const { error: err } = await supabase.rpc("cancel_unpaid_app_order", { p_order_id: id });
    if (err) return setError(friendlyError(err));
    navigate("/cliente", { state: { success: "Pedido cancelado." } });
  }

  const back = (
    <Link to="/cliente" className="inline-flex items-center gap-1 text-sm font-semibold text-petroleo hover:underline">
      <ArrowLeft className="h-4 w-4" aria-hidden /> Minha área
    </Link>
  );

  if (order === undefined)
    return (
      <SimpleLayout>
        <InlineLoader />
      </SimpleLayout>
    );

  if (order === null || order.payment_mode !== "app")
    return (
      <SimpleLayout>
        <div className="space-y-6">
          {back}
          <Card>
            <EmptyState icon={<QrCode className="h-6 w-6" />} title="Nada para pagar aqui" description="Este pedido não é pago pelo app ou não está na sua conta." />
          </Card>
        </div>
      </SimpleLayout>
    );

  const total = amount ?? Number(order.total) + Number(order.delivery_fee_total ?? 0);

  return (
    <SimpleLayout>
      <div className="mx-auto max-w-lg space-y-6">
        {back}
        <PageHeader title={`Pagar pedido nº ${order.number}`} description={`${order.business_name} · ${formatBRL(total)}`} />

        {order.paid ? (
          <Card className="p-6 text-center" >
            <CheckCircle2 className="mx-auto h-10 w-10 text-agua-600" aria-hidden />
            <p className="mt-3 text-lg font-semibold text-petroleo" data-testid="pay-done">Pagamento confirmado!</p>
            <p className="mt-1 text-sm text-grafite-500">A lavanderia já foi avisada e o seu pedido começa agora.</p>
            <Link to="/cliente" className={buttonClass("primary") + " mt-5"}>
              Ver meus pedidos
            </Link>
          </Card>
        ) : order.status === "cancelado" ? (
          <Card className="p-6 text-sm text-grafite-500">Este pedido foi cancelado.</Card>
        ) : (
          <Card className="space-y-5 p-6">
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
                  Gerar Pix de {formatBRL(total)}
                </Button>
              </div>
            ) : pix ? (
              <div className="space-y-4 text-center">
                <p className="text-sm text-grafite">Abra o app do seu banco, escolha <strong>Pix</strong> e leia o QR Code ou use o copia e cola.</p>
                {qr && <img src={qr} alt="QR Code do Pix" className="mx-auto h-56 w-56 rounded-xl border border-grafite/10" data-testid="pix-qr" />}
                <p className="text-2xl font-semibold text-petroleo">{formatBRL(pix.amount)}</p>
                <div className="rounded-xl bg-nevoa p-3 text-left">
                  <p className="break-all font-mono text-xs text-grafite" data-testid="pix-code">{pix.pix_code}</p>
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
              O pagamento é processado pela SyncPay e recebido pelo Limpa Aqui, que repassa à lavanderia. Se o pedido for cancelado depois de pago, o valor é devolvido.
            </p>
            <button type="button" className="w-full text-center text-xs font-semibold text-grafite-500 hover:underline" onClick={() => void cancel()}>
              Desistir e cancelar o pedido
            </button>
          </Card>
        )}
      </div>
    </SimpleLayout>
  );
}
