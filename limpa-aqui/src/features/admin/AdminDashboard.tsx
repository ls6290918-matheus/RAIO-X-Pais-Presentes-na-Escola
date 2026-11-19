import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Download } from "lucide-react";
import { Alert, Button, Card, Field, InlineLoader, Input, Select, cn } from "@/components/shared/ui";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { formatBRL, formatDate, formatDateTime, todayISO } from "@/lib/format";

type ModeRow = { mode: "direto" | "app"; orders: number; canceled: number; orders_total: number; paid_orders: number; paid_total: number };
type Dashboard = {
  by_mode: ModeRow[];
  commissions: { generated: number; expected: number; to_collect: number; paid: number; to_collect_all_time: number };
  app_payments?: {
    enabled: boolean;
    received: number;
    gateway_fees: number;
    refunded: number;
    to_refund: number;
    to_refund_amount: number;
    disputed: number;
    payouts_pending: number;
    payouts_blocked: number;
    payouts_paid: number;
  };
  logistics: {
    orders_with_courier: number;
    orders_by_provider: number;
    orders_without: number;
    rides_done: number;
    rides_fees: number;
    courier_earnings: number;
    rides_waiting: number;
    rides_ongoing: number;
    couriers_approved: number;
    couriers_pending: number;
  };
  coverage: { registered: number; active: number; suspended: number; with_providers: number; with_logistics: number; active_without_logistics: number };
  marketplace: {
    clients: number;
    providers: number;
    providers_autonomo: number;
    providers_empresa: number;
    listings: number;
    listings_hired: number;
    proposals: number;
    orders_from_listing: number;
    orders_from_profile: number;
  };
};
type Unconfirmed = { id: string; number: number; business_name: string; total: number; status: string; created_at: string; days: number };
type ByBusiness = { business_id: string; business_name: string; commissions: number; amount: number; oldest: string };
type CourierRow = { user_id: string; full_name: string | null; phone: string | null; rides: number; fees: number; earnings: number; last_ride: string };
type LedgerRow = { id: number; created_at: string; event: string; payment_mode: string | null; amount: number; business_name: string | null; order_number: number | null; details: Record<string, unknown> };

const EVENT_LABEL: Record<string, string> = {
  pedido_marketplace: "Pedido do marketplace",
  pedido_cancelado: "Pedido cancelado",
  pagamento_direto_confirmado: "Pagamento direto confirmado",
  comissao_prevista: "Comissão prevista",
  comissao_a_cobrar: "Comissão a cobrar",
  comissao_paga: "Comissão paga",
  comissao_cancelada: "Comissão cancelada",
  regra_comissao_criada: "Regra de comissão criada",
  regra_comissao_encerrada: "Regra de comissão encerrada",
  corrida_criada: "Corrida criada",
  corrida_concluida: "Corrida concluída",
  tarifa_entrega_alterada: "Tarifa de entrega alterada",
};
const MODE_LABEL: Record<string, string> = { direto: "Direto", app: "App" };
const n = (v: unknown) => Number(v ?? 0);

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function rangeFor(preset: string): [string, string] {
  const today = todayISO();
  if (preset === "mes") return [`${today.slice(0, 8)}01`, today];
  if (preset === "mes_passado") {
    const first = new Date(`${today.slice(0, 8)}01T12:00:00`);
    const lastPrev = new Date(first);
    lastPrev.setDate(0);
    const firstPrev = new Date(lastPrev.getFullYear(), lastPrev.getMonth(), 1, 12);
    return [firstPrev.toISOString().slice(0, 10), lastPrev.toISOString().slice(0, 10)];
  }
  if (preset === "7") return [addDays(today, -6), today];
  return [addDays(today, -29), today];
}

