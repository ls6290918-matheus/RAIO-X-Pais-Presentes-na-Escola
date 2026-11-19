import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowDownRight, ArrowUpRight, BadgePercent, CalendarRange, CircleDollarSign, Clock, HandCoins, Receipt, ShoppingBag, TrendingUp } from "lucide-react";
import { cn } from "@/components/shared/ui";
import { supabase } from "@/lib/supabase";
import { formatBRL } from "@/lib/format";
import { STATUS_LABEL } from "@/features/orders/status";
import type { OrderStatus } from "@/lib/types";

type Dash = {
  month: { revenue: number; received: number; to_receive: number; orders: number; avg_ticket: number; marketplace_orders: number };
  prev_month_revenue: number;
  year_revenue: number;
  open_unpaid: number;
  weekly: Array<{ week: string; total: number }>;
  payouts_pending: number;
  payouts_paid_month: number;
  commission_to_pay: number;
  recent: Array<{ id: string; number: number; customer: string; total: number; status: OrderStatus; paid: boolean; origin: string; received_at: string }>;
};

const n = (v: unknown) => Number(v ?? 0);
const MONTH = new Intl.DateTimeFormat("pt-BR", { month: "short", year: "numeric" });

/** Linha do faturamento das últimas semanas (desenhada em SVG, sem biblioteca). */
function Sparkline({ values }: { values: number[] }) {
  const w = 120;
  const h = 44;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => `${(i / Math.max(values.length - 1, 1)) * w},${h - 4 - (v / max) * (h - 8)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-11 w-28" aria-hidden>
      <polyline points={pts} fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Tile({ icon, tone, label, value, note, to }: { icon: ReactNode; tone: string; label: string; value: string; note?: string; to?: string }) {
  const inner = (
    <>
      <span className={cn("flex h-9 w-9 items-center justify-center rounded-full", tone)}>{icon}</span>
      <p className="mt-3 text-xs font-medium text-white/70">{label}</p>
      <p className="mt-0.5 text-lg font-bold text-white">{value}</p>
      {note && <p className="mt-0.5 text-[11px] text-white/50">{note}</p>}
    </>
  );
  const cls = "block rounded-2xl border border-white/5 bg-white/[0.04] p-4";
  return to ? (
    <Link to={to} className={cn(cls, "transition hover:bg-white/[0.07]")}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

/** Painel de ganhos do dono (estilo escuro, como na referência do app do prestador). */
export function EarningsPanel({ businessId }: { businessId: string }) {
  const [d, setD] = useState<Dash | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void supabase.rpc("provider_dashboard", { p_business_id: businessId }).then(({ data, error }) => {
      if (error) setFailed(true);
      else setD(data as Dash);
    });
  }, [businessId]);

  if (failed) return null;

  const revenue = n(d?.month.revenue);
  const prev = n(d?.prev_month_revenue);
  const change = prev > 0 ? Math.round(((revenue - prev) / prev) * 100) : null;
  const paidPct = revenue > 0 ? Math.round((n(d?.month.received) / revenue) * 100) : 0;

  return (
    <section className="rounded-3xl bg-[#0E1A1F] p-4 text-white shadow-lg sm:p-6" aria-label="Seus ganhos" data-testid="earnings-panel">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-base font-semibold">Seus ganhos</p>
          <p className="text-xs text-white/50">Resumo financeiro da lavanderia</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-1.5 text-xs font-medium text-white/80">
          <CalendarRange className="h-3.5 w-3.5" aria-hidden /> {MONTH.format(new Date())}
        </span>
      </div>

      {/* Cartão verde */}
      <div className="mt-4 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-700 p-5" data-testid="earnings-month">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold text-white/90">
              <TrendingUp className="h-4 w-4" aria-hidden /> Faturamento do mês
            </p>
            <p className="mt-2 text-3xl font-bold tracking-tight">{d ? formatBRL(revenue) : "–"}</p>
            <p className="mt-1 flex items-center gap-1 text-xs text-white/85">
              {change === null ? (
                "Pedidos recebidos neste mês"
              ) : (
                <>
                  {change >= 0 ? <ArrowUpRight className="h-3.5 w-3.5" aria-hidden /> : <ArrowDownRight className="h-3.5 w-3.5" aria-hidden />}
                  {change >= 0 ? "+" : ""}
                  {change}% em relação ao mês passado
                </>
              )}
            </p>
          </div>
          {d && <Sparkline values={d.weekly.map((w) => n(w.total))} />}
        </div>
        <div className="mt-4">
          <div className="flex justify-between text-[11px] font-medium text-white/85">
            <span>Já recebido {d ? formatBRL(n(d.month.received)) : ""}</span>
            <span>{paidPct}%</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/25">
            <div className="h-full rounded-full bg-white" style={{ width: `${paidPct}%` }} />
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          icon={<Clock className="h-4 w-4" />}
          tone="bg-amber-400/15 text-amber-300"
          label="A receber"
          value={d ? formatBRL(n(d.open_unpaid)) : "–"}
          note="Pedidos ainda não pagos"
          to="/app/pedidos"
        />
        <Tile icon={<CircleDollarSign className="h-4 w-4" />} tone="bg-emerald-400/15 text-emerald-300" label="Faturamento do ano" value={d ? formatBRL(n(d.year_revenue)) : "–"} />
        <Tile
          icon={<ShoppingBag className="h-4 w-4" />}
          tone="bg-sky-400/15 text-sky-300"
          label="Pedidos no mês"
          value={d ? String(n(d.month.orders)) : "–"}
          note={d && n(d.month.marketplace_orders) > 0 ? `${n(d.month.marketplace_orders)} pelo Limpa Aqui` : undefined}
          to="/app/pedidos"
        />
        <Tile icon={<Receipt className="h-4 w-4" />} tone="bg-violet-400/15 text-violet-300" label="Ticket médio" value={d ? formatBRL(n(d.month.avg_ticket)) : "–"} />
      </div>

      {d && (n(d.payouts_pending) > 0 || n(d.payouts_paid_month) > 0 || n(d.commission_to_pay) > 0) && (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Tile
            icon={<HandCoins className="h-4 w-4" />}
            tone="bg-agua/15 text-agua"
            label="Repasses do app a receber"
            value={formatBRL(n(d.payouts_pending))}
            note={n(d.payouts_paid_month) > 0 ? `${formatBRL(n(d.payouts_paid_month))} já pagos neste mês` : "Pix pelo app, já sem a comissão"}
          />
          <Tile
            icon={<BadgePercent className="h-4 w-4" />}
            tone="bg-red-400/15 text-red-300"
            label="Comissão a pagar"
            value={formatBRL(n(d.commission_to_pay))}
            note="Pedidos com pagamento direto"
          />
        </div>
      )}

      {/* Atividade recente */}
      <div className="mt-3 rounded-2xl border border-white/5 bg-white/[0.04] p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">Atividade recente</p>
          <Link to="/app/pedidos" className="text-xs font-semibold text-agua hover:underline">
            Ver todos
          </Link>
        </div>
        {d && d.recent.length === 0 ? (
          <p className="mt-3 text-sm text-white/50">Nenhum pedido ainda.</p>
        ) : (
          <ul className="mt-2 divide-y divide-white/5" data-testid="recent-activity">
            {(d?.recent ?? []).map((o) => (
              <li key={o.id}>
                <Link to={`/app/pedidos/${o.id}`} className="flex items-center gap-3 py-2.5 hover:opacity-80">
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", o.paid ? "bg-emerald-400" : "bg-amber-400")} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-white">
                      #{o.number} · {o.customer}
                      {o.origin === "marketplace" && <span className="ml-1.5 rounded-full bg-agua/20 px-1.5 py-0.5 text-[10px] font-semibold text-agua">Limpa Aqui</span>}
                    </p>
                    <p className="text-[11px] text-white/50">
                      {STATUS_LABEL[o.status]} · {o.paid ? "pago" : "não pago"}
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-white">{formatBRL(n(o.total))}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
