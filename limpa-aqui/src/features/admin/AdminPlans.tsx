import { useCallback, useEffect, useState } from "react";
import { CalendarClock, HandCoins, TrendingUp, Users } from "lucide-react";
import { Alert, Button, Card, Field, Input, Modal, Select, StatCard, Textarea, cn } from "@/components/shared/ui";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { formatBRL, formatDate, parseMoney } from "@/lib/format";

type Plan = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  price: number;
  period_days: number;
  max_orders_month: number | null;
  max_staff: number | null;
  featured: boolean;
  is_default: boolean;
  public: boolean;
  active: boolean;
  sort: number;
  features: string[];
  subscribers: number;
};
type Sub = {
  business_id: string;
  business_name: string;
  plan_id: string | null;
  plan_name: string | null;
  effective_plan_name: string;
  status: string | null;
  current_period_end: string | null;
  source: string | null;
  last_paid_at: string | null;
  open_invoice: number | null;
};
type Overview = { grace_days: number; paying: number; mrr: number; in_grace: number; expired: number; received_30d: number; open_invoices: number };
type Feature = { code: string; name: string };

const empty = { id: null as string | null, code: "", name: "", description: "", price: "", period_days: "30", max_orders: "", max_staff: "", featured: false, public: true, active: true, sort: "0", features: [] as string[], is_default: false };
const intOrNull = (v: string) => (v.trim() === "" ? null : Math.max(0, Math.round(Number(v))));
const SOURCE = { pagamento: "Pago", admin: "Cortesia", gratis: "Escolheu grátis" } as Record<string, string>;

