import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Bike, CalendarDays, ChevronLeft, ChevronRight, Store } from "lucide-react";
import { Alert, Card, EmptyState, PageHeader, buttonClass, cn } from "@/components/shared/ui";
import { Skeleton } from "@/components/shared/steps";
import { useBusiness } from "@/contexts/BusinessContext";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { addDaysISO, formatBRL, todayISO } from "@/lib/format";
import { STATUS_LABEL, STATUS_STYLE } from "@/features/orders/status";
import type { OrderStatus } from "@/lib/types";

type Day = { date: string; count: number; open: number };
type AgendaOrder = {
  id: string;
  number: number;
  due_date: string;
  status: OrderStatus;
  paid: boolean;
  total: number;
  origin: string;
  logistics_mode: "sem_logistica" | "prestador" | "entregador" | null;
  delivery_type: "retirada" | "entrega";
  customer: string;
  items: number;
  pickup_status: string | null;
  return_status: string | null;
  late: boolean;
};
type Agenda = { capacity: number | null; today: string; days: Day[]; orders: AgendaOrder[] };

const WEEKDAY = new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "UTC" });
const LONG = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const SHORT = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", timeZone: "UTC" });
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const DELIVERY_LABEL: Record<string, string> = { disponivel: "procurando entregador", aceita: "entregador a caminho", coletada: "em trânsito", entregue: "concluída", cancelada: "cancelada" };

/** Segunda-feira da semana de uma data (ISO). */
function weekStart(iso: string) {
  const wd = d(iso).getUTCDay(); // 0 = domingo
  return addDaysISO(iso, wd === 0 ? -6 : 1 - wd);
}