/** Exporta linhas para CSV (separador ";" e BOM, para abrir certo no Excel em português). */
function downloadCsv(name: string, header: string[], rows: Array<Array<string | number | null>>) {
  const esc = (v: string | number | null) => {
    const s = v == null ? "" : typeof v === "number" ? String(v).replace(".", ",") : v;
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = "﻿" + [header, ...rows].map((r) => r.map(esc).join(";")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function Tile({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
  return (
    <div className="rounded-xl bg-nevoa/70 p-4">
      <p className="text-xs text-grafite-500">{label}</p>
      <p className="mt-1 text-xl font-semibold tracking-tight text-petroleo">{value}</p>
      {note && <p className="mt-0.5 text-[11px] text-grafite-500">{note}</p>}
    </div>
  );
}

function Section({ title, description, action, children }: { title: string; description?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-petroleo">{title}</h3>
          {description && <p className="text-xs text-grafite-500">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

/** Administração → Painel: indicadores do PRD por período, conciliação, repasses e livro-razão. */
export function AdminDashboard() {
  const [preset, setPreset] = useState("30");
  const [[from, to], setRange] = useState<[string, string]>(rangeFor("30"));
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [recon, setRecon] = useState<{ unconfirmed_direct: Unconfirmed[]; commissions_by_business: ByBusiness[] } | null>(null);
  const [couriers, setCouriers] = useState<CourierRow[]>([]);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [event, setEvent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);

  const load = useCallback(async () => {
    // mudanças rápidas de período: só a consulta mais recente vale
    const id = ++reqId.current;
    setError(null);
    const [d, r, c, l] = await Promise.all([
      supabase.rpc("admin_dashboard", { p_from: from, p_to: to }),
      supabase.rpc("admin_reconciliation"),
      supabase.rpc("admin_courier_report", { p_from: from, p_to: to }),
      supabase.rpc("admin_ledger", { p_from: from, p_to: to, p_event: event || null }),
    ]);
    if (id !== reqId.current) return;
    const err = d.error ?? r.error ?? c.error ?? l.error;
    if (err) setError(friendlyError(err));
    setDash((d.data as Dashboard) ?? null);
    setRecon((r.data as typeof recon) ?? { unconfirmed_direct: [], commissions_by_business: [] });
    setCouriers((c.data as CourierRow[]) ?? []);
    setLedger((l.data as LedgerRow[]) ?? []);
  }, [from, to, event]);

  useEffect(() => {
    void load();
  }, [load]);

  const modes = useMemo(() => {
    const get = (m: "direto" | "app") => dash?.by_mode.find((x) => x.mode === m);
    return { direto: get("direto"), app: get("app") };
  }, [dash]);

  if (!dash || !recon)
    return error ? <Alert>{error}</Alert> : <InlineLoader />;

  const rows: Array<[string, (m?: ModeRow) => string]> = [
    ["Pedidos (sem cancelados)", (m) => String(n(m?.orders))],
    ["Valor dos pedidos", (m) => formatBRL(n(m?.orders_total))],
    ["Pagamentos confirmados", (m) => String(n(m?.paid_orders))],
    ["Valor recebido", (m) => formatBRL(n(m?.paid_total))],
    ["Cancelados", (m) => String(n(m?.canceled))],
  ];

  return (
    <div className="space-y-5" data-testid="admin-dashboard">
      {/* Filtro de período (uma linha, acima de tudo) */}
      <Card className="flex flex-wrap items-end gap-3 p-4">
        <div className="w-full sm:w-52">
          <Field label="Período" htmlFor="dash-preset">
            <Select
              id="dash-preset"
              value={preset}
              onChange={(e) => {
                setPreset(e.target.value);
                if (e.target.value !== "custom") setRange(rangeFor(e.target.value));
              }}
            >
              <option value="7">Últimos 7 dias</option>
              <option value="30">Últimos 30 dias</option>
              <option value="mes">Este mês</option>
              <option value="mes_passado">Mês passado</option>
              <option value="custom">Personalizado</option>
            </Select>
          </Field>
        </div>
        {preset === "custom" && (
          <>
            <Field label="De" htmlFor="dash-from">
              <Input id="dash-from" type="date" value={from} max={to} onChange={(e) => e.target.value && setRange([e.target.value, to])} />
            </Field>
            <Field label="Até" htmlFor="dash-to">
              <Input id="dash-to" type="date" value={to} min={from} onChange={(e) => e.target.value && setRange([from, e.target.value])} />
            </Field>
          </>
        )}
        <p className="pb-2 text-xs text-grafite-500">
          {formatDate(`${from}T12:00:00`)} a {formatDate(`${to}T12:00:00`)}
        </p>
      </Card>
      {error && <Alert>{error}</Alert>}

      {/* Pedidos e dinheiro por modalidade */}
      <Section
        title="Pedidos e dinheiro por modalidade"
        description="Pedidos feitos pelo Limpa Aqui no período. O pagamento direto é declarado pelo prestador e nunca é somado ao que passa pelo app."
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="by-mode">
            <thead>
              <tr className="border-b border-grafite/10 text-left text-xs text-grafite-500">
                <th className="py-2 font-medium">Indicador</th>
                <th className="py-2 pl-2 text-right font-medium">Direto<span className="hidden sm:inline"> ao prestador</span> (declarado)</th>
                <th className="py-2 pl-2 text-right font-medium">Pelo app</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, fn]) => (
                <tr key={label} className="border-b border-grafite/5 last:border-0">
                  <td className="py-2 text-grafite">{label}</td>
                  <td className="whitespace-nowrap py-2 pl-2 text-right font-semibold tabular-nums text-grafite">{fn(modes.direto)}</td>
                  <td className="whitespace-nowrap py-2 pl-2 text-right tabular-nums text-grafite-500">{fn(modes.app)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-grafite-500">Pagamento pelo app chega na Etapa 5b: até lá a coluna fica zerada.</p>
      </Section>

      {dash.app_payments && (
        <Section
          title="Dinheiro que passa pela plataforma (pagamento pelo app)"
          description={dash.app_payments.enabled ? "Recebido via Pix no período; repasses e devoluções, agora." : "Pagamento pelo app desligado. Ligue em Pagamentos pelo app."}
        >
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5" data-testid="app-money">
            <Tile label="Recebido" value={formatBRL(n(dash.app_payments.received))} />
            <Tile label="Taxas do gateway" value={formatBRL(n(dash.app_payments.gateway_fees))} />
            <Tile label="Estornado" value={formatBRL(n(dash.app_payments.refunded))} />
            <Tile label="Repasses a pagar" value={formatBRL(n(dash.app_payments.payouts_pending))} note={n(dash.app_payments.payouts_blocked) > 0 ? `${formatBRL(n(dash.app_payments.payouts_blocked))} suspensos` : undefined} />
            <Tile
              label="A devolver"
              value={formatBRL(n(dash.app_payments.to_refund_amount))}
              note={`${n(dash.app_payments.to_refund)} cobrança(s)${n(dash.app_payments.disputed) ? ` · ${n(dash.app_payments.disputed)} em contestação` : ""}`}
            />
          </div>
        </Section>
      )}

      <Section title="Comissões" description="Pedidos do período, pela regra vigente na data de cada pedido.">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Tile label="Geradas (sem canceladas)" value={formatBRL(n(dash.commissions.generated))} />
          <Tile label="Previstas" value={formatBRL(n(dash.commissions.expected))} note="pedido ainda sem pagamento" />
          <Tile label="A cobrar" value={formatBRL(n(dash.commissions.to_collect))} />
          <Tile label="Pagas" value={formatBRL(n(dash.commissions.paid))} />
          <Tile label="A cobrar (todo o período)" value={formatBRL(n(dash.commissions.to_collect_all_time))} note="valor pendente hoje" />
        </div>
      </Section>

      <Section title="Logística" description="Corridas concluídas no período; fila e entregadores, agora.">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile label="Pedidos com entregador" value={n(dash.logistics.orders_with_courier)} note={`${n(dash.logistics.orders_by_provider)} prestador busca · ${n(dash.logistics.orders_without)} sem logística`} />
          <Tile label="Corridas concluídas" value={n(dash.logistics.rides_done)} note={`${formatBRL(n(dash.logistics.rides_fees))} em corridas`} />
          <Tile label="Esperando entregador" value={n(dash.logistics.rides_waiting)} note={`${n(dash.logistics.rides_ongoing)} em andamento`} />
          <Tile label="Entregadores aprovados" value={n(dash.logistics.couriers_approved)} note={`${n(dash.logistics.couriers_pending)} aguardando aprovação`} />
        </div>
      </Section>

      <Section title="Cobertura no estado do RJ">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          <Tile label="Municípios cadastrados" value={n(dash.coverage.registered)} />
          <Tile label="Com operação ativa" value={n(dash.coverage.active)} />
          <Tile label="Com prestadores na busca" value={n(dash.coverage.with_providers)} />
          <Tile label="Com entregadores (logística)" value={n(dash.coverage.with_logistics)} />
          <Tile label="Ativos sem logística" value={n(dash.coverage.active_without_logistics)} />
          <Tile label="Suspensos" value={n(dash.coverage.suspended)} />
        </div>
      </Section>

      <Section title="Marketplace">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Tile label="Clientes (contratar)" value={n(dash.marketplace.clients)} note="total hoje" />
          <Tile label="Prestadores na busca" value={n(dash.marketplace.providers)} note={`${n(dash.marketplace.providers_autonomo)} autônomos · ${n(dash.marketplace.providers_empresa)} empresas`} />
          <Tile label="Anúncios no período" value={n(dash.marketplace.listings)} note={`${n(dash.marketplace.listings_hired)} contratados`} />
          <Tile label="Propostas no período" value={n(dash.marketplace.proposals)} />
          <Tile label="Pedidos por anúncio / perfil" value={`${n(dash.marketplace.orders_from_listing)} / ${n(dash.marketplace.orders_from_profile)}`} />
        </div>
      </Section>

      {/* Conciliação */}
      <Section
        title="Conciliação: pendências"
        description="Pagamento direto de pedido pronto, entregue ou com mais de 7 dias sem confirmação do prestador; comissões a cobrar por prestador."
      >
        {recon.unconfirmed_direct.length === 0 ? (
          <p className="text-sm text-grafite-500">Nenhum pagamento direto pendente de confirmação.</p>
        ) : (
          <ul className="divide-y divide-grafite/5" data-testid="unconfirmed-list">
            {recon.unconfirmed_direct.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" aria-hidden />
                <span className="sr-only">Pendente:</span>
                <span className="min-w-0 flex-1 text-grafite">
                  {u.business_name} · pedido #{u.number} · {u.status === "entregue" ? "entregue" : u.status === "pronto" ? "pronto" : "em andamento"} há {u.days} dia(s)
                </span>
                <span className="font-semibold tabular-nums text-grafite">{formatBRL(n(u.total))}</span>
              </li>
            ))}
          </ul>
        )}
        <h4 className="mt-5 text-sm font-semibold text-grafite">Comissões a cobrar por prestador</h4>
        {recon.commissions_by_business.length === 0 ? (
          <p className="mt-1 text-sm text-grafite-500">Nada a cobrar.</p>
        ) : (
          <ul className="mt-2 divide-y divide-grafite/5" data-testid="collect-list">
            {recon.commissions_by_business.map((c) => (
              <li key={c.business_id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className="min-w-0 flex-1 text-grafite">
                  {c.business_name} · {c.commissions} pedido(s) · desde {formatDate(c.oldest)}
                </span>
                <span className="font-semibold tabular-nums text-grafite">{formatBRL(n(c.amount))}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Entregadores */}
      <Section
        title="Repasses a entregadores"
        description="Corridas concluídas no período. No pagamento direto o cliente paga o entregador em cada corrida; esta lista é a conferência."
        action={
          couriers.length > 0 && (
            <Button
              variant="outline"
              className="h-9"
              onClick={() =>
                downloadCsv(
                  `entregadores_${from}_${to}.csv`,
                  ["Entregador", "WhatsApp", "Corridas", "Valor das corridas", "Ganho do entregador", "Última corrida"],
                  couriers.map((c) => [c.full_name, c.phone, n(c.rides), n(c.fees), n(c.earnings), formatDateTime(c.last_ride)]),
                )
              }
            >
              <Download className="h-4 w-4" aria-hidden /> CSV
            </Button>
          )
        }
      >
        {couriers.length === 0 ? (
          <p className="text-sm text-grafite-500">Nenhuma corrida concluída no período.</p>
        ) : (
          <ul className="divide-y divide-grafite/5" data-testid="courier-report">
            {couriers.map((c) => (
              <li key={c.user_id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className="min-w-0 flex-1 text-grafite">
                  {c.full_name ?? "Entregador"} · {n(c.rides)} corrida(s)
                </span>
                <span className="font-semibold tabular-nums text-grafite">{formatBRL(n(c.earnings))}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Livro-razão */}
      <Section
        title="Livro-razão"
        description="Todos os eventos financeiros do período (até 2.000). Os lançamentos não podem ser alterados nem apagados."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-56">
              <Select value={event} onChange={(e) => setEvent(e.target.value)} aria-label="Filtrar evento do livro-razão">
                <option value="">Todos os eventos</option>
                {Object.entries(EVENT_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </div>
            {ledger.length > 0 && (
              <Button
                variant="outline"
                className="h-9"
                onClick={() =>
                  downloadCsv(
                    `livro-razao_${from}_${to}.csv`,
                    ["Nº", "Data", "Evento", "Modalidade", "Valor", "Prestador", "Pedido", "Detalhes"],
                    ledger.map((l) => [
                      l.id,
                      formatDateTime(l.created_at),
                      EVENT_LABEL[l.event] ?? l.event,
                      l.payment_mode ? MODE_LABEL[l.payment_mode] : "",
                      n(l.amount),
                      l.business_name,
                      l.order_number,
                      JSON.stringify(l.details),
                    ]),
                  )
                }
              >
                <Download className="h-4 w-4" aria-hidden /> CSV
              </Button>
            )}
          </div>
        }
      >
        {ledger.length === 0 ? (
          <p className="text-sm text-grafite-500">Nenhum lançamento no período.</p>
        ) : (
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full min-w-[560px] text-sm" data-testid="ledger-table">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-grafite/10 text-left text-xs text-grafite-500">
                  <th className="py-2 font-medium">Data</th>
                  <th className="py-2 font-medium">Evento</th>
                  <th className="py-2 font-medium">Prestador · pedido</th>
                  <th className="py-2 text-right font-medium">Valor</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((l) => (
                  <tr key={l.id} className="border-b border-grafite/5 last:border-0">
                    <td className="whitespace-nowrap py-2 pr-3 text-xs text-grafite-500">{formatDateTime(l.created_at)}</td>
                    <td className="py-2 pr-3 text-grafite">
                      {EVENT_LABEL[l.event] ?? l.event}
                      {l.payment_mode && <span className="ml-1 text-xs text-grafite-500">({MODE_LABEL[l.payment_mode]})</span>}
                    </td>
                    <td className="py-2 pr-3 text-grafite-500">
                      {[l.business_name, l.order_number ? `#${l.order_number}` : null].filter(Boolean).join(" · ") || "—"}
                    </td>
                    <td className={cn("py-2 text-right tabular-nums", n(l.amount) ? "font-semibold text-grafite" : "text-grafite-500")}>
                      {formatBRL(n(l.amount))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
