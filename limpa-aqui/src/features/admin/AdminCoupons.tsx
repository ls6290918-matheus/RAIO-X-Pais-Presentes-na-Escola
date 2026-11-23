import { useCallback, useEffect, useState } from "react";
import { Plus, TicketPercent } from "lucide-react";
import { Alert, Button, Card, EmptyState, Field, InlineLoader, Input, Modal, Select, cn } from "@/components/shared/ui";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { formatBRL, formatDate } from "@/lib/format";

type Coupon = {
  id: string;
  code: string;
  description: string | null;
  kind: "percentual" | "valor";
  value: number;
  max_discount: number | null;
  min_order: number;
  valid_from: string;
  valid_until: string | null;
  max_uses: number | null;
  max_uses_per_user: number;
  first_order_only: boolean;
  active: boolean;
  uses: number;
  paid_uses: number;
  discount_paid: number;
};
type Draft = { id: string | null; code: string; description: string; kind: "percentual" | "valor"; value: string; max_discount: string; min_order: string; valid_until: string; max_uses: string; max_uses_per_user: string; first_order_only: boolean; active: boolean };

const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));
const EMPTY: Draft = { id: null, code: "", description: "", kind: "percentual", value: "10", max_discount: "", min_order: "0", valid_until: "", max_uses: "", max_uses_per_user: "1", first_order_only: false, active: true };

export const describeCoupon = (c: Pick<Coupon, "kind" | "value" | "max_discount" | "min_order">) =>
  `${c.kind === "percentual" ? `${Number(c.value)}%` : formatBRL(Number(c.value))} de desconto` +
  (c.max_discount ? ` (até ${formatBRL(Number(c.max_discount))})` : "") +
  (Number(c.min_order) > 0 ? ` · pedidos a partir de ${formatBRL(Number(c.min_order))}` : "");

