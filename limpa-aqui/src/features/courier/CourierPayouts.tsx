import { useEffect, useState } from "react";
import { Card } from "@/components/shared/ui";
import { PixKeyForm } from "@/components/shared/PixKeyForm";
import { supabase } from "@/lib/supabase";
import { formatBRL, formatDate } from "@/lib/format";

type Payout = { id: string; order_number: number | null; amount: number; status: "pendente" | "bloqueado" | "pago" | "cancelado"; paid_at: string | null; created_at: string };
const LABEL = { pendente: "A receber", bloqueado: "Suspenso", pago: "Pago", cancelado: "Cancelado" } as const;

/** Corridas de pedidos pagos pelo app: o Limpa Aqui recebe do cliente e repassa ao entregador na chave Pix. */
export function CourierPayouts() {
  const [list, setList] = useState<Payout[]>([]);
  useEffect(() => {
    void supabase.rpc("my_payouts").then(({ data }) => setList((data as Payout[]) ?? []));
  }, []);
  const pending = list.filter((p) => p.status === "pendente").reduce((s, p) => s + Number(p.amount), 0);
  return (
    <Card className="space-y-4 p-5" >
      <div>
        <h2 className="text-base font-semibold text-petroleo">Recebimentos pelo app</h2>
        <p className="mt-1 text-xs text-grafite-500">
          Em pedidos pagos pelo app, o cliente paga a corrida ao Limpa Aqui e você recebe o repasse na sua chave Pix. Nos demais, o cliente paga direto a você.
        </p>
      </div>
      <PixKeyForm businessId={null} />
      {list.length > 0 && (
        <div className="border-t border-grafite/5 pt-3" data-testid="courier-payouts">
          <p className="text-sm text-grafite">
            A receber: <strong>{formatBRL(pending)}</strong>
          </p>
          <ul className="mt-2 divide-y divide-grafite/5 text-sm">
            {list.slice(0, 20).map((p) => (
              <li key={p.id} className="flex items-center justify-between py-2">
                <span className="text-grafite-500">
                  {p.order_number ? `Pedido nº ${p.order_number} · ` : ""}
                  {formatDate(p.created_at)}
                </span>
                <span className="font-semibold text-grafite">
                  {formatBRL(Number(p.amount))} · {LABEL[p.status]}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
