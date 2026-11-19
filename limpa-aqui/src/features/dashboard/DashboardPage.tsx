import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Circle,
  Clock,
  PackageCheck,
  PackageOpen,
  PackagePlus,
  Receipt,
  Route,
  Sparkles,
  UserPlus,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import { Alert, Card, StatCard, buttonClass, cn } from "@/components/shared/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useBusiness, type FeatureState } from "@/contexts/BusinessContext";
import { supabase } from "@/lib/supabase";
import { TIMEZONE, formatBRL, formatDayShort, todayISO } from "@/lib/format";
import { featureIcon, MENU_FEATURES } from "@/lib/featureMeta";
import type { Order } from "@/lib/types";
import { OPEN_STATUSES } from "@/features/orders/status";
import { StatusBadge } from "@/features/orders/StatusBadge";
import { SEGMENT_LABEL } from "@/features/onboarding/catalog";
import { EarningsPanel } from "./EarningsPanel";

type Upcoming = Pick<Order, "id" | "number" | "status" | "due_date" | "total"> & { customers: { name: string } | null };
type Stats = { open: number; ready: number; late: number; dueToday: number; upcoming: Upcoming[] };
type ChecklistItem = { code: string; label: string; done: boolean; href: string | null; available: boolean; sort: number };

function greeting() {
  const hour = Number(new Intl.DateTimeFormat("pt-BR", { hour: "numeric", hour12: false, timeZone: TIMEZONE }).format(new Date()));
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

/* ------------------------------------------------------------ blocos */

function Checklist({ items }: { items: ChecklistItem[] }) {
  const counted = items.filter((i) => i.available);
  const done = counted.filter((i) => i.done).length;
  return (
    <Card className="p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-petroleo">Primeiros passos</h2>
        <span className="text-sm text-grafite-500">
          {done} de {counted.length}
        </span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-nevoa">
        <div className="h-full rounded-full bg-agua transition-all" style={{ width: `${counted.length ? (done / counted.length) * 100 : 0}%` }} />
      </div>
      <ul className="mt-5 space-y-1">
        {items.map((i) => {
          const content = (
            <>
              {i.done ? (
                <CheckCircle2 className="h-5 w-5 shrink-0 text-agua-600" aria-hidden />
              ) : (
                <Circle className={cn("h-5 w-5 shrink-0", i.available ? "text-grafite-300" : "text-grafite/15")} aria-hidden />
              )}
              <span className={cn("flex-1", i.done ? "text-grafite-500 line-through" : i.available ? "text-grafite" : "text-grafite-300")}>
                {i.label}
              </span>
              {!i.available && <span className="rounded-full bg-nevoa px-2 py-0.5 text-[11px] font-semibold text-grafite-500">Em breve</span>}
              {i.available && !i.done && i.href && <ArrowRight className="h-4 w-4 text-grafite-300" aria-hidden />}
            </>
          );
          return (
            <li key={i.code}>
              {i.available && !i.done && i.href ? (
                <Link to={i.href} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-nevoa">
                  {content}
                </Link>
              ) : (
                <div className="-mx-2 flex items-center gap-3 px-2 py-2 text-sm" aria-disabled={!i.available || undefined}>
                  {content}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-grafite-500">Cada passo é marcado sozinho quando você conclui a tarefa no sistema.</p>
    </Card>
  );
}

function Modules({ title, list }: { title: string; list: FeatureState[] }) {
  if (!list.length) return null;
  return (
    <section aria-labelledby="modulos">
      <h2 id="modulos" className="mb-3 text-base font-semibold text-petroleo">
        {title}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((f) => {
          const Icon = featureIcon(f.code);
          const ready = f.status === "disponivel" && f.route;
          const inner = (
            <>
              <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", ready ? "bg-agua-50 text-petroleo" : "bg-nevoa text-grafite-500")}>
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm font-semibold text-petroleo">
                  {f.name}
                  {!ready && <span className="rounded-full bg-nevoa px-2 py-0.5 text-[11px] font-semibold text-grafite-500">Em breve</span>}
                </span>
                {f.description && <span className="mt-0.5 block text-xs text-grafite-500">{f.description}</span>}
              </span>
            </>
          );
          const cls = "flex items-start gap-3 rounded-2xl border border-grafite/5 bg-white p-4 shadow-card";
          return ready ? (
            <Link key={f.code} to={f.route!} className={cn(cls, "transition hover:-translate-y-0.5")}>
              {inner}
            </Link>
          ) : (
            <div key={f.code} className={cn(cls, "opacity-75")} aria-disabled="true">
              {inner}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ página */

export default function DashboardPage() {
  const { user } = useAuth();
  const { business, settings, role, features, segmentModules, configured, hasFeature } = useBusiness();
  const location = useLocation();
  const justOnboarded = Boolean((location.state as { onboarded?: boolean } | null)?.onboarded);
  const justJoined = Boolean((location.state as { joined?: boolean } | null)?.joined);
  const firstName = String(user?.user_metadata?.full_name ?? "").split(" ")[0];
  const today = todayISO(settings?.timezone);
  const segment = business?.segment ?? null;

  const [needsSetup, setNeedsSetup] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);

  // Convite para lavanderias que ainda não passaram pelo assistente
  useEffect(() => {
    if (!business || role !== "owner") return;
    void supabase
      .from("onboarding_profiles")
      .select("user_id")
      .eq("business_id", business.id)
      .not("completed_at", "is", null)
      .limit(1)
      .then(({ data, error }) => setNeedsSetup(!error && (data ?? []).length === 0));
  }, [business, role]);

  // Checklist calculado no banco a partir dos dados reais
  useEffect(() => {
    if (!business) return;
    void supabase.rpc("get_setup_checklist", { p_business_id: business.id }).then(({ data }) => setChecklist((data as ChecklistItem[]) ?? []));
  }, [business]);

  const showOrders = hasFeature("pedidos");

  useEffect(() => {
    if (!business || !showOrders) return;
    const b = business.id;
    const countOrders = () => supabase.from("orders").select("id", { count: "exact", head: true }).eq("business_id", b);
    void Promise.all([
      countOrders().in("status", OPEN_STATUSES),
      countOrders().eq("status", "pronto"),
      countOrders().in("status", ["recebido", "em_lavagem"]).lt("due_date", today),
      countOrders().in("status", ["recebido", "em_lavagem"]).eq("due_date", today),
      supabase
        .from("orders")
        .select("id, number, status, due_date, total, customers!inner(name)")
        .eq("business_id", b)
        .in("status", ["recebido", "em_lavagem"])
        .order("due_date")
        .order("number")
        .limit(5),
    ]).then(([open, ready, late, dueToday, upcoming]) =>
      setStats({
        open: open.count ?? 0,
        ready: ready.count ?? 0,
        late: late.count ?? 0,
        dueToday: dueToday.count ?? 0,
        upcoming: (upcoming.data as unknown as Upcoming[]) ?? [],
      }),
    );
  }, [business, today, showOrders]);

  const value = (n: number | undefined) => (stats ? n : "–");
  const checklistPending = checklist.some((i) => i.available && !i.done);

  // Atalhos: só dos recursos ligados
  const shortcuts: Array<{ label: string; icon: LucideIcon; to?: string; feature: string }> = [
    { label: "Novo pedido", icon: PackagePlus, to: "/app/pedidos/novo", feature: "pedidos" },
    { label: "Novo cliente", icon: UserPlus, to: "/app/clientes?novo=1", feature: "clientes" },
    { label: "Cadastrar serviço", icon: Sparkles, to: "/app/servicos?novo=1", feature: "servicos" },
    { label: "Entregas do dia", icon: Route, to: "/app/rotas", feature: "entregas" },
    { label: "Registrar pagamento", icon: Receipt, feature: "financeiro" },
  ];
  const visibleShortcuts = shortcuts.filter((s) => (s.to ? hasFeature(s.feature) : configured ? features.find((f) => f.code === s.feature)?.enabled : true)).slice(0, 4);

  // Módulos: os do segmento primeiro, depois os outros recursos ligados que viram tela
  const enabled = (code: string) => {
    const f = features.find((x) => x.code === code);
    return f && (configured ? f.enabled : f.status === "disponivel");
  };
  const segmentList = segmentModules.map((c) => features.find((f) => f.code === c)).filter((f): f is FeatureState => !!f && !!enabled(f.code) && f.code !== "checklist");
  const others = features.filter((f) => MENU_FEATURES.includes(f.code) && enabled(f.code) && !segmentModules.includes(f.code));
  const extras = features.filter((f) => ["campos_calcado", "catalogo_roupas", "dimensoes_item", "orcamento", "fotos"].includes(f.code) && enabled(f.code));

  /* ---------------------------------------------------------- blocos montados */
  const blockShortcuts = visibleShortcuts.length > 0 && (
    <section aria-labelledby="atalhos" className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <h2 id="atalhos" className="sr-only">
        Atalhos
      </h2>
      {visibleShortcuts.map(({ label, icon: Icon, to }) => {
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
  );

  const blockStats = showOrders && (
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
  );

  const blockUpcoming = showOrders && (
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
  );

  const blockChecklist = checklist.length > 0 && <Checklist items={checklist} />;
  const blockModules = configured && (
    <Modules title={segment === "empresa" ? "Gestão do negócio" : segment === "iniciante" ? "Para começar bem" : "Seu dia a dia"} list={segmentList} />
  );
  const blockOthers = configured && <Modules title="Outros recursos ativos" list={others} />;
  const blockExtras = configured && extras.length > 0 && (
    <Card className="p-5">
      <h2 className="text-sm font-semibold text-petroleo">Recursos dos seus serviços</h2>
      <ul className="mt-3 flex flex-wrap gap-2">
        {extras.map((f) => {
          const Icon = featureIcon(f.code);
          return (
            <li key={f.code} className="inline-flex items-center gap-1.5 rounded-full bg-nevoa px-3 py-1.5 text-xs font-medium text-grafite">
              <Icon className="h-3.5 w-3.5" aria-hidden /> {f.name}
              {f.status === "em_breve" && (
                <span className="inline-flex items-center gap-0.5 text-grafite-500">
                  · <Clock className="h-3 w-3" aria-hidden /> em breve
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );

  // Ordem por segmento (lavanderia não configurada mantém o painel de antes + checklist real)
  let body: ReactNode;
  if (segment === "iniciante") {
    body = (
      <>
        <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          {blockChecklist}
          <div className="space-y-6">{blockShortcuts}</div>
        </div>
        {blockModules}
        {blockStats}
        {blockOthers}
        {blockExtras}
      </>
    );
  } else if (segment === "empresa") {
    body = (
      <>
        {blockStats}
        {blockModules}
        {blockShortcuts}
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          {blockUpcoming}
          {checklistPending ? blockChecklist : blockExtras}
        </div>
        {blockOthers}
        {checklistPending && blockExtras}
      </>
    );
  } else {
    body = (
      <>
        {blockShortcuts}
        {blockStats}
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          {blockUpcoming}
          {blockChecklist}
        </div>
        {blockModules}
        {blockOthers}
        {blockExtras}
      </>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-petroleo">
            {greeting()}
            {firstName ? `, ${firstName}` : ""}
          </h1>
          <p className="mt-1 text-sm text-grafite-500">Este é o painel da {business?.name}.</p>
        </div>
        {segment && (
          <span className="rounded-full bg-agua-50 px-3 py-1 text-xs font-semibold text-petroleo">Painel {SEGMENT_LABEL[segment].title}</span>
        )}
      </div>

      {justOnboarded && <Alert kind="success">Pronto! Seu painel foi configurado de acordo com as suas respostas.</Alert>}
      {justJoined && <Alert kind="success">Bem-vindo(a) à equipe da {business?.name}! Você já pode cuidar dos pedidos e clientes.</Alert>}

      {needsSetup && (
        <Card className="flex flex-col gap-4 bg-petroleo p-5 text-white sm:flex-row sm:items-center">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-agua text-petroleo">
            <Wand2 className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Personalize seu painel</p>
            <p className="text-sm text-white/75">Responda algumas perguntas rápidas e o Limpa Aqui se ajusta aos serviços que você oferece.</p>
          </div>
          <Link to="/personalizar" className={cn(buttonClass(), "shrink-0")}>
            Começar
          </Link>
        </Card>
      )}

      {role === "owner" && business && showOrders && <EarningsPanel businessId={business.id} />}

      {body}
    </div>
  );
}
