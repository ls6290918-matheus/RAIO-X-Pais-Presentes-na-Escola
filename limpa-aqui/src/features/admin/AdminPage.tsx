import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Bike, CheckCircle2, LayoutDashboard, MapPin, Search, Store, Truck, Wallet, QrCode, Gem, type LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { AdminDashboard } from "./AdminDashboard";
import { AdminLogistics } from "./AdminLogistics";
import { AdminPayments } from "./AdminPayments";
import { AdminPlans } from "./AdminPlans";
import { AdminFinance } from "./AdminFinance";
import { Alert, Button, Card, InlineLoader, Input, Logo, Select, StatCard, cn } from "@/components/shared/ui";
import { UserMenu } from "@/components/layout/AppLayout";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import type { RoleStatus } from "@/contexts/RolesContext";

type MunStatus = "cadastrado" | "ativo" | "suspenso";
type Municipality = { id: number; name: string; status: MunStatus; providers: number; companies: number; visible: number };
type Courier = {
  user_id: string;
  full_name: string | null;
  email: string;
  phone: string | null;
  vehicle: "bicicleta" | "moto" | "carro" | null;
  cpf_last4: string | null;
  areas: string[];
  status: RoleStatus;
  created_at: string;
  completed: number;
};

const MUN_LABEL: Record<MunStatus, string> = { cadastrado: "Só cadastro", ativo: "Operação ativa", suspenso: "Suspenso" };
const ROLE_STATUS_LABEL: Record<RoleStatus, string> = { pendente: "Aguardando", ativo: "Aprovado", suspenso: "Suspenso" };
type Tab = "painel" | "municipios" | "entregadores" | "logistica" | "financeiro" | "pagamentos" | "planos";
const NAV: Array<[Tab, string, LucideIcon, string]> = [
  ["painel", "Painel", LayoutDashboard, "Indicadores, gráficos e pedidos do período"],
  ["municipios", "Municípios", MapPin, "Onde o Limpa Aqui opera no estado do RJ"],
  ["entregadores", "Entregadores", Bike, "Aprovação de quem faz coleta e entrega"],
  ["logistica", "Logística", Truck, "Zonas, tarifas e corridas"],
  ["financeiro", "Financeiro", Wallet, "Comissões, cobranças e regras"],
  ["pagamentos", "Pagamentos pelo app", QrCode, "Pix pela SyncPay, repasses e devoluções"],
  ["planos", "Planos", Gem, "Planos e assinaturas dos prestadores"],
];

