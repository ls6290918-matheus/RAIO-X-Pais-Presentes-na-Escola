import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PackageOpen, Plus, Search } from "lucide-react";
import { Alert, Card, buttonClass, EmptyState, InlineLoader, Input, PageHeader, cn } from "@/components/shared/ui";
import { useBusiness } from "@/contexts/BusinessContext";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { formatBRL, formatDayShort, searchTerm, todayISO } from "@/lib/format";
import type { Order, OrderStatus } from "@/lib/types";
import { OPEN_STATUSES } from "./status";
import { StatusBadge } from "./StatusBadge";

type Row = Pick<Order, "id" | "number" | "status" | "due_date" | "total" | "paid"> & {
  customers: { name: string } | null;
};

const FILTERS: Array<{ key: string; label: string; statuses: OrderStatus[] | null }> = [
  { key: "abertos", label: "Em aberto", statuses: OPEN_STATUSES },
  { key: "prontos", label: "Prontos", statuses: ["pronto"] },
  { key: "orcamentos", label: "Orçamentos", statuses: ["orcamento"] },
  { key: "entregues", label: "Entregues", statuses: ["entregue"] },
  { key: "cancelados", label: "Cancelados", statuses: ["cancelado"] },
  { key: "todos", label: "Todos", statuses: null },
];

export default function OrdersPage() {
  const { business, settings } = useBusiness();
  const [params, setParams] = useSearchParams();
  const filter = FILTERS.find((f) => f.key === params.get("filtro")) ?? FILTERS[0];
  const [query, setQuery] = useState("");
  const [orders, setOrders] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const today = todayISO(settings?.timezone);

  const load = useCallback(async () => {
    if (!business) return;
    setError(null);
    let req = supabase
      .from("orders")
      .select("id, number, status, due_date, total, paid, customers!inner(name)")
      .eq("business_id", business.id)
      .limit(200);

    if (filter.statuses) req = req.in("status", filter.statuses);
    // Em aberto: o que vence primeiro aparece primeiro. Demais: mais recentes primeiro.
    req = filter.key === "abertos" || filter.key === "prontos"
      ? req.order("due_date").order("number")
      : req.order("number", { ascending: false });

    const q = searchTerm(query.replace(/^#/, ""));
    if (q) req = /^\d+$/.test(q) ? req.eq("number", Number(q)) : req.ilike("customers.name", `%${q}%`);

    const { data, error: err } = await req;
    if (err) setError(friendlyError(err));
    setOrders((data as unknown as Row[]) ?? []);
    setLoading(false);
  }, [business, filter, query]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pedidos"
        description="Acompanhe cada par do recebimento à entrega."
        action={
          <Link to="/app/pedidos/novo" className={buttonClass()}>
            <Plus className="h-4 w-4" aria-hidden /> Novo pedido
          </Link>
        }
      />

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 md:mx-0 md:px-0" role="tablist" aria-label="Filtrar pedidos">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              role="tab"
              aria-selected={f.key === filter.key}
              onClick={() => {
                setLoading(true);
                setParams(f.key === "abertos" ? {} : { filtro: f.key }, { replace: true });
              }}
              className={cn(
                "whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition",
                f.key === filter.key ? "bg-petroleo text-white" : "bg-white text-grafite hover:bg-white/60",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative md:w-72">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-grafite-300" aria-hidden />
          <Input
            aria-label="Buscar pedido"
            placeholder="Nº do pedido ou cliente"
            className="pl-10"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {error && <Alert>{error}</Alert>}

      <Card>
        {loading ? (
          <InlineLoader />
        ) : orders.length === 0 ? (
          <EmptyState
            icon={<PackageOpen className="h-6 w-6" />}
            title={query ? "Nenhum pedido encontrado" : "Nenhum pedido aqui"}
            description={
              query
                ? "Confira o número ou o nome do cliente."
                : "Quando um cliente deixar os calçados, crie o pedido para acompanhar o status e avisar pelo WhatsApp."
            }
            action={
              !query && (
                <Link to="/app/pedidos/novo" className={buttonClass()}>
                  Criar pedido
                </Link>
              )
            }
          />
        ) : (
          <ul className="divide-y divide-grafite/5">
            {orders.map((o) => {
              const late = OPEN_STATUSES.includes(o.status) && o.due_date < today;
              return (
                <li key={o.id}>
                  <Link to={`/app/pedidos/${o.id}`} className="flex items-center gap-3 px-4 py-3.5 transition hover:bg-nevoa/60 sm:px-5">
                    <span className="w-14 shrink-0 text-sm font-semibold text-petroleo">#{o.number}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-grafite">{o.customers?.name}</p>
                      <p className={cn("text-xs", late ? "font-semibold text-red-600" : "text-grafite-500")}>
                        {late ? "Atrasado · " : "Entrega "}
                        {formatDayShort(o.due_date)}
                      </p>
                    </div>
                    <div className="hidden text-right sm:block">
                      <p className="text-sm font-semibold text-petroleo">{formatBRL(o.total)}</p>
                      <p className={cn("text-xs", o.paid ? "text-agua-600" : "text-grafite-500")}>{o.paid ? "Pago" : "A receber"}</p>
                    </div>
                    <StatusBadge status={o.status} className="w-[92px] justify-center" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