/** Administração → Planos: catálogo de planos (nada fixo no código), assinantes, cortesias e tolerância. */
export function AdminPlans() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [ov, setOv] = useState<Overview | null>(null);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [form, setForm] = useState<typeof empty | null>(null);
  const [grant, setGrant] = useState<{ sub: Sub; plan: string; until: string } | null>(null);
  const [grace, setGrace] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  const load = useCallback(async () => {
    const [p, s, o, f] = await Promise.all([
      supabase.rpc("admin_plans"),
      supabase.rpc("admin_subscriptions"),
      supabase.rpc("admin_subscription_overview"),
      supabase.from("features").select("code, name").order("sort"),
    ]);
    const err = p.error ?? s.error ?? o.error;
    if (err) setMsg({ kind: "error", text: friendlyError(err) });
    setPlans(((p.data as Plan[]) ?? []).map((x) => ({ ...x, price: Number(x.price) })));
    setSubs((s.data as Sub[]) ?? []);
    const ovv = o.data as Overview | null;
    setOv(ovv);
    if (ovv) setGrace(String(ovv.grace_days));
    setFeatures((f.data as Feature[]) ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(key: string, fn: () => PromiseLike<{ error: unknown }>, ok: string) {
    setBusy(key);
    setMsg(null);
    const { error } = await fn();
    setBusy(null);
    if (error) {
      setMsg({ kind: "error", text: friendlyError(error) });
      return false;
    }
    setMsg({ kind: "success", text: ok });
    await load();
    return true;
  }

  function edit(p: Plan | null) {
    setForm(
      p
        ? {
            id: p.id, code: p.code, name: p.name, description: p.description ?? "", price: String(p.price).replace(".", ","),
            period_days: String(p.period_days), max_orders: p.max_orders_month?.toString() ?? "", max_staff: p.max_staff?.toString() ?? "",
            featured: p.featured, public: p.public, active: p.active, sort: String(p.sort), features: p.features, is_default: p.is_default,
          }
        : { ...empty, features: features.map((f) => f.code) },
    );
  }

  async function save() {
    if (!form) return;
    const ok = await run(
      "save",
      () =>
        supabase.rpc("admin_upsert_plan", {
          p_plan_id: form.id,
          p_code: form.code || form.name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30),
          p_name: form.name,
          p_description: form.description,
          p_price: parseMoney(form.price) ?? 0,
          p_period_days: Number(form.period_days) || 30,
          p_max_orders_month: intOrNull(form.max_orders) || null,
          p_max_staff: intOrNull(form.max_staff),
          p_featured: form.featured,
          p_public: form.public,
          p_active: form.active,
          p_sort: Number(form.sort) || 0,
          p_features: form.features,
        }),
      "Plano salvo.",
    );
    if (ok) setForm(null);
  }

  const toggleFeature = (code: string) =>
    setForm((f) => f && { ...f, features: f.features.includes(code) ? f.features.filter((x) => x !== code) : [...f.features, code] });

  return (
    <div className="space-y-6">
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {ov && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="sub-overview">
          <StatCard label="Assinantes pagantes" value={String(ov.paying)} icon={<Users className="h-5 w-5" />} />
          <StatCard label="Receita mensal (MRR)" value={formatBRL(Number(ov.mrr))} icon={<TrendingUp className="h-5 w-5" />} />
          <StatCard label="Recebido em 30 dias" value={formatBRL(Number(ov.received_30d))} icon={<HandCoins className="h-5 w-5" />} />
          <StatCard label="Em tolerância / vencidos" value={`${ov.in_grace} / ${ov.expired}`} icon={<CalendarClock className="h-5 w-5" />} />
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 p-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-petroleo">Planos</h2>
            <p className="text-xs text-grafite-500">Preço, período, recursos e limites de cada plano. Quem não paga fica no plano padrão (grátis).</p>
          </div>
          <Button onClick={() => edit(null)}>Novo plano</Button>
        </div>
        <ul className="divide-y divide-grafite/5 border-t border-grafite/5" data-testid="plan-admin-list">
          {plans.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-semibold text-grafite">
                  {p.name} {p.is_default && <span className="font-normal text-grafite-500">· padrão</span>}
                  {!p.active && <span className="font-normal text-red-600"> · inativo</span>}
                  {p.active && !p.public && <span className="font-normal text-grafite-500"> · oculto</span>}
                </p>
                <p className="text-xs text-grafite-500">
                  {p.price > 0 ? `${formatBRL(p.price)} / ${p.period_days} dias` : "Grátis"} · {p.max_orders_month ?? "∞"} pedidos/mês · {p.max_staff ?? "∞"} funcionários ·{" "}
                  {p.features.length} recursos{p.featured ? " · destaque" : ""}
                </p>
              </div>
              <span className="text-sm text-grafite-500">{p.subscribers} lavanderia(s)</span>
              <Button variant="outline" className="h-9" onClick={() => edit(p)}>
                Editar
              </Button>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-end gap-3 p-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-petroleo">Assinaturas</h2>
            <p className="text-xs text-grafite-500">Plano que vale agora em cada lavanderia. Vencido além da tolerância, volta sozinho ao plano padrão.</p>
          </div>
          <div className="w-32">
            <Field label="Tolerância (dias)" htmlFor="grace">
              <Input id="grace" inputMode="numeric" value={grace} onChange={(e) => setGrace(e.target.value)} />
            </Field>
          </div>
          <Button variant="outline" loading={busy === "grace"} onClick={() => void run("grace", () => supabase.rpc("admin_set_subscription_settings", { p_grace_days: Number(grace) }), "Tolerância salva.")}>
            Salvar
          </Button>
        </div>
        <ul className="divide-y divide-grafite/5 border-t border-grafite/5" data-testid="sub-list">
          {subs.map((s) => (
            <li key={s.business_id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-semibold text-grafite">{s.business_name}</p>
                <p className="text-xs text-grafite-500">
                  {s.effective_plan_name}
                  {s.plan_name && s.plan_name !== s.effective_plan_name && ` (era ${s.plan_name}, vencido)`}
                  {s.source && ` · ${SOURCE[s.source] ?? s.source}`}
                  {s.current_period_end && ` · até ${formatDate(s.current_period_end)}`}
                  {s.last_paid_at && ` · último pagamento ${formatDate(s.last_paid_at)}`}
                  {s.open_invoice != null && ` · mensalidade aberta ${formatBRL(Number(s.open_invoice))}`}
                </p>
              </div>
              <Button variant="outline" className="h-9" onClick={() => setGrant({ sub: s, plan: plans.find((p) => !p.is_default)?.id ?? plans[0]?.id ?? "", until: "" })}>
                Dar plano
              </Button>
            </li>
          ))}
        </ul>
      </Card>

      {form && (
        <Modal open title={form.id ? `Editar plano ${form.name}` : "Novo plano"} onClose={() => setForm(null)}>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nome" htmlFor="pl-name">
                <Input id="pl-name" maxLength={40} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label="Preço (R$)" htmlFor="pl-price" hint={form.is_default ? "O plano padrão é sempre grátis." : "0 = grátis"}>
                <Input id="pl-price" inputMode="decimal" disabled={form.is_default} value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
              </Field>
              <Field label="Período (dias)" htmlFor="pl-period">
                <Input id="pl-period" inputMode="numeric" value={form.period_days} onChange={(e) => setForm({ ...form, period_days: e.target.value })} />
              </Field>
              <Field label="Ordem na lista" htmlFor="pl-sort">
                <Input id="pl-sort" inputMode="numeric" value={form.sort} onChange={(e) => setForm({ ...form, sort: e.target.value })} />
              </Field>
              <Field label="Pedidos de balcão por mês" htmlFor="pl-orders" hint="Vazio = sem limite">
                <Input id="pl-orders" inputMode="numeric" value={form.max_orders} onChange={(e) => setForm({ ...form, max_orders: e.target.value })} />
              </Field>
              <Field label="Funcionários" htmlFor="pl-staff" hint="Vazio = sem limite">
                <Input id="pl-staff" inputMode="numeric" value={form.max_staff} onChange={(e) => setForm({ ...form, max_staff: e.target.value })} />
              </Field>
            </div>
            <Field label="Descrição" htmlFor="pl-desc">
              <Textarea id="pl-desc" rows={2} maxLength={300} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
            <div className="flex flex-wrap gap-4 text-sm">
              {(
                [
                  ["featured", "Destaque na busca"],
                  ["public", "Aparece para os prestadores"],
                  ["active", "Ativo"],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="flex items-center gap-2">
                  <input type="checkbox" className="accent-agua" checked={form[k]} disabled={form.is_default && k === "active"} onChange={(e) => setForm({ ...form, [k]: e.target.checked })} />
                  {label}
                </label>
              ))}
            </div>
            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-grafite">Recursos liberados</legend>
              <div className="grid gap-1 sm:grid-cols-2" data-testid="plan-features">
                {features.map((f) => (
                  <label key={f.code} className={cn("flex items-center gap-2 rounded-lg px-2 py-1 text-sm", form.features.includes(f.code) && "bg-agua-50/60")}>
                    <input type="checkbox" className="accent-agua" checked={form.features.includes(f.code)} onChange={() => toggleFeature(f.code)} />
                    {f.name}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setForm(null)}>
                Voltar
              </Button>
              <Button loading={busy === "save"} disabled={form.name.trim().length < 2} onClick={() => void save()}>
                Salvar plano
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {grant && (
        <Modal open title={`Dar plano a ${grant.sub.business_name}`} onClose={() => setGrant(null)}>
          <div className="space-y-4">
            <p className="text-sm text-grafite-500">Cortesia ou ajuste manual: o plano vale sem cobrança até a data escolhida (vazio = sem fim).</p>
            <Field label="Plano" htmlFor="gr-plan">
              <Select id="gr-plan" value={grant.plan} onChange={(e) => setGrant({ ...grant, plan: e.target.value })}>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Válido até" htmlFor="gr-until">
              <Input id="gr-until" type="date" value={grant.until} onChange={(e) => setGrant({ ...grant, until: e.target.value })} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setGrant(null)}>
                Voltar
              </Button>
              <Button
                loading={busy === "grant"}
                onClick={() =>
                  void run("grant", () => supabase.rpc("admin_grant_plan", { p_business_id: grant.sub.business_id, p_plan_id: grant.plan, p_until: grant.until || null }), "Plano aplicado.").then(
                    (ok) => ok && setGrant(null),
                  )
                }
              >
                Aplicar
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
