import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Card, Field, Input, Select, cn } from "@/components/shared/ui";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { formatBRL, formatDate, parseMoney } from "@/lib/format";
import { PAYMENT_LABEL } from "@/lib/marketplace";
import type { PaymentMode } from "@/lib/types";

type Summary = {
  payment_mode: PaymentMode;
  orders: number;
  orders_total: number;
  confirmed_orders: number;
  confirmed_total: number;
  commission_expected: number;
  commission_to_collect: number;
  commission_paid: number;
};
type Rule = {
  id: string;
  payment_mode: PaymentMode;
  category_code: string | null;
  municipality_id: number | null;
  percent: number;
  fixed_amount: number;
  valid_from: string;
  valid_to: string | null;
  notes: string | null;
};
type Commission = {
  id: string;
  order_number: number;
  business_name: string;
  payment_mode: PaymentMode;
  base_amount: number;
  commission_amount: number;
  status: "prevista" | "a_cobrar" | "paga" | "cancelada";
  created_at: string;
};

const STATUS_LABEL = { prevista: "Prevista", a_cobrar: "A cobrar", paga: "Paga", cancelada: "Cancelada" } as const;
const n = (v: unknown) => Number(v ?? 0);

/** Administração → Financeiro: resumo por modalidade, regras de comissão (editáveis) e comissões a cobrar. */
export function AdminFinance() {
  const [summary, setSummary] = useState<Summary[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [cats, setCats] = useState<Array<{ code: string; name: string }>>([]);
  const [muns, setMuns] = useState<Array<{ id: number; name: string }>>([]);
  const [form, setForm] = useState({ mode: "direto" as PaymentMode, percent: "", fixed: "", category: "", municipality: "", notes: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  const load = useCallback(async () => {
    const [s, r, c, k, m] = await Promise.all([
      supabase.rpc("admin_finance_summary"),
      supabase.from("commission_rules").select("*").order("valid_from", { ascending: false }).limit(50),
      supabase.rpc("admin_list_commissions", { p_status: null }),
      supabase.rpc("public_categories"),
      supabase.from("municipalities").select("id, name").eq("state_id", 33).order("name"),
    ]);
    const err = s.error ?? r.error ?? c.error;
    if (err) setMsg({ kind: "error", text: friendlyError(err) });
    setSummary((s.data as Summary[]) ?? []);
    setRules((r.data as Rule[]) ?? []);
    setCommissions((c.data as Commission[]) ?? []);
    setCats((k.data as Array<{ code: string; name: string }>) ?? []);
    setMuns((m.data as Array<{ id: number; name: string }>) ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createRule() {
    const percent = form.percent.trim() ? Number(form.percent.replace(",", ".")) : 0;
    const fixed = form.fixed.trim() ? parseMoney(form.fixed) ?? NaN : 0;
    if (!Number.isFinite(percent) || percent < 0 || percent > 50) return setMsg({ kind: "error", text: "Percentual entre 0 e 50." });
    if (!Number.isFinite(fixed) || fixed < 0 || fixed > 1000) return setMsg({ kind: "error", text: "Valor fixo entre R$ 0 e R$ 1.000." });
    if (percent === 0 && fixed === 0) return setMsg({ kind: "error", text: "Informe um percentual ou um valor fixo." });
    if (!window.confirm("Criar esta regra? Ela vale para pedidos feitos a partir de agora e substitui a regra do mesmo recorte.")) return;
    setBusy("rule");
    setMsg(null);
    const { error } = await supabase.rpc("admin_create_commission_rule", {
      p_payment_mode: form.mode,
      p_percent: percent,
      p_fixed: fixed,
      p_category: form.category || null,
      p_municipality_id: form.municipality ? Number(form.municipality) : null,
      p_notes: form.notes.trim() || null,
    });
    setBusy(null);
    if (error) return setMsg({ kind: "error", text: friendlyError(error) });
    setForm((f) => ({ ...f, percent: "", fixed: "", notes: "" }));
    setMsg({ kind: "success", text: "Regra criada. Vale para os próximos pedidos." });
    await load();
  }

  async function endRule(r: Rule) {
    if (!window.confirm("Encerrar esta regra? Pedidos novos deixam de gerar comissão por ela.")) return;
    setBusy(r.id);
    const { error } = await supabase.rpc("admin_end_commission_rule", { p_rule_id: r.id });
    setBusy(null);
    if (error) return setMsg({ kind: "error", text: friendlyError(error) });
    await load();
  }

  async function setStatus(c: Commission, status: "paga" | "cancelada") {
    if (!window.confirm(status === "paga" ? `Marcar como paga a comissão do pedido #${c.order_number} (${c.business_name})?` : "Cancelar esta comissão?")) return;
    setBusy(c.id);
    const { error } = await supabase.rpc("admin_set_commission_status", { p_commission_id: c.id, p_status: status });
    setBusy(null);
    if (error) return setMsg({ kind: "error", text: friendlyError(error) });
    await load();
  }

  const catName = (code: string | null) => (code ? cats.find((c) => c.code === code)?.name ?? code : "Todos os serviços");
  const munName = (id: number | null) => (id ? muns.find((m) => m.id === id)?.name ?? String(id) : "Todo o estado");
  const active = rules.filter((r) => !r.valid_to);

  return (
    <div className="space-y-6">
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      <div className="grid gap-4 lg:grid-cols-2" data-testid="finance-summary">
        {summary.map((s) => (
          <Card key={s.payment_mode} className="p-5">
            <h3 className="text-sm font-semibold text-petroleo">{PAYMENT_LABEL[s.payment_mode]}</h3>
            {s.payment_mode === "app" && n(s.orders) === 0 && <p className="text-xs text-grafite-500">Disponível na Etapa 5b.</p>}
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-grafite-500">Pedidos</dt>
              <dd className="text-right font-semibold text-grafite">
                {n(s.orders)} · {formatBRL(n(s.orders_total))}
              </dd>
              <dt className="text-grafite-500">{s.payment_mode === "direto" ? "Recebido (declarado)" : "Recebido pelo app"}</dt>
              <dd className="text-right font-semibold text-grafite">
                {n(s.confirmed_orders)} · {formatBRL(n(s.confirmed_total))}
              </dd>
              <dt className="text-grafite-500">Comissão prevista</dt>
              <dd className="text-right text-grafite">{formatBRL(n(s.commission_expected))}</dd>
              <dt className="text-grafite-500">Comissão a cobrar</dt>
              <dd className="text-right font-semibold text-amber-700">{formatBRL(n(s.commission_to_collect))}</dd>
              <dt className="text-grafite-500">Comissão paga</dt>
              <dd className="text-right text-petroleo">{formatBRL(n(s.commission_paid))}</dd>
            </dl>
          </Card>
        ))}
      </div>
      <p className="text-xs text-grafite-500">
        Pagamento direto é declarado pelo prestador ao confirmar o recebimento: o dinheiro não passa pela plataforma e não é somado ao que
        entra pelo app.
      </p>

      <Card className="p-5">
        <h3 className="text-base font-semibold text-petroleo">Regras de comissão</h3>
        <p className="text-xs text-grafite-500">
          Sem regra, nenhum pedido gera comissão. A regra mais específica vence (serviço + município &gt; serviço &gt; município &gt; geral) e vale
          para pedidos feitos depois que ela é criada.
        </p>
        <ul className="mt-3 divide-y divide-grafite/5" data-testid="rule-list">
          {active.length === 0 && <li className="py-3 text-sm text-grafite-500">Nenhuma regra ativa: a plataforma não cobra comissão hoje.</li>}
          {active.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-grafite">
                  {String(r.percent).replace(".", ",")}%{n(r.fixed_amount) > 0 && ` + ${formatBRL(r.fixed_amount)}`} · {PAYMENT_LABEL[r.payment_mode]}
                </p>
                <p className="text-xs text-grafite-500">
                  {catName(r.category_code)} · {munName(r.municipality_id)} · desde {formatDate(r.valid_from)}
                  {r.notes && ` · ${r.notes}`}
                </p>
              </div>
              <Button variant="outline" className="h-9" loading={busy === r.id} onClick={() => void endRule(r)}>
                Encerrar
              </Button>
            </li>
          ))}
        </ul>
        <div className="mt-4 grid gap-3 border-t border-grafite/5 pt-4 sm:grid-cols-3">
          <Field label="Modalidade" htmlFor="cr-mode">
            <Select id="cr-mode" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value as PaymentMode })}>
              <option value="direto">{PAYMENT_LABEL.direto}</option>
              <option value="app">{PAYMENT_LABEL.app}</option>
            </Select>
          </Field>
          <Field label="Percentual (%)" htmlFor="cr-percent">
            <Input id="cr-percent" inputMode="decimal" placeholder="Ex.: 10" value={form.percent} onChange={(e) => setForm({ ...form, percent: e.target.value })} />
          </Field>
          <Field label="Valor fixo por pedido (R$)" htmlFor="cr-fixed">
            <Input id="cr-fixed" inputMode="decimal" placeholder="0,00" value={form.fixed} onChange={(e) => setForm({ ...form, fixed: e.target.value })} />
          </Field>
          <Field label="Serviço" htmlFor="cr-cat">
            <Select id="cr-cat" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              <option value="">Todos os serviços</option>
              {cats.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Município" htmlFor="cr-mun">
            <Select id="cr-mun" value={form.municipality} onChange={(e) => setForm({ ...form, municipality: e.target.value })}>
              <option value="">Todo o estado</option>
              {muns.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Observação" htmlFor="cr-notes">
            <Input id="cr-notes" maxLength={200} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
        </div>
        <Button className="mt-3" loading={busy === "rule"} onClick={() => void createRule()}>
          Criar regra
        </Button>
      </Card>

      <Card className="overflow-hidden">
        <h3 className="px-5 pt-5 text-base font-semibold text-petroleo">Comissões</h3>
        {commissions.length === 0 ? (
          <p className="px-5 py-6 text-sm text-grafite-500">Nenhuma comissão ainda.</p>
        ) : (
          <ul className="mt-3 divide-y divide-grafite/5" data-testid="commission-list">
            {commissions.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-grafite">
                    {c.business_name} · pedido #{c.order_number}
                  </p>
                  <p className="text-xs text-grafite-500">
                    {formatBRL(c.base_amount)} · {PAYMENT_LABEL[c.payment_mode]} · {formatDate(c.created_at)}
                  </p>
                </div>
                <span className="font-semibold text-petroleo">{formatBRL(c.commission_amount)}</span>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs font-semibold",
                    c.status === "a_cobrar" ? "bg-amber-50 text-amber-700" : c.status === "paga" ? "bg-agua-50 text-petroleo" : "bg-nevoa text-grafite-500",
                  )}
                >
                  {STATUS_LABEL[c.status]}
                </span>
                {c.status === "a_cobrar" && (
                  <Button className="h-9" loading={busy === c.id} onClick={() => void setStatus(c, "paga")}>
                    Marcar como paga
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
