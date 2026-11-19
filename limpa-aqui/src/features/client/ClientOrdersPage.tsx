import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Package } from "lucide-react";
import { Card, EmptyState, InlineLoader, PageHeader, buttonClass, cn } from "@/components/shared/ui";
import { supabase } from "@/lib/supabase";
import { ClientShell } from "./ClientShell";
import { OrderCard } from "./OrderTracker";
import { isActiveOrder, type MyOrder } from "./clientTypes";

/** /cliente/pedidos — pedidos do cliente, com as etapas de cada um. */
export default function ClientOrdersPage() {
  const [orders, setOrders] = useState<MyOrder[] | null>(null);
  const [tab, setTab] = useState<"andamento" | "todos">("andamento");

  useEffect(() => {
    void supabase.rpc("my_orders").then(({ data }) => setOrders((data as MyOrder[]) ?? []));
  }, []);

  const active = (orders ?? []).filter(isActiveOrder);
  const shown = tab === "andamento" ? active : orders ?? [];

  return (
    <ClientShell>
      <div className="space-y-5">
        <PageHeader title="Pedidos" description="Acompanhe cada etapa: recebido, lavando, pronto e entregue." />
        <div className="inline-flex rounded-xl bg-white p-1 shadow-sm" role="tablist">
          {(
            [
              ["andamento", `Em andamento${orders ? ` (${active.length})` : ""}`],
              ["todos", "Todos"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={cn("rounded-lg px-4 py-2 text-sm font-semibold", tab === k ? "bg-petroleo text-white" : "text-grafite-500")}
            >
              {label}
            </button>
          ))}
        </div>
        {orders === null ? (
          <InlineLoader />
        ) : shown.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Package className="h-6 w-6" />}
              title={tab === "andamento" ? "Nenhum pedido em andamento" : "Nenhum pedido ainda"}
              description="Encontre uma lavanderia perto de você e contrate pelo Limpa Aqui."
              action={
                <Link to="/buscar" className={buttonClass()}>
                  Buscar lavanderias
                </Link>
              }
            />
          </Card>
        ) : (
          <ul className="space-y-3" data-testid="order-list">
            {shown.map((o) => (
              <OrderCard key={o.id} order={o} />
            ))}
          </ul>
        )}
      </div>
    </ClientShell>
  );
}