/** Moldura do /admin: menu lateral petróleo no computador e abas roláveis no celular. */
function AdminShell({ tab, onTab, pending, children }: { tab: Tab; onTab: (t: Tab) => void; pending: number; children: React.ReactNode }) {
  const current = NAV.find((x) => x[0] === tab) ?? NAV[0];
  return (
    <div className="min-h-screen bg-nevoa">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-gradient-to-b from-[#134752] via-petroleo to-[#0C232A] px-4 py-6 text-white lg:flex" data-testid="admin-sidebar">
        <Link to="/conta" className="px-2" aria-label="Início">
          <Logo light />
        </Link>
        <p className="mt-8 px-3 text-[11px] font-semibold uppercase tracking-wider text-white/40">Administração</p>
        <nav className="mt-2 space-y-1" role="tablist" aria-label="Seções da administração">
          {NAV.map(([key, label, Icon]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => onTab(key)}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition",
                tab === key ? "bg-agua text-petroleo shadow-sm" : "text-white/75 hover:bg-white/10 hover:text-white",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              <span className="flex-1">{label}</span>
              {key === "entregadores" && pending > 0 && (
                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", tab === key ? "bg-petroleo text-white" : "bg-amber-400 text-petroleo")}>{pending}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="mt-auto rounded-2xl bg-white/[0.06] p-4">
          <p className="text-xs font-semibold">Operação no RJ</p>
          <p className="mt-1 text-[11px] leading-relaxed text-white/60">Marketplace, pagamentos e logística do Limpa Aqui.</p>
          <Link to="/conta" className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-agua hover:underline">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Minha conta
          </Link>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-grafite/5 bg-white/90 backdrop-blur">
          <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6">
            <Link to="/conta" className="lg:hidden" aria-label="Início">
              <Logo />
            </Link>
            <div className="hidden min-w-0 lg:block">
              <h1 className="truncate text-lg font-semibold text-petroleo">{current[1]}</h1>
              <p className="truncate text-xs text-grafite-500">{current[3]}</p>
            </div>
            <UserMenu />
          </div>
          <nav className="flex gap-2 overflow-x-auto px-4 pb-3 lg:hidden" role="tablist" aria-label="Seções da administração" data-testid="admin-tabs-mobile">
            {NAV.map(([key, label, Icon]) => (
              <button
                key={key}
                role="tab"
                aria-selected={tab === key}
                onClick={() => onTab(key)}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold transition",
                  tab === key ? "bg-petroleo text-white" : "bg-nevoa text-grafite-500",
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
                {key === "entregadores" && pending > 0 && ` (${pending})`}
              </button>
            ))}
          </nav>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
          <div className="mb-5 lg:hidden">
            <h1 className="text-xl font-semibold text-petroleo">{current[1]}</h1>
            <p className="text-xs text-grafite-500">{current[3]}</p>
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** /admin — administração da plataforma: municípios do RJ e aprovação de entregadores. */
export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("painel");
  const [muns, setMuns] = useState<Municipality[] | null>(null);
  const [couriers, setCouriers] = useState<Courier[] | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"todos" | MunStatus | "com_prestadores">("todos");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  const load = useCallback(async () => {
    const [m, c] = await Promise.all([supabase.rpc("admin_municipality_overview"), supabase.rpc("admin_couriers")]);
    if (m.error || c.error) setMsg({ kind: "error", text: friendlyError(m.error ?? c.error) });
    setMuns(((m.data as Municipality[]) ?? []).map((x) => ({ ...x, providers: Number(x.providers), companies: Number(x.companies), visible: Number(x.visible) })));
    setCouriers((c.data as Courier[]) ?? []);
  }, []);

  // recarrega ao trocar de aba (ex.: entregador que acabou de se cadastrar)
  useEffect(() => {
    void load();
  }, [load, tab]);

  const visible = useMemo(() => {
    const k = norm(q.trim());
    return (muns ?? []).filter(
      (m) =>
        (!k || norm(m.name).includes(k)) &&
        (filter === "todos" || (filter === "com_prestadores" ? m.providers + m.companies > 0 : m.status === filter)),
    );
  }, [muns, q, filter]);

  async function setMunStatus(m: Municipality, status: MunStatus) {
    if (status === "suspenso" && !window.confirm(`Suspender ${m.name}? O município deixa de aceitar novas contratações.`)) return;
    setBusy(`m${m.id}`);
    setMsg(null);
    const { error } = await supabase.rpc("admin_set_municipality_status", { p_municipality_id: m.id, p_status: status });
    setBusy(null);
    if (error) return setMsg({ kind: "error", text: friendlyError(error) });
    setMsg({ kind: "success", text: `${m.name}: ${MUN_LABEL[status]}.` });
    await load();
  }

  async function setCourier(c: Courier, status: RoleStatus) {
    if (status === "suspenso" && !window.confirm(`Suspender ${c.full_name ?? c.email}? A pessoa deixa de receber corridas.`)) return;
    setBusy(`c${c.user_id}`);
    setMsg(null);
    const { error } = await supabase.rpc("admin_set_role_status", { p_user_id: c.user_id, p_role: "entregador", p_status: status });
    setBusy(null);
    if (error) return setMsg({ kind: "error", text: friendlyError(error) });
    setMsg({ kind: "success", text: `${c.full_name ?? c.email}: ${ROLE_STATUS_LABEL[status]}.` });
    await load();
  }

  const pending = (couriers ?? []).filter((c) => c.status === "pendente").length;

  if (muns === null || couriers === null)
    return (
      <AdminShell tab={tab} onTab={setTab} pending={0}>
        <InlineLoader />
      </AdminShell>
    );

  return (
    <AdminShell tab={tab} onTab={setTab} pending={pending}>
      <div className="space-y-6">
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

        {(tab === "municipios" || tab === "entregadores") && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Municípios cadastrados" value={String(muns.length)} icon={<MapPin className="h-5 w-5" />} />
          <StatCard label="Com operação ativa" value={String(muns.filter((m) => m.status === "ativo").length)} icon={<CheckCircle2 className="h-5 w-5" />} />
          <StatCard label="Com prestadores" value={String(muns.filter((m) => m.providers + m.companies > 0).length)} icon={<Store className="h-5 w-5" />} />
          <StatCard label="Entregadores aguardando" value={String(pending)} icon={<Bike className="h-5 w-5" />} />
        </div>
        )}

        {tab === "painel" ? (
          <AdminDashboard />
        ) : tab === "logistica" ? (
          <AdminLogistics />
        ) : tab === "financeiro" ? (
          <AdminFinance />
        ) : tab === "pagamentos" ? (
          <AdminPayments />
        ) : tab === "planos" ? (
          <AdminPlans />
        ) : tab === "municipios" ? (
          <Card className="overflow-hidden">
            <div className="flex flex-col gap-3 p-4 sm:flex-row">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-grafite-500" aria-hidden />
                <Input className="pl-9" placeholder="Buscar município" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar município" />
              </div>
              <div className="sm:w-56">
              <Select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Filtrar municípios">
                <option value="todos">Todos</option>
                <option value="ativo">Operação ativa</option>
                <option value="cadastrado">Só cadastro</option>
                <option value="suspenso">Suspensos</option>
                <option value="com_prestadores">Com prestadores</option>
              </Select>
              </div>
            </div>
            <p className="px-4 pb-2 text-xs text-grafite-500">
              "Só cadastro": aceita cadastros, mas não aparece como atendido. "Operação ativa": liberado para contratações quando houver
              prestadores. "Suspenso": não aceita novas contratações.
            </p>
            <ul className="divide-y divide-grafite/5" data-testid="mun-list">
              {visible.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-grafite">{m.name}</p>
                    <p className="text-xs text-grafite-500">
                      {m.providers} autônomo(s) · {m.companies} empresa(s) · {m.visible} na busca
                    </p>
                  </div>
                  <div className="w-full sm:w-48">
                    <Select
                      value={m.status}
                      disabled={busy === `m${m.id}`}
                      onChange={(e) => void setMunStatus(m, e.target.value as MunStatus)}
                      aria-label={`Situação de ${m.name}`}
                    >
                      <option value="cadastrado">{MUN_LABEL.cadastrado}</option>
                      <option value="ativo">{MUN_LABEL.ativo}</option>
                      <option value="suspenso">{MUN_LABEL.suspenso}</option>
                    </Select>
                  </div>
                </li>
              ))}
              {visible.length === 0 && <li className="px-4 py-6 text-center text-sm text-grafite-500">Nenhum município encontrado.</li>}
            </ul>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            {couriers.length === 0 ? (
              <p className="px-6 py-8 text-center text-sm text-grafite-500">Ninguém pediu para ser entregador ainda.</p>
            ) : (
              <ul className="divide-y divide-grafite/5">
                {couriers.map((c) => (
                  <li key={c.user_id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-grafite">{c.full_name ?? c.email}</p>
                      <p className="truncate text-xs text-grafite-500">
                        {c.email} · pediu em {formatDate(c.created_at)}
                      </p>
                      <p className="truncate text-xs text-grafite-500" data-testid="courier-details">
                        {c.vehicle ? `${c.vehicle === "bicicleta" ? "Bicicleta" : c.vehicle === "moto" ? "Moto" : "Carro"} · CPF final ${c.cpf_last4} · ${c.areas.join(", ") || "sem municípios"}` : "Ainda não preencheu veículo e municípios"}
                        {Number(c.completed) > 0 && ` · ${c.completed} corrida(s) feitas`}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-1 text-xs font-semibold",
                        c.status === "ativo" ? "bg-agua-50 text-petroleo" : c.status === "pendente" ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700",
                      )}
                    >
                      {ROLE_STATUS_LABEL[c.status]}
                    </span>
                    {c.status !== "ativo" && (
                      <Button className="h-9" loading={busy === `c${c.user_id}`} onClick={() => void setCourier(c, "ativo")}>
                        {c.status === "pendente" ? "Aprovar" : "Reativar"}
                      </Button>
                    )}
                    {c.status !== "suspenso" && (
                      <Button variant="outline" className="h-9" disabled={busy === `c${c.user_id}`} onClick={() => void setCourier(c, "suspenso")}>
                        Suspender
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p className="border-t border-grafite/5 px-4 py-3 text-xs text-grafite-500">
              Aprove só quem você conferiu (documento e veículo). Entregador aprovado passa a ver as corridas livres dos municípios que escolheu.
            </p>
          </Card>
        )}
      </div>
    </AdminShell>
  );
}
