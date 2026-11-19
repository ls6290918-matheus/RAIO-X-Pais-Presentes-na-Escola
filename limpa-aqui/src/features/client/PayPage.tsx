import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, QrCode } from "lucide-react";
import { Alert, Card, EmptyState, InlineLoader, PageHeader, buttonClass } from "@/components/shared/ui";
import { SimpleLayout } from "@/components/layout/SimpleLayout";
import { PixCheckout } from "@/components/shared/PixCheckout";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { formatBRL } from "@/lib/format";

type MyOrder = { id: string; number: number; status: string; paid: boolean; payment_mode: string | null; total: number; delivery_fee_total: number; business_name: string };

/** /cliente/pagar/:id — Pix do pedido pago pelo app. O CPF só segue para o gateway: não é guardado. */
export default function PayPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState<MyOrder | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const loadOrder = useCallback(async () => {
    const { data } = await supabase.rpc("my_orders");
    const o = ((data as MyOrder[]) ?? []).find((x) => x.id === id) ?? null;
    setOrder(o);
    return Boolean(o?.paid);
  }, [id]);

  useEffect(() => {
    void loadOrder();
  }, [loadOrder]);

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

  const total = Number(order.total) + Number(order.delivery_fee_total ?? 0);

  return (
    <SimpleLayout>
      <div className="mx-auto max-w-lg space-y-6">
        {back}
        <PageHeader title={`Pagar pedido nº ${order.number}`} description={`${order.business_name} · ${formatBRL(total)}`} />
        {error && <Alert>{error}</Alert>}
        {order.paid ? (
          <Card className="p-6 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-agua-600" aria-hidden />
            <p className="mt-3 text-lg font-semibold text-petroleo" data-testid="pay-done">
              Pagamento confirmado!
            </p>
            <p className="mt-1 text-sm text-grafite-500">A lavanderia já foi avisada e o seu pedido começa agora.</p>
            <Link to="/cliente" className={buttonClass("primary") + " mt-5"}>
              Ver meus pedidos
            </Link>
          </Card>
        ) : order.status === "cancelado" ? (
          <Card className="p-6 text-sm text-grafite-500">Este pedido foi cancelado.</Card>
        ) : (
          <Card className="space-y-4 p-6">
            <PixCheckout
              kind="order"
              id={id}
              onRefresh={loadOrder}
              note="O pagamento é processado pela SyncPay e recebido pelo Limpa Aqui, que repassa à lavanderia. Se o pedido for cancelado depois de pago, o valor é devolvido."
            />
            <button type="button" className="w-full text-center text-xs font-semibold text-grafite-500 hover:underline" onClick={() => void cancel()}>
              Desistir e cancelar o pedido
            </button>
          </Card>
        )}
      </div>
    </SimpleLayout>
  );
}
