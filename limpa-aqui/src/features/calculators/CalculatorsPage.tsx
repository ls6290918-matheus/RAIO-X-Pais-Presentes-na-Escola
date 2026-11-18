import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Calculator, Clock, Info, Sparkles } from "lucide-react";
import { Alert, Button, Card, EmptyState, Field, InlineLoader, Input, PageHeader, Select, buttonClass, cn } from "@/components/shared/ui";
import { useBusiness } from "@/contexts/BusinessContext";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { formatBRL, moneyInput, parseMoney } from "@/lib/format";
import { priceLabel, unitShort } from "@/lib/pricing";
import type { Service } from "@/lib/types";
import { SERVICE_COLUMNS } from "@/features/services/ServicesPage";
import { hourValue, marginOf, serviceCost } from "./calc";

type Costs = {
  service_id: string;
  products: number;
  water: number;
  energy: number;
  packaging: number;
  other: number;
  minutes: number;
  margin_pct: number;
  card_fee_pct: number;
};

/** Campo vazio vale 0; texto inválido vira NaN (e o campo fica vermelho). */
const num = (v: string) => (v.trim() === "" ? 0 : parseMoney(v));
const show = (v: number | null | undefined) => (v == null ? "" : moneyInput(v).replace(/,00$/, ""));

function Row({ label, value, strong, hint }: { label: string; value: ReactNode; strong?: boolean; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <span className={cn("text-sm", strong ? "font-semibold text-petroleo" : "text-grafite-500")}>
        {label}
        {hint && <span className="block text-xs font-normal text-grafite-500">{hint}</span>}
      </span>
      <span className={cn("shrink-0 text-right", strong ? "text-lg font-semibold text-petroleo" : "text-sm text-grafite")}>{value}</span>
    </div>
  );
}