/** Administração → Cupons: desconto pago pela plataforma em pedidos pagos pelo app (o repasse da lavanderia não muda). */
export function AdminCoupons() {
  const [list, setList] = useState<Coupon[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error: err } = await supabase.rpc("admin_coupons");
    if (err) setError(friendlyError(err));
    setList((data as Coupon[]) ?? []);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.rpc("admin_upsert_coupon", {
      p_id: draft.id, p_code: draft.code, p_description: draft.description, p_kind: draft.kind, p_value: num(draft.value),
      p_max_discount: num(draft.max_discount), p_min_order: num(draft.min_order) ?? 0,
      p_valid_until: draft.valid_until ? new Date(`${draft.valid_until}T23:59:59-03:00`).toISOString() : null,
      p_max_uses: num(draft.max_uses), p_max_uses_per_user: num(draft.max_uses_per_user) ?? 1, p_first_order_only: draft.first_order_only, p_active: draft.active,
    });
    setBusy(false);
    if (err) return setError(friendlyError(err));
    setDraft(null);
    await load();
  }

  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setDraft((d) => d && { ...d, [k]: e.target.value });

  return (
    <div className="space-y-4" data-testid="admin-coupons">
      <div className="flex flex-wrap items-center gap-3">
        <p className="flex-1 text-sm text-grafite-500">
          O desconto sai da plataforma: o cliente paga menos pelo Pix e a lavanderia recebe o mesmo repasse. Só vale para pedidos pagos pelo app.
        </p>
        <Button onClick={() => { setDraft(EMPTY); setError(null); }}>
          <Plus className="h-4 w-4" aria-hidden /> Novo cupom
        </Button>
      </div>
      {error && !draft && <Alert>{error}</Alert>}
      {list === null ? (
        <InlineLoader />
      ) : list.length === 0 ? (
        <Card>
          <EmptyState icon={<TicketPercent className="h-6 w-6" />} title="Nenhum cupom" description="Crie um cupom de boas-vindas ou de campanha." />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-grafite/5">
            {list.map((c) => {
              const expired = c.valid_until && new Date(c.valid_until) < new Date();
              return (
                <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="rounded-lg bg-petroleo px-2.5 py-1 font-mono text-sm font-bold tracking-wider text-agua">{c.code}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-grafite">{describeCoupon(c)}</p>
                    <p className="text-xs text-grafite-500">
                      {c.description ? `${c.description} · ` : ""}
                      {c.valid_until ? `até ${formatDate(c.valid_until)}` : "sem validade"} · {c.max_uses ? `${c.uses}/${c.max_uses} usos` : `${c.uses} uso(s)`} · {c.max_uses_per_user} por pessoa
                      {c.first_order_only ? " · só 1º pedido" : ""}
                    </p>
                    <p className="text-xs text-grafite-500">
                      Pagos com cupom: <strong>{c.paid_uses}</strong> · desconto concedido: <strong>{formatBRL(Number(c.discount_paid))}</strong>
                    </p>
                  </div>
                  <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-semibold", c.active && !expired ? "bg-agua-50 text-petroleo" : "bg-nevoa text-grafite-500")}>
                    {!c.active ? "Desativado" : expired ? "Vencido" : "Ativo"}
                  </span>
                  <Button
                    variant="outline"
                    className="h-9"
                    onClick={() => {
                      setError(null);
                      setDraft({
                        id: c.id, code: c.code, description: c.description ?? "", kind: c.kind, value: String(c.value), max_discount: c.max_discount ? String(c.max_discount) : "",
                        min_order: String(c.min_order), valid_until: c.valid_until ? c.valid_until.slice(0, 10) : "", max_uses: c.max_uses ? String(c.max_uses) : "",
                        max_uses_per_user: String(c.max_uses_per_user), first_order_only: c.first_order_only, active: c.active,
                      });
                    }}
                  >
                    Editar
                  </Button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {draft && (
        <Modal open title={draft.id ? `Editar ${draft.code}` : "Novo cupom"} onClose={() => setDraft(null)}>
          <div className="space-y-3" data-testid="coupon-form">
            {error && <Alert>{error}</Alert>}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Código" htmlFor="cp-code">
                <Input id="cp-code" value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} maxLength={20} placeholder="BEMVINDO10" />
              </Field>
              <Field label="Descrição (interna)" htmlFor="cp-desc">
                <Input id="cp-desc" value={draft.description} onChange={set("description")} maxLength={120} placeholder="Campanha de boas-vindas" />
              </Field>
              <Field label="Tipo" htmlFor="cp-kind">
                <Select id="cp-kind" value={draft.kind} onChange={set("kind")}>
                  <option value="percentual">Percentual (%)</option>
                  <option value="valor">Valor fixo (R$)</option>
                </Select>
              </Field>
              <Field label={draft.kind === "percentual" ? "Desconto (%)" : "Desconto (R$)"} htmlFor="cp-value">
                <Input id="cp-value" inputMode="decimal" value={draft.value} onChange={set("value")} />
              </Field>
              {draft.kind === "percentual" && (
                <Field label="Desconto máximo (R$, opcional)" htmlFor="cp-max">
                  <Input id="cp-max" inputMode="decimal" value={draft.max_discount} onChange={set("max_discount")} />
                </Field>
              )}
              <Field label="Pedido mínimo (R$)" htmlFor="cp-min">
                <Input id="cp-min" inputMode="decimal" value={draft.min_order} onChange={set("min_order")} />
              </Field>
              <Field label="Válido até (opcional)" htmlFor="cp-until">
                <Input id="cp-until" type="date" value={draft.valid_until} onChange={set("valid_until")} />
              </Field>
              <Field label="Usos no total (opcional)" htmlFor="cp-uses">
                <Input id="cp-uses" inputMode="numeric" value={draft.max_uses} onChange={set("max_uses")} />
              </Field>
              <Field label="Usos por pessoa" htmlFor="cp-user">
                <Input id="cp-user" inputMode="numeric" value={draft.max_uses_per_user} onChange={set("max_uses_per_user")} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm text-grafite">
              <input type="checkbox" checked={draft.first_order_only} onChange={(e) => setDraft({ ...draft, first_order_only: e.target.checked })} /> Só no primeiro pedido pago do cliente
            </label>
            <label className="flex items-center gap-2 text-sm text-grafite">
              <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> Ativo
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDraft(null)}>
                Cancelar
              </Button>
              <Button loading={busy} disabled={draft.code.length < 3 || !num(draft.value)} onClick={() => void save()}>
                Salvar cupom
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