function OrderRow({ o }: { o: AgendaOrder }) {
  return (
    <li>
      <Link to={`/app/pedidos/${o.id}`} className="flex items-start gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-grafite/5 transition hover:ring-agua" data-testid="agenda-order">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-petroleo">
              #{o.number} · {o.customer}
            </p>
            {o.origin === "marketplace" && <span className="rounded-full bg-petroleo px-2 py-0.5 text-[10px] font-bold text-agua">Limpa Aqui</span>}
            {o.late && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700">Atrasado</span>}
          </div>
          <p className="mt-0.5 text-xs text-grafite-500">
            {o.items} {o.items === 1 ? "item" : "itens"} · {formatBRL(Number(o.total))} · {o.paid ? "pago" : "não pago"}
            {o.late && ` · prazo era ${SHORT.format(d(o.due_date))}`}
          </p>
          {(o.pickup_status || o.return_status || o.logistics_mode) && (
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-grafite-500">
              {o.logistics_mode === "entregador" ? <Bike className="h-3.5 w-3.5 text-agua-600" aria-hidden /> : <Store className="h-3.5 w-3.5 text-agua-600" aria-hidden />}
              {o.logistics_mode === "entregador"
                ? [o.pickup_status && `Coleta: ${DELIVERY_LABEL[o.pickup_status] ?? o.pickup_status}`, `Devolução: ${o.return_status ? DELIVERY_LABEL[o.return_status] ?? o.return_status : "quando ficar pronto"}`].filter(Boolean).join(" · ")
                : o.logistics_mode === "prestador"
                  ? "Você busca e entrega"
                  : o.delivery_type === "entrega"
                    ? "Entrega no endereço do cliente"
                    : "Cliente retira"}
            </p>
          )}
        </div>
        <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold", STATUS_STYLE[o.status])}>{STATUS_LABEL[o.status]}</span>
      </Link>
    </li>
  );
}

/** /app/agenda — pedidos por dia de entrega prevista, com a capacidade diária e os atrasados. */
export default function AgendaPage() {
  const { business } = useBusiness();
  const [anchor, setAnchor] = useState(() => weekStart(todayISO()));
  const [selected, setSelected] = useState(todayISO());
  const [data, setData] = useState<Agenda | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allLate, setAllLate] = useState(false);

  const load = useCallback(async () => {
    if (!business) return;
    setData(null);
    const { data: a, error: err } = await supabase.rpc("provider_agenda", { p_business_id: business.id, p_from: anchor, p_to: addDaysISO(anchor, 6) });
    if (err) return setError(friendlyError(err));
    setError(null);
    setData(a as Agenda);
  }, [business, anchor]);

  useEffect(() => {
    void load();
  }, [load]);

  const cap = data?.capacity ?? null;
  const late = useMemo(() => (data?.orders ?? []).filter((o) => o.late && o.due_date < anchor), [data, anchor]);
  const dayOrders = useMemo(() => (data?.orders ?? []).filter((o) => o.due_date === selected), [data, selected]);
  const selDay = data?.days.find((x) => x.date === selected);
  const level = (n: number) => (!cap ? "none" : n > cap ? "over" : n >= cap * 0.8 ? "near" : "ok");

  function shift(weeks: number) {
    const next = addDaysISO(anchor, weeks * 7);
    setAnchor(next);
    setSelected(next);
  }

  return (
    <div className="space-y-5" data-testid="agenda-page">
      <PageHeader
        title="Agenda"
        description={cap ? `Sua capacidade: ${cap} pedidos por dia.` : "Pedidos por dia de entrega prevista."}
        action={
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => shift(-1)} className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-petroleo ring-1 ring-grafite/10" aria-label="Semana anterior">
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => {
                setAnchor(weekStart(todayISO()));
                setSelected(todayISO());
              }}
              className="h-10 rounded-xl bg-white px-3 text-sm font-semibold text-petroleo ring-1 ring-grafite/10"
            >
              Hoje
            </button>
            <button type="button" onClick={() => shift(1)} className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-petroleo ring-1 ring-grafite/10" aria-label="Próxima semana">
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        }
      />
      {error && <Alert>{error}</Alert>}

      {/* Faixa da semana */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-7 sm:px-0" role="tablist" aria-label="Dias da semana" data-testid="agenda-week">
        {(data?.days ?? Array.from({ length: 7 }, (_, i) => ({ date: addDaysISO(anchor, i), count: 0, open: 0 }))).map((day) => {
          const lv = level(day.count);
          const isToday = day.date === data?.today;
          const on = day.date === selected;
          return (
            <button
              key={day.date}
              role="tab"
              aria-selected={on}
              onClick={() => setSelected(day.date)}
              className={cn(
                "flex min-w-[68px] flex-col items-center gap-1 rounded-2xl px-2 py-3 text-center ring-1 transition",
                on ? "bg-petroleo text-white ring-petroleo" : "bg-white text-grafite ring-grafite/10 hover:ring-agua",
              )}
            >
              <span className={cn("text-[11px] font-semibold uppercase", on ? "text-white/70" : "text-grafite-500")}>{WEEKDAY.format(d(day.date)).replace(".", "")}</span>
              <span className="text-lg font-bold leading-none">{d(day.date).getUTCDate()}</span>
              <span
                className={cn(
                  "mt-0.5 rounded-full px-2 py-0.5 text-[10px] font-bold",
                  data === null ? "invisible" : "",
                  lv === "over" ? "bg-red-500 text-white" : lv === "near" ? "bg-amber-400 text-petroleo" : on ? "bg-white/15 text-white" : "bg-nevoa text-grafite-500",
                )}
              >
                {day.count}
                {cap ? `/${cap}` : ""}
              </span>
              {isToday && <span className={cn("text-[9px] font-bold uppercase", on ? "text-agua" : "text-agua-600")}>hoje</span>}
            </button>
          );
        })}
      </div>

      {late.length > 0 && (
        <section className="rounded-2xl bg-red-50 p-4" data-testid="agenda-late">
          <p className="flex items-center gap-2 text-sm font-semibold text-red-800">
            <AlertTriangle className="h-4 w-4" aria-hidden /> {late.length} pedido(s) atrasado(s) de semanas anteriores
          </p>
          <ul className="mt-3 space-y-2">
            {(allLate ? late : late.slice(0, 5)).map((o) => (
              <OrderRow key={o.id} o={o} />
            ))}
          </ul>
          {late.length > 5 && (
            <button type="button" onClick={() => setAllLate((v) => !v)} className="mt-3 text-sm font-semibold text-red-800 hover:underline">
              {allLate ? "Mostrar menos" : `Ver todos os ${late.length}`}
            </button>
          )}
        </section>
      )}

      {/* Dia escolhido */}
      <section>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold capitalize text-grafite">{LONG.format(d(selected))}</h2>
          {selDay && (
            <span className="text-xs text-grafite-500">
              {selDay.count} pedido(s) para entregar{selDay.open !== selDay.count ? ` · ${selDay.open} em aberto` : ""}
            </span>
          )}
        </div>
        {cap && selDay && (
          <div className="mb-4" aria-label="Capacidade do dia">
            <div className="h-2 overflow-hidden rounded-full bg-grafite/10">
              <div
                className={cn("h-full rounded-full", level(selDay.count) === "over" ? "bg-red-500" : level(selDay.count) === "near" ? "bg-amber-400" : "bg-agua-600")}
                style={{ width: `${Math.min(100, (selDay.count / cap) * 100)}%` }}
              />
            </div>
            <p className="mt-1 text-[11px] text-grafite-500">
              {selDay.count > cap ? `${selDay.count - cap} acima da sua capacidade de ${cap} por dia` : `${cap - selDay.count} vaga(s) livre(s) de ${cap}`}
            </p>
          </div>
        )}
        {data === null ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
        ) : dayOrders.length === 0 ? (
          <Card>
            <EmptyState icon={<CalendarDays className="h-6 w-6" />} title="Nenhum pedido para este dia" description="Pedidos com entrega prevista neste dia aparecem aqui." />
          </Card>
        ) : (
          <ul className="space-y-2" data-testid="agenda-day">
            {dayOrders.map((o) => (
              <OrderRow key={o.id} o={o} />
            ))}
          </ul>
        )}
      </section>

      {!cap && data && (
        <p className="text-xs text-grafite-500">
          Dica: informe quantos pedidos você atende por dia em{" "}
          <Link to="/app/configuracoes" className={cn(buttonClass("ghost"), "h-auto px-0 py-0 text-xs font-semibold text-agua-600 underline")}>
            Configurações → Perfil de trabalho
          </Link>{" "}
          para ver quando a agenda está cheia.
        </p>
      )}
    </div>
  );
}