/* ------------------------------------------------------------ Quanto vale a sua hora */
function HourCard({ hourly, setHourly }: { hourly: string; setHourly: (v: string) => void }) {
  const { business, settings, role, refresh } = useBusiness();
  const isOwner = role === "owner";
  const [f, setF] = useState({
    income: show(settings?.income_goal),
    fixed: show(settings?.fixed_costs),
    hours: settings?.work_hours_day ? String(settings.work_hours_day).replace(".", ",") : "8",
    days: settings?.work_days_month ? String(settings.work_days_month) : "22",
  });
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const vals = { incomeGoal: num(f.income), fixedCosts: num(f.fixed), hoursPerDay: num(f.hours), daysPerMonth: Number(f.days) };
  const invalid = {
    income: Number.isNaN(vals.incomeGoal),
    fixed: Number.isNaN(vals.fixedCosts),
    hours: Number.isNaN(vals.hoursPerDay) || vals.hoursPerDay <= 0 || vals.hoursPerDay > 24,
    days: !Number.isInteger(vals.daysPerMonth) || vals.daysPerMonth < 1 || vals.daysPerMonth > 31,
  };
  const result = Object.values(invalid).some(Boolean) ? null : hourValue(vals);

  async function save() {
    if (!business || result == null) return;
    setSaving(true);
    setMsg(null);
    const { error } = await supabase
      .from("business_settings")
      .update({
        income_goal: vals.incomeGoal,
        fixed_costs: vals.fixedCosts,
        work_hours_day: vals.hoursPerDay,
        work_days_month: vals.daysPerMonth,
        hourly_rate: result,
      })
      .eq("business_id", business.id);
    setSaving(false);
    if (error) return setMsg({ kind: "error", text: friendlyError(error) });
    setHourly(moneyInput(result));
    await refresh();
    setMsg({ kind: "success", text: "Valor da hora salvo. Ele já entra no cálculo dos serviços." });
  }

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  return (
    <Card className="p-6">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-agua-50 text-petroleo">
          <Clock className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <h2 className="text-base font-semibold text-petroleo">Quanto vale a sua hora</h2>
          <p className="text-sm text-grafite-500">Base para cobrar pelo seu tempo de trabalho em cada serviço.</p>
        </div>
      </div>
      {msg && (
        <div className="mt-4">
          <Alert kind={msg.kind}>{msg.text}</Alert>
        </div>
      )}
      <fieldset disabled={!isOwner || saving} className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label="Quanto você quer tirar por mês (R$)" htmlFor="h-income" error={invalid.income ? "Valor inválido." : undefined}>
          <Input id="h-income" inputMode="decimal" placeholder="Ex.: 3.000" value={f.income} onChange={set("income")} invalid={invalid.income} />
        </Field>
        <Field
          label="Custos fixos do mês (R$)"
          htmlFor="h-fixed"
          hint="Aluguel, internet, MEI, celular… o que você paga mesmo sem atender."
          error={invalid.fixed ? "Valor inválido." : undefined}
        >
          <Input id="h-fixed" inputMode="decimal" placeholder="Ex.: 800" value={f.fixed} onChange={set("fixed")} invalid={invalid.fixed} />
        </Field>
        <Field label="Horas de trabalho por dia" htmlFor="h-hours" error={invalid.hours ? "De 1 a 24." : undefined}>
          <Input id="h-hours" inputMode="decimal" value={f.hours} onChange={set("hours")} invalid={invalid.hours} />
        </Field>
        <Field label="Dias de trabalho por mês" htmlFor="h-days" error={invalid.days ? "De 1 a 31." : undefined}>
          <Input id="h-days" inputMode="numeric" value={f.days} onChange={set("days")} invalid={invalid.days} />
        </Field>
      </fieldset>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-nevoa px-4 py-3">
        <p className="text-sm text-grafite">
          Sua hora vale <strong className="text-lg text-petroleo">{result == null ? "—" : formatBRL(result)}</strong>
          {result != null && (
            <span className="block text-xs text-grafite-500">
              ({formatBRL(vals.incomeGoal)} + {formatBRL(vals.fixedCosts)}) ÷ {vals.hoursPerDay * vals.daysPerMonth} horas no mês
            </span>
          )}
        </p>
        {isOwner && (
          <Button onClick={() => void save()} loading={saving} disabled={result == null}>
            Salvar valor da hora
          </Button>
        )}
      </div>
      {hourly && result != null && moneyInput(result) !== hourly && (
        <p className="mt-2 text-xs text-grafite-500">O cálculo dos serviços está usando {formatBRL(num(hourly))} por hora até você salvar.</p>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------ Custo e preço do serviço */
export default function CalculatorsPage() {
  const { business, settings, role } = useBusiness();
  const isOwner = role === "owner";
  const [services, setServices] = useState<Service[] | null>(null);
  const [costs, setCosts] = useState<Map<string, Costs>>(new Map());
  const [serviceId, setServiceId] = useState("");
  const [hourly, setHourly] = useState(settings?.hourly_rate != null ? moneyInput(settings.hourly_rate) : "");
  const [f, setF] = useState({ products: "", water: "", energy: "", packaging: "", other: "", minutes: "", margin: "30", fee: "0" });
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!business) return;
    void Promise.all([
      supabase.from("services").select(SERVICE_COLUMNS).eq("business_id", business.id).order("name"),
      supabase.from("service_costs").select("service_id, products, water, energy, packaging, other, minutes, margin_pct, card_fee_pct").eq("business_id", business.id),
    ]).then(([s, c]) => {
      const list = (s.data as Service[]) ?? [];
      setServices(list);
      setCosts(new Map(((c.data as Costs[]) ?? []).map((x) => [x.service_id, x])));
      if (list.length) setServiceId((cur) => cur || list[0].id);
    });
  }, [business]);

  // Ao trocar de serviço, carrega os custos guardados dele (ou começa em branco)
  useEffect(() => {
    const c = costs.get(serviceId);
    setMsg(null);
    setF({
      products: show(c?.products),
      water: show(c?.water),
      energy: show(c?.energy),
      packaging: show(c?.packaging),
      other: show(c?.other),
      minutes: c?.minutes ? String(c.minutes) : "",
      margin: c ? String(c.margin_pct).replace(".", ",") : "30",
      fee: c ? String(c.card_fee_pct).replace(".", ",") : "0",
    });
  }, [serviceId, costs]);

  const service = services?.find((s) => s.id === serviceId);
  const v = {
    products: num(f.products),
    water: num(f.water),
    energy: num(f.energy),
    packaging: num(f.packaging),
    other: num(f.other),
    minutes: f.minutes.trim() === "" ? 0 : Number(f.minutes),
    hourly: num(hourly),
    marginPct: num(f.margin),
    cardFeePct: num(f.fee),
  };
  const bad = {
    products: Number.isNaN(v.products),
    water: Number.isNaN(v.water),
    energy: Number.isNaN(v.energy),
    packaging: Number.isNaN(v.packaging),
    other: Number.isNaN(v.other),
    minutes: !Number.isInteger(v.minutes) || v.minutes < 0 || v.minutes > 1440,
    hourly: Number.isNaN(v.hourly),
    margin: Number.isNaN(v.marginPct) || v.marginPct < 0 || v.marginPct > 90,
    fee: Number.isNaN(v.cardFeePct) || v.cardFeePct < 0 || v.cardFeePct > 30 || v.marginPct + v.cardFeePct >= 95,
  };
  const valid = !Object.values(bad).some(Boolean);
  const r = useMemo(() => (valid ? serviceCost(v) : null), [valid, JSON.stringify(v)]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = service && r ? marginOf(Number(service.price), r.total, v.cardFeePct) : null;
  const unit = service ? unitShort(service.pricing_unit) : "unidade";

  async function saveCosts(): Promise<boolean> {
    if (!business || !service || !valid) return false;
    const values = {
      products: v.products,
      water: v.water,
      energy: v.energy,
      packaging: v.packaging,
      other: v.other,
      minutes: v.minutes,
      margin_pct: v.marginPct,
      card_fee_pct: v.cardFeePct,
    };
    const { error } = costs.has(service.id)
      ? await supabase.from("service_costs").update(values).eq("service_id", service.id)
      : await supabase.from("service_costs").insert({ ...values, service_id: service.id, business_id: business.id });
    if (error) {
      setMsg({ kind: "error", text: friendlyError(error) });
      return false;
    }
    setCosts((m) => new Map(m).set(service.id, { service_id: service.id, ...values }));
    return true;
  }

  async function onSave() {
    setBusy("save");
    setMsg(null);
    if (await saveCosts()) setMsg({ kind: "success", text: "Custos salvos." });
    setBusy(null);
  }

  async function usePrice(price: number) {
    if (!service) return;
    if (!window.confirm(`Mudar o preço de "${service.name}" de ${formatBRL(service.price)} para ${formatBRL(price)}? Pedidos já criados não mudam.`)) return;
    setBusy(`price-${price}`);
    setMsg(null);
    if (await saveCosts()) {
      const { error } = await supabase.from("services").update({ price }).eq("id", service.id);
      if (error) setMsg({ kind: "error", text: friendlyError(error) });
      else {
        setServices((list) => list?.map((s) => (s.id === service.id ? { ...s, price } : s)) ?? null);
        setMsg({ kind: "success", text: `Preço de "${service.name}" atualizado para ${formatBRL(price)} por ${unit}.` });
      }
    }
    setBusy(null);
  }

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const money = (k: keyof typeof f, label: string, hint?: string, placeholder = "0,00") => (
    <Field label={label} htmlFor={`c-${k}`} hint={hint} error={bad[k as keyof typeof bad] ? "Valor inválido." : undefined}>
      <Input id={`c-${k}`} inputMode="decimal" placeholder={placeholder} value={f[k]} onChange={set(k)} invalid={bad[k as keyof typeof bad]} />
    </Field>
  );

  if (services === null) return <InlineLoader />;

  return (
    <div className="space-y-6">
      <PageHeader title="Calculadoras" description="Descubra quanto custa cada serviço e qual preço cobre seus custos." />

      <div className="flex items-start gap-2.5 rounded-xl bg-white px-4 py-3 text-sm text-grafite-500 shadow-card">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-petroleo" aria-hidden />
        <p>
          Os resultados são <strong className="text-grafite">estimativas</strong> feitas só com os números que você informa. Eles ajudam a decidir o
          preço, mas não garantem lucro: confira seus gastos de verdade de tempos em tempos.
        </p>
      </div>

      {!isOwner && <Alert>Você pode consultar as calculadoras, mas só o dono da lavanderia salva valores e muda preços.</Alert>}

      <HourCard hourly={hourly} setHourly={setHourly} />

      <Card className="p-6">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-agua-50 text-petroleo">
            <Calculator className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h2 className="text-base font-semibold text-petroleo">Custo e preço de um serviço</h2>
            <p className="text-sm text-grafite-500">Informe quanto você gasta para fazer o serviço uma vez (por {unit}).</p>
          </div>
        </div>

        {services.length === 0 ? (
          <EmptyState
            icon={<Sparkles className="h-6 w-6" />}
            title="Cadastre um serviço primeiro"
            description="A calculadora trabalha em cima dos seus serviços."
            action={
              isOwner && (
                <Link to="/app/servicos" className={buttonClass()}>
                  Cadastrar serviços
                </Link>
              )
            }
          />
        ) : (
          <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_340px] lg:items-start">
            <fieldset disabled={!isOwner || !!busy} className="space-y-5">
              <Field label="Serviço" htmlFor="c-service">
                <Select id="c-service" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} — {priceLabel(s.price, s.pricing_unit)}
                      {costs.has(s.id) ? " ✓" : ""}
                    </option>
                  ))}
                </Select>
              </Field>
              <div>
                <p className="mb-3 text-sm font-semibold text-grafite">Materiais (R$)</p>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  {money("products", "Produtos", "Sabão, escova, tinta…")}
                  {money("water", "Água", "Conta ÷ nº de serviços")}
                  {money("energy", "Energia", "Máquina, secadora…")}
                  {money("packaging", "Embalagem", "Saco, etiqueta…")}
                  {money("other", "Outros")}
                </div>
              </div>
              <div>
                <p className="mb-3 text-sm font-semibold text-grafite">Seu tempo</p>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Minutos de trabalho" htmlFor="c-minutes" error={bad.minutes ? "De 0 a 1440." : undefined}>
                    <Input id="c-minutes" inputMode="numeric" placeholder="Ex.: 40" value={f.minutes} onChange={set("minutes")} invalid={bad.minutes} />
                  </Field>
                  <Field
                    label="Valor da hora (R$)"
                    htmlFor="c-hourly"
                    hint={settings?.hourly_rate == null ? "Calcule no quadro acima." : undefined}
                    error={bad.hourly ? "Valor inválido." : undefined}
                  >
                    <Input id="c-hourly" inputMode="decimal" placeholder="0,00" value={hourly} onChange={(e) => setHourly(e.target.value)} invalid={bad.hourly} />
                  </Field>
                </div>
              </div>
              <div>
                <p className="mb-3 text-sm font-semibold text-grafite">Preço</p>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Margem desejada (%)" htmlFor="c-margin" hint="Quanto do preço sobra depois dos custos." error={bad.margin ? "De 0 a 90%." : undefined}>
                    <Input id="c-margin" inputMode="decimal" value={f.margin} onChange={set("margin")} invalid={bad.margin} />
                  </Field>
                  <Field
                    label="Taxa da maquininha (%)"
                    htmlFor="c-fee"
                    hint="0 se recebe em dinheiro ou Pix."
                    error={bad.fee ? (v.marginPct + v.cardFeePct >= 95 ? "Margem + taxa precisa ficar abaixo de 95%." : "De 0 a 30%.") : undefined}
                  >
                    <Input id="c-fee" inputMode="decimal" value={f.fee} onChange={set("fee")} invalid={bad.fee} />
                  </Field>
                </div>
              </div>
            </fieldset>

            <div className="space-y-4 lg:sticky lg:top-24">
              {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
              <div className="rounded-2xl border border-grafite/10 p-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-grafite-500">Resultado por {unit}</p>
                {r ? (
                  <>
                    <div className="mt-2 divide-y divide-grafite/5">
                      <Row label="Materiais" value={formatBRL(r.materials)} />
                      <Row label="Seu tempo" hint={`${v.minutes} min × ${formatBRL(v.hourly)}/h`} value={formatBRL(r.labor)} />
                      <Row label="Custo total" value={formatBRL(r.total)} strong />
                    </div>
                    {r.suggested != null ? (
                      <div className="mt-3 rounded-xl bg-petroleo p-4 text-white">
                        <p className="text-xs text-white/70">Preço sugerido com {v.marginPct}% de margem{v.cardFeePct ? ` e ${v.cardFeePct}% de taxa` : ""}</p>
                        <p className="mt-1 text-2xl font-semibold">{formatBRL(r.suggested)}</p>
                        <p className="text-xs text-white/70">Arredondado: {formatBRL(r.rounded!)}</p>
                      </div>
                    ) : (
                      <p className="mt-3 text-sm text-grafite-500">Preencha os custos ou o tempo para ver o preço sugerido.</p>
                    )}
                    {service && (
                      <div className="mt-3 text-sm">
                        <p className="text-grafite-500">
                          Preço atual: <strong className="text-grafite">{priceLabel(service.price, service.pricing_unit)}</strong>
                        </p>
                        {current && r.total > 0 && (
                          <p className={cn("mt-0.5 font-medium", current.left < 0 ? "text-red-600" : current.pct < v.marginPct ? "text-amber-700" : "text-agua-600")}>
                            {current.left < 0
                              ? `Abaixo do custo: falta ${formatBRL(-current.left)} por ${unit}.`
                              : `Sobra ${formatBRL(current.left)} por ${unit} (${current.pct.toLocaleString("pt-BR")}% do preço).`}
                          </p>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="mt-2 text-sm text-red-600">Corrija os campos destacados.</p>
                )}
              </div>
              {isOwner && service && r && (
                <div className="flex flex-col gap-2">
                  {r.rounded != null && Math.abs(r.rounded - Number(service.price)) > 0.004 && (
                    <Button onClick={() => void usePrice(r.rounded!)} loading={busy === `price-${r.rounded}`} disabled={!!busy}>
                      Usar {formatBRL(r.rounded)} como preço
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => void onSave()} loading={busy === "save"} disabled={!!busy}>
                    Salvar custos
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
