import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Circle,
  Globe,
  PackageCheck,
  PackageOpen,
  PackagePlus,
  Receipt,
  Sparkles,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { Card, StatCard, cn } from "@/components/shared/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useBusiness } from "@/contexts/BusinessContext";
import { supabase } from "@/lib/supabase";
import { PUBLIC_DOMAIN, TIMEZONE, formatBRL, formatDayShort, todayISO } from "@/lib/format";
import type { Order } from "@/lib/types";
import { OPEN_STATUSES } from "@/features/orders/status";
import { StatusBadge } from "@/features/orders/StatusBadge";

type Shortcut = { label: string; icon: LucideIcon; to?: string };

// "Registrar pagamento" chega com o módulo Financeiro.
const SHORTCUTS: Shortcut[] = [
  { label: "Novo pedido", icon: PackagePlus, to: "/app/pedidos/novo" },
  { label: "Novo cliente", icon: UserPlus, to: "/app/clientes?novo=1" },
  { label: "Cadastrar serviço", icon: Sparkles, to: "/app/servicos?novo=1" },
  { label: "Registrar pagamento", icon: Receipt },
];

type Upcoming = Pick<Order, "id" | "number" | "status" | "due_date" | "total"> & { customers: { name: string } | null };

type Stats = {
  open: number;
  ready: number;
  late: number;
  dueToday: number;
  hasServices: boolean;
  hasCustomers: boolean;
  hasOrders: boolean;
  upcoming: Upcoming[];
};

