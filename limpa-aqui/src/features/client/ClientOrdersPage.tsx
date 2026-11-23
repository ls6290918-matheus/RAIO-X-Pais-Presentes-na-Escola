import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Package } from "lucide-react";
import { Card, EmptyState, InlineLoader, PageHeader, buttonClass, cn } from "@/components/shared/ui";
import { supabase } from "@/lib/supabase";
import { ClientShell } from "./ClientShell";
import { OrderCard } from "./OrderTracker";
import { isActiveOrder, type MyOrder } from "./clientTypes";
import { ReviewModal, type ReviewStatus } from "./ReviewModal";
import { loadStageInfo, type StageInfo } from "@/features/orders/OrderTimeline";

/** /cliente/pedidos — pedidos do cliente, com as etapas de cada um. */
export default function ClientOrdersPage() {
  const [orders, setOrders] = useState<MyOrder[] | null>(null);
  const [tab, setTab] = useState<"andamento" | "todos">("andamento");
  const [reviews, setReviews] = useState<Map<string, ReviewStatus>>(new Map());
  const [reviewing, setReviewing] = useState<MyOrder | null>(null);
  const [thanks, setThanks] = useState(false);
  const [stages, setStages] = useState<Map<string, StageInfo>>(new Map());

  const load = useCallback(async () => {
    const { data } = await supabase.rpc("my_orders");
    const list = (data as MyOrder[]) ?? [];
    setOrders(list);
    setStages(await loadStageInfo(list.filter((o) => o.status !== "orcamento").map((o) => o.id)));
    const done = list.filter((o) => o.status === "entregue").map((o) => o.id);
    if (done.length) {
      const r = await supabase.rpc("my_review_status", { p_order_ids: done });
      setReviews(new Map(((r.data as ReviewStatus[]) ?? []).map((x) => [x.order_id, x])));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // em andamento também: entregue esperando a confirmação do cliente ou com disputa aberta
  const active = (orders ?? []).filter((o) => isActiveOrder(o) || stages.get(o.id)?.can_confirm || stages.get(o.id)?.dispute?.status === "aberta");
  const shown = tab === "andamento" ? active : orders ?? [];

  return (
    <ClientShell>
      <div className="space-y-5">
        <PageHeader title="Pedidos" description="Acompanhe cada etapa, confirme o recebimento e relate problemas." />
        {thanks && (
          <div onClick={() => setThanks(false)} className="rounded-xl bg-agua-50 px-4 py-3 text-sm font-medium text-petroleo" role="status">
            Obrigado pela avaliação! Ela ajuda outras pessoas a escolher.
          </div>
        )}
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
              <OrderCard key={o.id} order={o} review={reviews.get(o.id)} onReview={() => setReviewing(o)} stage={stages.get(o.id)} onChanged={() => void load()} />
            ))}
          </ul>
        )}
      </div>
      {reviewing && reviews.get(reviewing.id) && (
        <ReviewModal
          businessName={reviewing.business_name}
          status={reviews.get(reviewing.id)!}
          onClose={() => setReviewing(null)}
          onSaved={() => {
            setReviewing(null);
            setThanks(true);
            void load();
          }}
        />
      )}
    </ClientShell>
  );
}
