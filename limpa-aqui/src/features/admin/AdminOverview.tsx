import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BadgePercent, ChevronLeft, ChevronRight, CircleDollarSign, ShoppingBag, Wallet } from "lucide-react";
import { Card, cn } from "@/components/shared/ui";
import { supabase } from "@/lib/supabase";
import { formatBRL, formatDateTime } from "@/lib/format";
import { STATUS_LABEL, STATUS_STYLE } from "@/features/orders/status";
import type { LogisticsMode, OrderStatus, PaymentMode } from "@/lib/types";
import { BarChart, LineChart, ProgressRing } from "./AdminCharts";

type Series = { unit: "day" | "week"; points: Array<{ start: string; label: string; orders: number; total: number; paid: number }> };
type Recent = {
  id: string;
  number: number;
  business_name: string;
  client_name: string;
  payment_mode: PaymentMode | null;
  logistics_mode: LogisticsMode | null;
  status: OrderStatus;
  paid: boolean;
  total: number;
  created_at: string;
};
export type OverviewNumbers = {
  orders: number;
  ordersTotal: number;
  paidOrders: number;
  paidTotal: number;
  commissionGenerated: number;
  commissionPaid: number;
  munActive: number;
  munWithProviders: number;
};

const n = (v: unknown) => Number(v ?? 0);
const PAGE = 8;
const LOGI_SHORT: Record<LogisticsMode, string> = { sem_logistica: "Cliente leva", prestador: "Prestador busca", entregador: "Entregador" };
const compactBRL = (v: number) =>
  v >= 1000 ? `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : `R$ ${Math.round(v).toLocaleString("pt-BR")}`;

function Kpi({ icon, label, value, note }: { icon: ReactNode; label: string; value: string; note?: string }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-grafite/5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-grafite-500">{label}</p>
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-agua-50 text-petroleo" aria-hidden>
          {icon}
        </span>
      </div>
      <p className="mt-2 text-2xl font-bold tracking-tight text-petroleo">{value}</p>
      {note && <p className="mt-0.5 text-[11px] text-grafite-500">{note}</p>}
    </div>
  );
}

/** Topo do painel do admin: indicadores, roscas, gráficos do período e os pedidos mais recentes. */
export function AdminOverview({ from, to, nums }: { from: string; to: string; nums: OverviewNumbers }) {
  const [series, setSeries] = useState<Series | null>(null);
  const [recent, setRecent] = useState<Recent[] | null>(null);
  const [page, setPage] = useState(0);

  useEffect(() => {
    let alive = true;
    setPage(0);
    void Promise.all([
      supabase.rpc("admin_timeseries", { p_from: from, p_to: to }),
      supabase.rpc("admin_recent_orders", { p_from: from, p_to: to }),
    ]).then(([s, r]) => {
      if (!alive) return;
      setSeries((s.data as Series) ?? { unit: "day", points: [] });
      setRecent((r.data as Recent[]) ?? []);
    });
    return () => {
      alive = false;
    };
  }, [from, to]);

  const per = series?.unit === "week" ? "por semana" : "por dia";
  const ordersPts = useMemo(() => (series?.points ?? []).map((p) => ({ label: p.label, value: n(p.orders) })), [series]);
  const totalPts = useMemo(() => (series?.points ?? []).map((p) => ({ label: p.label, value: n(p.total) })), [series]);
  const pages = Math.max(1, Math.ceil((recent?.length ?? 0) / PAGE));
  const rows = (recent ?? []).slice(page * PAGE, page * PAGE + PAGE);
  const avg = nums.orders > 0 ? nums.ordersTotal / nums.orders : 0;

  return (
    <div className="space-y-5" data-testid="admin-overview">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={<ShoppingBag className="h-4 w-4" />} label="Pedidos no período" value={String(nums.orders)} note={`Ticket médio ${formatBRL(avg)}`} />
        <Kpi icon={<CircleDollarSign className="h-4 w-4" />} label="Valor dos pedidos" value={formatBRL(nums.ordersTotal)} note="Direto + pelo app" />
        <Kpi icon={<Wallet className="h-4 w-4" />} label="Pagamentos confirmados" value={formatBRL(nums.paidTotal)} note={`${nums.paidOrders} pedido(s) pagos`} />
        <Kpi icon={<BadgePercent className="h-4 w-4" />} label="Comissões geradas" value={formatBRL(nums.commissionGenerated)} note={`${formatBRL(nums.commissionPaid)} já pagas`} />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <ProgressRing testId="ring-paid" value={nums.paidOrders} total={nums.orders} label="Pedidos pagos" detail={`${nums.paidOrders} de ${nums.orders} pedidos do período`} />
        <ProgressRing
          testId="ring-commission"
          value={nums.commissionPaid}
          total={nums.commissionGenerated}
          label="Comissões recebidas"
          detail={`${formatBRL(nums.commissionPaid)} de ${formatBRL(nums.commissionGenerated)}`}
        />
        <ProgressRing
          testId="ring-coverage"
          value={nums.munWithProviders}
          total={nums.munActive}
          label="Municípios ativos com prestador"
          detail={`${nums.munWithProviders} de ${nums.munActive} municípios com operação ativa`}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-petroleo">Pedidos {per}</h3>
          <p className="mb-3 text-xs text-grafite-500">Pedidos do Limpa Aqui, sem os cancelados</p>
          {series ? <BarChart points={ordersPts} format={(v) => String(Math.round(v))} unitLabel="pedido(s)" testId="chart-orders" /> : <div className="h-[200px]" />}
        </Card>
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-petroleo">Valor dos pedidos {per}</h3>
          <p className="mb-3 text-xs text-grafite-500">Soma dos pedidos (sem a taxa de entrega)</p>
          {series ? <LineChart points={totalPts} format={(v) => formatBRL(v)} axisFormat={compactBRL} unitLabel="" testId="chart-total" /> : <div className="h-[200px]" />}
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-5">
          <div>
            <h3 className="text-sm font-semibold text-petroleo">Pedidos recentes</h3>
            <p className="text-xs text-grafite-500">Pedidos do Limpa Aqui no período (até 200), com a taxa de entrega</p>
          </div>
          <span className="text-xs text-grafite-500">{recent?.length ?? 0} pedido(s)</span>
        </div>
        {recent && recent.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-grafite-500">Nenhum pedido no período.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm" data-testid="recent-orders">
              <thead>
                <tr className="border-y border-grafite/10 bg-nevoa/60 text-left text-xs text-grafite-500">
                  <th className="px-5 py-2 font-medium">Pedido</th>
                  <th className="px-2 py-2 font-medium">Prestador</th>
                  <th className="px-2 py-2 font-medium">Cliente</th>
                  <th className="px-2 py-2 font-medium">Pagamento</th>
                  <th className="px-2 py-2 font-medium">Logística</th>
                  <th className="px-2 py-2 font-medium">Situação</th>
                  <th className="px-5 py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id} className="border-b border-grafite/5 last:border-0">
                    <td className="whitespace-nowrap px-5 py-2.5">
                      <p className="font-semibold text-grafite">#{o.number}</p>
                      <p className="text-[11px] text-grafite-500">{formatDateTime(o.created_at)}</p>
                    </td>
                    <td className="max-w-[160px] truncate px-2 py-2.5 text-grafite">{o.business_name}</td>
                    <td className="max-w-[140px] truncate px-2 py-2.5 text-grafite-500">{o.client_name}</td>
                    <td className="whitespace-nowrap px-2 py-2.5">
                      <span className="text-grafite">{o.payment_mode === "app" ? "Pelo app" : "Direto"}</span>
                      <span className={cn("ml-1.5 text-[11px] font-semibold", o.paid ? "text-emerald-700" : "text-amber-700")}>{o.paid ? "· pago" : "· não pago"}</span>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2.5 text-grafite-500">{o.logistics_mode ? LOGI_SHORT[o.logistics_mode] : "—"}</td>
                    <td className="px-2 py-2.5">
                      <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", STATUS_STYLE[o.status])}>{STATUS_LABEL[o.status]}</span>
                    </td>
                    <td className="whitespace-nowrap px-5 py-2.5 text-right font-semibold tabular-nums text-grafite">{formatBRL(n(o.total))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-grafite/5 px-5 py-3 text-xs text-grafite-500" data-testid="recent-pager">
            <span>
              Página {page + 1} de {pages}
            </span>
            <div className="flex gap-1">
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-lg ring-1 ring-grafite/10 disabled:opacity-40"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
                aria-label="Página anterior"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-lg ring-1 ring-grafite/10 disabled:opacity-40"
                disabled={page >= pages - 1}
                onClick={() => setPage((p) => p + 1)}
                aria-label="Próxima página"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