function greeting() {
  const hour = Number(
    new Intl.DateTimeFormat("pt-BR", { hour: "numeric", hour12: false, timeZone: TIMEZONE }).format(new Date()),
  );
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { business, settings } = useBusiness();
  const firstName = String(user?.user_metadata?.full_name ?? "").split(" ")[0];
  const [stats, setStats] = useState<Stats | null>(null);
  const today = todayISO(settings?.timezone);

  useEffect(() => {
    if (!business) return;
    const b = business.id;
    const count = (table: string) => supabase.from(table).select("id", { count: "exact", head: true }).eq("business_id", b);
    const countOrders = () => count("orders");

    void Promise.all([
      countOrders().in("status", OPEN_STATUSES),
      countOrders().eq("status", "pronto"),
      countOrders().in("status", ["recebido", "em_lavagem"]).lt("due_date", today),
      countOrders().in("status", ["recebido", "em_lavagem"]).eq("due_date", today),
      count("services"),
      count("customers"),
      countOrders(),
      supabase
        .from("orders")
        .select("id, number, status, due_date, total, customers!inner(name)")
        .eq("business_id", b)
        .in("status", ["recebido", "em_lavagem"])
        .order("due_date")
        .order("number")
        .limit(5),
    ]).then(([open, ready, late, dueToday, services, customers, orders, upcoming]) =>
      setStats({
        open: open.count ?? 0,
        ready: ready.count ?? 0,
        late: late.count ?? 0,
        dueToday: dueToday.count ?? 0,
        hasServices: (services.count ?? 0) > 0,
        hasCustomers: (customers.count ?? 0) > 0,
        hasOrders: (orders.count ?? 0) > 0,
        upcoming: (upcoming.data as unknown as Upcoming[]) ?? [],
      }),
    );
  }, [business, today]);

  const steps = [
    { label: "Cadastrar sua lavanderia", done: true, to: undefined },
    { label: "Cadastrar seus serviços e preços", done: !!stats?.hasServices, to: "/app/servicos" },
    { label: "Cadastrar seus clientes", done: !!stats?.hasCustomers, to: "/app/clientes" },
    { label: "Criar o primeiro pedido", done: !!stats?.hasOrders, to: "/app/pedidos/novo" },
    { label: "Publicar sua página", done: false, to: undefined },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const value = (n: number | undefined) => (stats ? n : "–");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-petroleo">
          {greeting()}
          {firstName ? `, ${firstName}` : ""}
        </h1>
        <p className="mt-1 text-sm text-grafite-500">Este é o painel da {business?.name}.</p>
      </div>

      <section aria-labelledby="atalhos" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <h2 id="atalhos" className="sr-only">
          Atalhos
        </h2>
        {SHORTCUTS.map(({ label, icon: Icon, to }) => {
          const inner = (
            <>
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-agua-50 text-petroleo">
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <span className="text-sm font-semibold text-petroleo">{label}</span>
              {!to && <span className="text-[11px] font-medium text-grafite-500">Em breve</span>}
            </>
          );
          const base = "flex flex-col items-start gap-2.5 rounded-2xl border border-grafite/5 bg-white p-4 shadow-card";
          return to ? (
            <Link key={label} to={to} className={cn(base, "transition hover:-translate-y-0.5")}>
              {inner}
            </Link>
          ) : (
            <div key={label} className={cn(base, "cursor-not-allowed opacity-60")} aria-disabled="true">
              {inner}
            </div>
          );
        })}
      </section>

      <section aria-label="Indicadores" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Link to="/app/pedidos">
          <StatCard label="Em aberto" value={value(stats?.open)} icon={<PackageOpen className="h-5 w-5" />} note="Recebidos, em lavagem e prontos" />
        </Link>
        <Link to="/app/pedidos?filtro=prontos">
          <StatCard label="Prontos" value={value(stats?.ready)} icon={<PackageCheck className="h-5 w-5" />} note="Aguardando retirada" />
        </Link>
        <StatCard label="Entregar hoje" value={value(stats?.dueToday)} icon={<CalendarClock className="h-5 w-5" />} note="Ainda não ficaram prontos" />
        <StatCard
          label="Atrasados"
          value={<span className={cn(stats && stats.late > 0 && "text-red-600")}>{value(stats?.late)}</span>}
          icon={<AlertTriangle className="h-5 w-5" />}
          note="Passaram da data de entrega"
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-petroleo">Próximas entregas</h2>
            <Link to="/app/pedidos" className="text-sm font-medium text-petroleo hover:underline">
              Ver todos
            </Link>
          </div>
          {stats && stats.upcoming.length === 0 ? (
            <p className="mt-4 text-sm text-grafite-500">Nenhum pedido aguardando lavagem. Tudo em dia!</p>
          ) : (
            <ul className="mt-3 divide-y divide-grafite/5">
              {stats?.upcoming.map((o) => (
                <li key={o.id}>
                  <Link to={`/app/pedidos/${o.id}`} className="flex items-center gap-3 py-3 hover:opacity-80">
                    <span className="w-12 text-sm font-semibold text-petroleo">#{o.number}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-grafite">{o.customers?.name}</p>
                      <p className={cn("text-xs", o.due_date < today ? "font-semibold text-red-600" : "text-grafite-500")}>
                        {formatDayShort(o.due_date)} · {formatBRL(o.total)}
                      </p>
                    </div>
                    <StatusBadge status={o.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-petroleo">Primeiros passos</h2>
            <span className="text-sm text-grafite-500">
              {doneCount} de {steps.length}
            </span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-nevoa">
            <div className="h-full rounded-full bg-agua transition-all" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
          </div>
          <ul className="mt-5 space-y-3">
            {steps.map((s) => {
              const content = (
                <>
                  {s.done ? (
                    <CheckCircle2 className="h-5 w-5 text-agua-600" aria-hidden />
                  ) : (
                    <Circle className="h-5 w-5 text-grafite-300" aria-hidden />
                  )}
                  <span className={s.done ? "text-grafite-500 line-through" : "text-grafite"}>{s.label}</span>
                </>
              );
              return (
                <li key={s.label}>
                  {s.to && !s.done ? (
                    <Link to={s.to} className="flex items-center gap-3 text-sm hover:text-petroleo hover:underline">
                      {content}
                    </Link>
                  ) : (
                    <div className="flex items-center gap-3 text-sm">{content}</div>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="mt-6 flex items-center gap-3 rounded-xl bg-nevoa p-3">
            <Globe className="h-5 w-5 shrink-0 text-petroleo" aria-hidden />
            <p className="min-w-0 text-xs text-grafite-500">
              Sua página pública <span className="font-medium text-grafite">{PUBLIC_DOMAIN}/{business?.slug}</span> chega
              numa próxima etapa.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
