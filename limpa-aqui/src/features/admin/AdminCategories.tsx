import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { Alert, Button, Card, Field, InlineLoader, Input, Select, cn } from "@/components/shared/ui";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import type { PricingUnit } from "@/lib/types";

type Category = {
  code: string;
  name: string;
  description: string | null;
  group_code: string;
  pricing_units: PricingUnit[];
  sort: number;
  active: boolean;
  businesses: number;
  services: number;
  listings: number;
};

const GROUPS: Record<string, string> = {
  roupas: "Roupas",
  calcados: "Calçados",
  casa: "Casa (cama, cortinas, tapetes)",
  estofados: "Estofados",
  acessorios: "Acessórios",
  outros: "Outros",
};
const UNITS: Record<PricingUnit, string> = {
  peca: "Por peça",
  kg: "Por quilo",
  par: "Por par",
  conjunto: "Por pacote/conjunto",
  unidade: "Por serviço/unidade",
  m2: "Por m²",
  orcamento: "Sob orçamento",
};

type Form = { code: string; name: string; description: string; group_code: string; pricing_units: PricingUnit[]; sort: string; active: boolean; isNew: boolean };
const empty = (): Form => ({ code: "", name: "", description: "", group_code: "roupas", pricing_units: ["peca"], sort: "", active: true, isNew: true });

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);

/** Administração → Categorias: as categorias do marketplace (busca, anúncios, catálogo dos prestadores). */
export function AdminCategories() {
  const [list, setList] = useState<Category[] | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("admin_categories");
    if (error) setMsg({ kind: "error", text: friendlyError(error) });
    setList(((data as Category[]) ?? []).map((c) => ({ ...c, businesses: Number(c.businesses), services: Number(c.services), listings: Number(c.listings) })));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(f: Form) {
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.rpc("admin_upsert_category", {
      p_code: f.code,
      p_name: f.name,
      p_group_code: f.group_code,
      p_pricing_units: f.pricing_units,
      p_sort: f.sort ? Number(f.sort) : null,
      p_active: f.active,
      p_description: f.description || null,
    });
    setBusy(false);
    if (error) return setMsg({ kind: "error", text: friendlyError(error) });
    setMsg({ kind: "success", text: `${f.name}: salva.` });
    setForm(null);
    await load();
  }

  async function toggle(c: Category) {
    if (c.active && !window.confirm(`Desativar "${c.name}"? Ela some da busca e de novos anúncios. Serviços e pedidos que já usam continuam.`)) return;
    await save({ code: c.code, name: c.name, description: c.description ?? "", group_code: c.group_code, pricing_units: c.pricing_units, sort: String(c.sort), active: !c.active, isNew: false });
  }

  if (list === null) return <InlineLoader />;

  return (
    <div className="space-y-4" data-testid="admin-categories">
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      {form ? (
        <Card className="space-y-4 p-5">
          <h3 className="text-base font-semibold text-petroleo">{form.isNew ? "Nova categoria" : `Editar: ${form.name}`}</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome" htmlFor="cat-name">
              <Input
                id="cat-name"
                value={form.name}
                maxLength={60}
                onChange={(e) => setForm({ ...form, name: e.target.value, code: form.isNew ? slug(e.target.value) : form.code })}
              />
            </Field>
            <Field label="Código" htmlFor="cat-code" hint={form.isNew ? "Gerado pelo nome; não muda depois de criado." : "Não pode ser alterado."}>
              <Input id="cat-code" value={form.code} disabled={!form.isNew} onChange={(e) => setForm({ ...form, code: slug(e.target.value) })} />
            </Field>
            <Field label="Grupo" htmlFor="cat-group">
              <Select id="cat-group" value={form.group_code} onChange={(e) => setForm({ ...form, group_code: e.target.value })}>
                {Object.entries(GROUPS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Ordem na lista" htmlFor="cat-sort" hint="Menor aparece primeiro. Vazio = no fim.">
              <Input id="cat-sort" type="number" value={form.sort} onChange={(e) => setForm({ ...form, sort: e.target.value })} />
            </Field>
          </div>
          <Field label="Descrição (opcional)" htmlFor="cat-desc">
            <Input id="cat-desc" value={form.description} maxLength={200} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-grafite">Formas de cobrança aceitas</legend>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(UNITS) as PricingUnit[]).map((u) => {
                const on = form.pricing_units.includes(u);
                return (
                  <button
                    key={u}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => setForm({ ...form, pricing_units: on ? form.pricing_units.filter((x) => x !== u) : [...form.pricing_units, u] })}
                    className={cn(
                      "rounded-full border-2 px-3 py-1.5 text-xs font-semibold transition",
                      on ? "border-agua bg-agua-50 text-petroleo" : "border-grafite/10 text-grafite-500",
                    )}
                  >
                    {UNITS[u]}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <label className="flex items-center gap-2 text-sm text-grafite">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="h-4 w-4 accent-agua-600" />
            Ativa (aparece na busca, nos anúncios e no cadastro de prestadores)
          </label>
          <div className="flex gap-2">
            <Button loading={busy} onClick={() => void save(form)} data-testid="category-save">
              Salvar
            </Button>
            <Button variant="outline" onClick={() => setForm(null)}>
              Cancelar
            </Button>
          </div>
        </Card>
      ) : (
        <div className="flex justify-end">
          <Button onClick={() => setForm(empty())} data-testid="category-new">
            <Plus className="h-4 w-4" aria-hidden /> Nova categoria
          </Button>
        </div>
      )}

      <Card className="overflow-hidden">
        <ul className="divide-y divide-grafite/5" data-testid="category-list">
          {list.map((c) => (
            <li key={c.code} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className={cn("text-sm font-semibold", c.active ? "text-grafite" : "text-grafite-500 line-through")}>{c.name}</p>
                <p className="text-xs text-grafite-500">
                  {GROUPS[c.group_code] ?? c.group_code} · {c.pricing_units.map((u) => UNITS[u]).join(", ")}
                </p>
                <p className="text-[11px] text-grafite-500">
                  {c.businesses} prestador(es) · {c.services} serviço(s) · {c.listings} anúncio(s)
                </p>
              </div>
              <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", c.active ? "bg-agua-50 text-petroleo" : "bg-nevoa text-grafite-500")}>
                {c.active ? "Ativa" : "Desativada"}
              </span>
              <Button
                variant="outline"
                className="h-9"
                aria-label={`Editar ${c.name}`}
                onClick={() =>
                  setForm({ code: c.code, name: c.name, description: c.description ?? "", group_code: c.group_code, pricing_units: c.pricing_units, sort: String(c.sort), active: c.active, isNew: false })
                }
              >
                <Pencil className="h-4 w-4" aria-hidden />
              </Button>
              <Button variant="outline" className="h-9" disabled={busy} onClick={() => void toggle(c)}>
                {c.active ? "Desativar" : "Ativar"}
              </Button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
