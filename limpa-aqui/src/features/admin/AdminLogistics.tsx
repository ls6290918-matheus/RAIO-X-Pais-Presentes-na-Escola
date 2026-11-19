import { useCallback, useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Alert, Button, Card, Field, Input, Modal, Select, cn } from "@/components/shared/ui";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { formatBRL, moneyInput, parseMoney } from "@/lib/format";

type Row = {
  municipality_id: number;
  name: string;
  status: "cadastrado" | "ativo" | "suspenso";
  has_zone: boolean;
  zone_active: boolean;
  base_fee: number | null;
  price_per_km: number | null;
  min_fee: number | null;
  road_factor: number | null;
  max_km: number | null;
  couriers_approved: number;
  has_logistics: boolean;
  open_deliveries: number;
};

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Administração → Logística: tarifa de entrega por município (editável) e cobertura de entregadores. */
export function AdminLogistics() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"relevantes" | "todos" | "com_logistica">("relevantes");
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState({ base: "", perKm: "", min: "", factor: "1,30", maxKm: "30", active: true });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("admin_logistics_overview");
    if (error) setMsg({ kind: "error", text: friendlyError(error) });
    setRows(((data as Row[]) ?? []).map((r) => ({ ...r, couriers_approved: Number(r.couriers_approved), open_deliveries: Number(r.open_deliveries) })));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const k = norm(q.trim());
    return (rows ?? []).filter(
      (r) =>
        (!k || norm(r.name).includes(k)) &&
        (filter === "todos" ||
          (filter === "com_logistica" ? r.has_logistics : k || r.status === "ativo" || r.has_zone || r.couriers_approved > 0)),
    );
  }, [rows, q, filter]);

  function open(r: Row) {
    setEditing(r);
    setFormError(null);
    setForm({
      base: r.base_fee != null ? moneyInput(r.base_fee) : "",
      perKm: r.price_per_km != null ? moneyInput(r.price_per_km) : "",
      min: r.min_fee != null ? moneyInput(r.min_fee) : "",
      factor: String(r.road_factor ?? 1.3).replace(".", ","),
      maxKm: String(r.max_km ?? 30).replace(".", ","),
      active: r.has_zone ? r.zone_active : true,
    });
  }

  async function save() {
    if (!editing) return;
    const base = parseMoney(form.base);
    const perKm = parseMoney(form.perKm);
    const min = form.min.trim() ? parseMoney(form.min) : 0;
    const factor = Number(form.factor.replace(",", "."));
    const maxKm = Number(form.maxKm.replace(",", "."));
    if (!Number.isFinite(base) || base < 0 || base > 500) return setFormError("Taxa base entre R$ 0 e R$ 500.");
    if (!Number.isFinite(perKm) || perKm < 0 || perKm > 50) return setFormError("Valor por km entre R$ 0 e R$ 50.");
    if (!Number.isFinite(min) || min < 0 || min > 500) return setFormError("Mínimo entre R$ 0 e R$ 500.");
    if (!Number.isFinite(factor) || factor < 1 || factor > 3) return setFormError("Fator de rota entre 1 e 3.");
    if (!Number.isFinite(maxKm) || maxKm < 1 || maxKm > 200) return setFormError("Distância máxima entre 1 e 200 km.");
    setBusy(true);
    const { error } = await supabase.rpc("admin_upsert_delivery_zone", {
      p_municipality_id: editing.municipality_id,
      p_base_fee: base,
      p_price_per_km: perKm,
      p_min_fee: min,
      p_road_factor: factor,
      p_max_km: maxKm,
      p_active: form.active,
    });
    setBusy(false);
    if (error) return setFormError(friendlyError(error));
    setMsg({ kind: "success", text: `Tarifa de ${editing.name} salva.` });
    setEditing(null);
    await load();
  }

  if (!rows) return null;
  const example = (() => {
    const base = parseMoney(form.base), perKm = parseMoney(form.perKm), min = form.min.trim() ? parseMoney(form.min) : 0;
    const factor = Number(form.factor.replace(",", "."));
    if (![base, perKm, min, factor].every(Number.isFinite)) return null;
    const d = Math.round(3 * factor * 10) / 10;
    return `Exemplo: 3 km em linha reta ≈ ${String(d).replace(".", ",")} km de rota → ${formatBRL(Math.max(min, base + perKm * d))} por corrida.`;
  })();

  return (
    <div className="space-y-4">
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <p className="text-xs text-grafite-500">
        Um município tem logística quando tem tarifa ativa e pelo menos um entregador aprovado que atende lá. Só então o cliente vê a opção
        "Entregador do Limpa Aqui", sempre com o valor antes de confirmar. Corrida = taxa base + valor por km × distância (em linha reta × fator
        de rota), nunca abaixo do mínimo.
      </p>
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 p-4 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-grafite-500" aria-hidden />
            <Input className="pl-9" placeholder="Buscar município" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar município (logística)" />
          </div>
          <div className="sm:w-60">
            <Select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Filtrar logística">
              <option value="relevantes">Ativos, com tarifa ou entregador</option>
              <option value="com_logistica">Com logística</option>
              <option value="todos">Todos os 92</option>
            </Select>
          </div>
        </div>
        <ul className="divide-y divide-grafite/5" data-testid="logistics-list">
          {visible.map((r) => (
            <li key={r.municipality_id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-semibold text-grafite">
                  {r.name}
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", r.has_logistics ? "bg-agua-50 text-petroleo" : "bg-nevoa text-grafite-500")}>
                    {r.has_logistics ? "Com logística" : "Sem logística"}
                  </span>
                </p>
                <p className="text-xs text-grafite-500">
                  {r.has_zone
                    ? `${r.zone_active ? "" : "Tarifa desligada · "}${formatBRL(Number(r.base_fee))} + ${formatBRL(Number(r.price_per_km))}/km · mín. ${formatBRL(Number(r.min_fee))}`
                    : "Sem tarifa"}{" "}
                  · {r.couriers_approved} entregador(es) · {r.open_deliveries} corrida(s) esperando
                </p>
              </div>
              <Button variant="outline" className="h-9" onClick={() => open(r)}>
                {r.has_zone ? "Editar tarifa" : "Definir tarifa"}
              </Button>
            </li>
          ))}
          {visible.length === 0 && <li className="px-4 py-6 text-center text-sm text-grafite-500">Nada por aqui. Use a busca ou "Todos os 92".</li>}
        </ul>
      </Card>

      {editing && (
        <Modal open title={`Tarifa de entrega · ${editing.name}`} onClose={() => setEditing(null)}>
          <div className="space-y-4">
            {formError && <Alert>{formError}</Alert>}
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Taxa base (R$)" htmlFor="z-base">
                <Input id="z-base" inputMode="decimal" value={form.base} onChange={(e) => setForm({ ...form, base: e.target.value })} />
              </Field>
              <Field label="Por km (R$)" htmlFor="z-km">
                <Input id="z-km" inputMode="decimal" value={form.perKm} onChange={(e) => setForm({ ...form, perKm: e.target.value })} />
              </Field>
              <Field label="Mínimo (R$)" htmlFor="z-min">
                <Input id="z-min" inputMode="decimal" value={form.min} onChange={(e) => setForm({ ...form, min: e.target.value })} />
              </Field>
              <Field label="Fator de rota" htmlFor="z-factor" hint="Ruas não são linha reta (1,3 = 30% a mais).">
                <Input id="z-factor" inputMode="decimal" value={form.factor} onChange={(e) => setForm({ ...form, factor: e.target.value })} />
              </Field>
              <Field label="Distância máxima (km)" htmlFor="z-max">
                <Input id="z-max" inputMode="decimal" value={form.maxKm} onChange={(e) => setForm({ ...form, maxKm: e.target.value })} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm text-grafite">
              <input type="checkbox" className="h-4 w-4 accent-agua" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              Tarifa ativa (desligue para pausar as entregas neste município)
            </label>
            {example && <p className="text-xs text-grafite-500">{example}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditing(null)}>
                Cancelar
              </Button>
              <Button loading={busy} onClick={() => void save()}>
                Salvar tarifa
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
