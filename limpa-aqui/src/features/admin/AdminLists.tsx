import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Megaphone, Package, ScrollText, Search, Users } from "lucide-react";
import { Alert, Button, Card, EmptyState, InlineLoader, Input, Modal, Select, Textarea, cn } from "@/components/shared/ui";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { formatBRL, formatDate, formatDateTime } from "@/lib/format";
import { LOGISTICS_LABEL, PAYMENT_LABEL } from "@/lib/marketplace";
import { STATUS_LABEL, STATUS_STYLE } from "@/features/orders/status";
import { OrderTimeline } from "@/features/orders/OrderTimeline";
import { OrderDeliveriesCard } from "@/features/orders/OrderDeliveriesCard";
import type { LogisticsMode, OrderStatus, PaymentMode } from "@/lib/types";

const PAGE = 25;

/** Busca + paginação comuns às listas do admin. */
function useAdminList<T extends { total_count: number }>(rpc: string, args: Record<string, unknown>) {
  const [rows, setRows] = useState<T[] | null>(null);
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify(args);
  useEffect(() => setPage(0), [key]);
  const load = useCallback(async () => {
    setRows(null);
    const { data, error: err } = await supabase.rpc(rpc, { ...JSON.parse(key), p_limit: PAGE, p_offset: page * PAGE });
    if (err) setError(friendlyError(err));
    setRows((data as T[]) ?? []);
  }, [rpc, key, page]);
  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);
  const total = rows?.[0]?.total_count ?? 0;
  return { rows, page, setPage, total, error, reload: load };
}

function Pager({ page, total, onPage }: { page: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE));
  return (
    <div className="flex items-center justify-between gap-2 px-4 py-3 text-xs text-grafite-500">
      <span>
        {total} resultado(s) · página {page + 1} de {pages}
      </span>
      <div className="flex gap-1">
        <button type="button" disabled={page === 0} onClick={() => onPage(page - 1)} className="rounded-lg p-2 ring-1 ring-grafite/10 disabled:opacity-40" aria-label="Página anterior">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button type="button" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)} className="rounded-lg p-2 ring-1 ring-grafite/10 disabled:opacity-40" aria-label="Próxima página">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function SearchBox({ value, onChange, label, placeholder }: { value: string; onChange: (v: string) => void; label: string; placeholder: string }) {
  return (
    <div className="relative flex-1">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-grafite-500" aria-hidden />
      <Input className="pl-9" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} />
    </div>
  );
}

/* ------------------------------------------------------------------ usuários */

type UserRow = {
  id: string;
  full_name: string | null;
  email: string;
  phone: string | null;
  roles: Array<{ role: string; status: "ativo" | "pendente" | "suspenso" }>;
  businesses: string[];
  orders_as_client: number;
  created_at: string;
  last_sign_in_at: string | null;
  total_count: number;
};
const ROLE_LABEL: Record<string, string> = { anunciante: "Cliente", prestador: "Prestador", entregador: "Entregador", admin: "Admin" };

