import { useEffect, useState } from "react";
import { Bike } from "lucide-react";
import { Card } from "@/components/shared/ui";
import { supabase } from "@/lib/supabase";
import { formatBRL, formatDateTime } from "@/lib/format";
import { HandoffCode, ProofList, loadProofs, type Proof } from "@/features/courier/DeliveryProofs";

type Leg = {
  id: string;
  leg: "pickup" | "return";
  status: "disponivel" | "aceita" | "coletada" | "entregue" | "cancelada";
  courier_name: string | null;
  delivery_fee: number;
  completed_at: string | null;
};

const LEG = { pickup: "Coleta na casa do cliente", return: "Devolução ao cliente" } as const;
const STATUS = {
  disponivel: "Procurando entregador",
  aceita: "Entregador a caminho da coleta",
  coletada: "Em transporte",
  entregue: "Entregue",
  cancelada: "Cancelada",
} as const;

/** Corridas de coleta e devolução de um pedido com entregador do Limpa Aqui (lavanderia e cliente). */
export function OrderDeliveriesCard({ orderId, refreshKey, compact = false }: { orderId: string; refreshKey?: unknown; compact?: boolean }) {
  const [legs, setLegs] = useState<Leg[] | null>(null);
  const [proofs, setProofs] = useState<Proof[]>([]);
  const [codes, setCodes] = useState<Array<{ delivery_id: string; leg: Leg["leg"]; code: string }>>([]);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [{ data }, c] = await Promise.all([
        supabase.rpc("order_deliveries", { p_order_id: orderId }),
        supabase.rpc("delivery_handoff_codes", { p_order_id: orderId }),
      ]);
      const list = (data as Leg[]) ?? [];
      const pr = await loadProofs(list.filter((l) => l.status === "coletada" || l.status === "entregue").map((l) => l.id));
      if (!alive) return;
      setLegs(list);
      setCodes((c.data as typeof codes) ?? []);
      setProofs(pr);
    })();
    return () => {
      alive = false;
    };
  }, [orderId, refreshKey]);
  if (!legs) return null;
  const body = (
    <ul className="space-y-1.5" data-testid="order-deliveries">
      {legs.length === 0 && <li className="text-xs text-grafite-500">A devolução é chamada quando o pedido fica pronto.</li>}
      {legs.map((l) => (
        <li key={l.id} className="flex flex-wrap items-center gap-x-2 text-xs">
          <span className="font-semibold text-grafite">{LEG[l.leg]}:</span>
          <span className="text-grafite-500">
            {STATUS[l.status]}
            {l.courier_name && l.status !== "disponivel" && ` · ${l.courier_name}`}
            {l.completed_at && ` · ${formatDateTime(l.completed_at)}`}
            {` · ${formatBRL(Number(l.delivery_fee))}`}
          </span>
          {codes.filter((c) => c.delivery_id === l.id).map((c) => (
            <div key={c.delivery_id} className="mt-1.5 w-full">
              <HandoffCode code={c.code} leg={c.leg} />
            </div>
          ))}
          <div className="w-full">
            <ProofList proofs={proofs.filter((p) => p.delivery_id === l.id)} />
          </div>
        </li>
      ))}
      {legs.length === 1 && legs[0].leg === "pickup" && <li className="text-xs text-grafite-500">A devolução é chamada quando o pedido fica pronto.</li>}
    </ul>
  );
  if (compact) return body;
  return (
    <Card className="p-6">
      <h2 className="flex items-center gap-2 text-base font-semibold text-petroleo">
        <Bike className="h-5 w-5" aria-hidden /> Entregadores do Limpa Aqui
      </h2>
      <div className="mt-3">{body}</div>
    </Card>
  );
}