export function AdminUsers() {
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const { rows, page, setPage, total, error, reload } = useAdminList<UserRow>("admin_users", { p_q: q || null, p_role: role || null });
  const [msg, setMsg] = useState<string | null>(null);

  async function setStatus(u: UserRow, r: string, status: "ativo" | "suspenso") {
    if (status === "suspenso" && !window.confirm(`Suspender o perfil ${ROLE_LABEL[r]} de ${u.full_name ?? u.email}?`)) return;
    const { error: err } = await supabase.rpc("admin_set_role_status", { p_user_id: u.id, p_role: r, p_status: status });
    setMsg(err ? friendlyError(err) : null);
    void reload();
  }

  return (
    <Card className="overflow-hidden" data-testid="admin-users">
      <div className="flex flex-col gap-3 p-4 sm:flex-row">
        <SearchBox value={q} onChange={setQ} label="Buscar usuário" placeholder="Nome, e-mail ou WhatsApp" />
        <div className="sm:w-48">
          <Select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Filtrar por perfil">
            <option value="">Todos os perfis</option>
            {Object.entries(ROLE_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {(error || msg) && <div className="px-4 pb-3"><Alert>{error ?? msg}</Alert></div>}
      {rows === null ? (
        <InlineLoader />
      ) : rows.length === 0 ? (
        <EmptyState icon={<Users className="h-6 w-6" />} title="Ninguém encontrado" description="Tente outro nome, e-mail ou WhatsApp." />
      ) : (
        <ul className="divide-y divide-grafite/5 border-t border-grafite/5">
          {rows.map((u) => (
            <li key={u.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-grafite">{u.full_name || "Sem nome"}</p>
                <p className="truncate text-xs text-grafite-500">
                  {u.email}
                  {u.phone ? ` · ${u.phone}` : ""}
                </p>
                <p className="mt-0.5 text-xs text-grafite-500">
                  Desde {formatDate(u.created_at)}
                  {u.last_sign_in_at ? ` · último acesso ${formatDateTime(u.last_sign_in_at)}` : ""}
                  {u.orders_as_client > 0 ? ` · ${u.orders_as_client} pedido(s) como cliente` : ""}
                  {u.businesses.length > 0 ? ` · ${u.businesses.join(", ")}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {u.roles.map((r) => (
                  <span key={r.role} className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold", r.status === "ativo" ? "bg-agua-50 text-petroleo" : r.status === "pendente" ? "bg-amber-50 text-amber-800" : "bg-red-50 text-red-700")}>
                    {ROLE_LABEL[r.role] ?? r.role}
                    {r.status !== "ativo" && ` · ${r.status}`}
                    {r.role !== "admin" && (
                      <button type="button" onClick={() => void setStatus(u, r.role, r.status === "suspenso" ? "ativo" : "suspenso")} className="ml-1 underline">
                        {r.status === "suspenso" ? "reativar" : "suspender"}
                      </button>
                    )}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Pager page={page} total={total} onPage={setPage} />
    </Card>
  );
}

/* ------------------------------------------------------------------ pedidos */

type OrderRow = {
  id: string;
  number: number;
  business_name: string;
  client_name: string | null;
  status: OrderStatus;
  origin: "balcao" | "marketplace";
  payment_mode: PaymentMode | null;
  logistics_mode: LogisticsMode | null;
  paid: boolean;
  amount: number;
  discount: number;
  dispute_open: boolean;
  client_confirmed_at: string | null;
  created_at: string;
  total_count: number;
};

export function AdminOrders() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [origin, setOrigin] = useState("marketplace");
  const { rows, page, setPage, total, error } = useAdminList<OrderRow>("admin_orders", { p_q: q || null, p_status: status || null, p_origin: origin || null });
  const [open, setOpen] = useState<OrderRow | null>(null);
  return (
    <Card className="overflow-hidden" data-testid="admin-orders">
      <div className="flex flex-col gap-3 p-4 sm:flex-row">
        <SearchBox value={q} onChange={setQ} label="Buscar pedido" placeholder="Número, lavanderia ou cliente" />
        <div className="grid grid-cols-2 gap-3 sm:w-80">
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filtrar por situação">
            <option value="">Todas as situações</option>
            {(Object.keys(STATUS_LABEL) as OrderStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
          <Select value={origin} onChange={(e) => setOrigin(e.target.value)} aria-label="Filtrar por origem">
            <option value="marketplace">Pelo Limpa Aqui</option>
            <option value="balcao">Balcão</option>
            <option value="">Todas</option>
          </Select>
        </div>
      </div>
      {error && <div className="px-4 pb-3"><Alert>{error}</Alert></div>}
      {rows === null ? (
        <InlineLoader />
      ) : rows.length === 0 ? (
        <EmptyState icon={<Package className="h-6 w-6" />} title="Nenhum pedido encontrado" description="Mude a busca ou os filtros." />
      ) : (
        <ul className="divide-y divide-grafite/5 border-t border-grafite/5">
          {rows.map((o) => (
            <li key={o.id}>
              <button type="button" onClick={() => setOpen(o)} className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-nevoa/60">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-grafite">
                    Pedido nº {o.number} · {o.business_name}
                  </p>
                  <p className="text-xs text-grafite-500">
                    {o.client_name ?? "—"} · {formatDateTime(o.created_at)} · {o.payment_mode ? PAYMENT_LABEL[o.payment_mode] : "Balcão"} {o.paid ? "(pago)" : ""}
                    {Number(o.discount) > 0 && ` · cupom −${formatBRL(Number(o.discount))}`}
                  </p>
                </div>
                {o.dispute_open && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-900">Em disputa</span>}
                {o.client_confirmed_at && <span className="rounded-full bg-agua-50 px-2 py-0.5 text-[11px] font-bold text-petroleo">Concluído</span>}
                <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-semibold", STATUS_STYLE[o.status])}>{STATUS_LABEL[o.status]}</span>
                <span className="w-24 text-right text-sm font-semibold text-petroleo">{formatBRL(Number(o.amount))}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Pager page={page} total={total} onPage={setPage} />
      {open && (
        <Modal open title={`Pedido nº ${open.number} · ${open.business_name}`} onClose={() => setOpen(null)}>
          <div className="space-y-4">
            <p className="text-sm text-grafite-500">
              {open.client_name ?? "—"} · {STATUS_LABEL[open.status]} · {formatBRL(Number(open.amount))}
              {open.payment_mode && ` · ${PAYMENT_LABEL[open.payment_mode]}`}
              {open.logistics_mode && ` · ${LOGISTICS_LABEL[open.logistics_mode]}`}
            </p>
            {open.logistics_mode === "entregador" && <OrderDeliveriesCard orderId={open.id} compact />}
            <OrderTimeline orderId={open.id} />
          </div>
        </Modal>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ anúncios */

type ListingRow = {
  id: string;
  title: string;
  category_name: string | null;
  municipality_name: string | null;
  neighborhood: string | null;
  client_name: string;
  status: "aberto" | "contratado" | "cancelado";
  expired: boolean;
  proposals: number;
  created_at: string;
  expires_at: string;
  total_count: number;
};

export function AdminListings() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("aberto");
  const { rows, page, setPage, total, error, reload } = useAdminList<ListingRow>("admin_listings", { p_q: q || null, p_status: status || null });
  const [closing, setClosing] = useState<ListingRow | null>(null);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  async function close() {
    if (!closing) return;
    const { error: e } = await supabase.rpc("admin_close_listing", { p_listing_id: closing.id, p_reason: reason });
    if (e) return setErr(friendlyError(e));
    setClosing(null);
    void reload();
  }
  return (
    <Card className="overflow-hidden" data-testid="admin-listings">
      <div className="flex flex-col gap-3 p-4 sm:flex-row">
        <SearchBox value={q} onChange={setQ} label="Buscar anúncio" placeholder="Título, descrição ou cliente" />
        <div className="sm:w-48">
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filtrar anúncios">
            <option value="aberto">Abertos</option>
            <option value="contratado">Contratados</option>
            <option value="cancelado">Encerrados</option>
            <option value="">Todos</option>
          </Select>
        </div>
      </div>
      {error && <div className="px-4 pb-3"><Alert>{error}</Alert></div>}
      {rows === null ? (
        <InlineLoader />
      ) : rows.length === 0 ? (
        <EmptyState icon={<Megaphone className="h-6 w-6" />} title="Nenhum anúncio" description="Mude a busca ou o filtro." />
      ) : (
        <ul className="divide-y divide-grafite/5 border-t border-grafite/5">
          {rows.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-grafite">{l.title}</p>
                <p className="text-xs text-grafite-500">
                  {l.category_name} · {[l.neighborhood, l.municipality_name].filter(Boolean).join(", ")} · {l.client_name} · {formatDate(l.created_at)} · {l.proposals} proposta(s)
                </p>
              </div>
              <span className="rounded-full bg-nevoa px-2.5 py-1 text-[11px] font-semibold text-grafite-500">
                {l.status === "aberto" ? (l.expired ? "Expirado" : "Aberto") : l.status === "contratado" ? "Contratado" : "Encerrado"}
              </span>
              {l.status === "aberto" && (
                <Button variant="outline" className="h-9" onClick={() => { setClosing(l); setReason(""); setErr(null); }}>
                  Encerrar
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <Pager page={page} total={total} onPage={setPage} />
      {closing && (
        <Modal open title={`Encerrar "${closing.title}"`} onClose={() => setClosing(null)}>
          <div className="space-y-3">
            <p className="text-sm text-grafite-500">As propostas recebidas são recusadas e o cliente recebe o motivo num aviso.</p>
            {err && <Alert>{err}</Alert>}
            <Textarea rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Motivo do encerramento" placeholder="Ex.: o anúncio pede um serviço que o Limpa Aqui não oferece." />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setClosing(null)}>
                Voltar
              </Button>
              <Button disabled={!reason.trim()} onClick={() => void close()}>
                Encerrar anúncio
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ auditoria */

type AuditRow = { id: number; actor_name: string; action: "insert" | "update" | "delete"; target_type: string; target_id: string | null; changes: Record<string, unknown>; created_at: string; total_count: number };
const TARGET_LABEL: Record<string, string> = {
  municipalities: "Município", user_roles: "Perfil de usuário", service_categories: "Categoria", banners: "Banner", commission_rules: "Regra de comissão",
  delivery_zones: "Tarifa de entrega", platform_settings: "Configuração da plataforma", payouts: "Repasse", order_disputes: "Disputa", plans: "Plano",
  plan_features: "Recurso de plano", subscriptions: "Assinatura", couriers: "Entregador", listings: "Anúncio", chat_reports: "Denúncia",
  platform_commissions: "Comissão", coupons: "Cupom",
};
const ACTION_LABEL = { insert: "criou", update: "alterou", delete: "apagou" } as const;
const show = (v: unknown) => (v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));

export function AdminAudit() {
  const [type, setType] = useState("");
  const { rows, page, setPage, total, error } = useAdminList<AuditRow>("admin_audit_logs", { p_target_type: type || null });
  return (
    <Card className="overflow-hidden" data-testid="admin-audit">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <p className="flex-1 text-sm text-grafite-500">Toda alteração feita por um administrador fica registrada aqui e não pode ser apagada.</p>
        <div className="sm:w-60">
          <Select value={type} onChange={(e) => setType(e.target.value)} aria-label="Filtrar por item">
            <option value="">Tudo</option>
            {Object.entries(TARGET_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {error && <div className="px-4 pb-3"><Alert>{error}</Alert></div>}
      {rows === null ? (
        <InlineLoader />
      ) : rows.length === 0 ? (
        <EmptyState icon={<ScrollText className="h-6 w-6" />} title="Nada registrado ainda" description="As próximas alterações feitas no /admin aparecem aqui." />
      ) : (
        <ul className="divide-y divide-grafite/5 border-t border-grafite/5">
          {rows.map((a) => (
            <li key={a.id} className="px-4 py-3 text-sm">
              <p className="text-grafite">
                <strong>{a.actor_name}</strong> {ACTION_LABEL[a.action]} <strong>{TARGET_LABEL[a.target_type] ?? a.target_type}</strong>
                <span className="text-xs text-grafite-500"> · {formatDateTime(a.created_at)}</span>
              </p>
              {a.action === "update" ? (
                <ul className="mt-1 space-y-0.5 text-xs text-grafite-500">
                  {Object.entries(a.changes).map(([k, v]) => {
                    const [before, after] = (v as unknown[]) ?? [];
                    return (
                      <li key={k} className="break-all">
                        <span className="font-semibold">{k}</span>: {show(before)} → {show(after)}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-1 break-all text-xs text-grafite-500">{show((a.changes as Record<string, unknown>).code ?? (a.changes as Record<string, unknown>).name ?? (a.changes as Record<string, unknown>).title ?? a.target_id)}</p>
              )}
            </li>
          ))}
        </ul>
      )}
      <Pager page={page} total={total} onPage={setPage} />
    </Card>
  );
}
