import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Clock, CloudOff, Loader2, Pencil, Plus, Sparkles, X } from "lucide-react";
import { Alert, Button, Card, FullScreenLoader, Input, Logo, Textarea, cn } from "@/components/shared/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useBusiness } from "@/contexts/BusinessContext";
import { formatAddress } from "@/lib/maps";
import {
  BUSINESS_SITUATIONS,
  EQUIPMENT,
  HOME_SITUATIONS,
  OPERATIONS,
  SEGMENT_LABEL,
  SITUATIONS,
  STEP_TITLES,
  TEAMS,
  WEEKLY_ORDERS,
  previewFeatures,
  previewSegment,
} from "./catalog";
import { IdentityStep, addressFromDraft, validateIdentity, type SlugStatus } from "./IdentityStep";
import { useOnboarding, type SaveState, type WizardMode } from "./useOnboarding";

const TOTAL = STEP_TITLES.length;

/* ------------------------------------------------------------ peças visuais */

function ChoiceCard({
  selected,
  onClick,
  children,
  icon,
  multiple,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  icon?: ReactNode;
  multiple?: boolean;
}) {
  return (
    <button
      type="button"
      role={multiple ? "checkbox" : "radio"}
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-2xl border-2 bg-white p-4 text-left transition",
        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-agua/30",
        selected ? "border-agua bg-agua-50/60" : "border-grafite/10 hover:border-grafite/25",
      )}
    >
      {icon && (
        <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", selected ? "bg-agua text-petroleo" : "bg-nevoa text-petroleo")}>
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1">{children}</span>
      <span
        className={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center border-2 transition",
          multiple ? "rounded-md" : "rounded-full",
          selected ? "border-agua bg-agua text-petroleo" : "border-grafite/20",
        )}
        aria-hidden
      >
        {selected && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
      </span>
    </button>
  );
}

function Pills<T extends string | boolean>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ value: T; label: string }>;
  value: T | null;
  onChange: (v: T | null) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2.5 text-sm font-semibold text-petroleo">{label}</legend>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
        {options.map((o) => {
          const on = value === o.value;
          return (
            <button
              key={String(o.value)}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(on ? null : o.value)}
              className={cn(
                "rounded-full border-2 px-4 py-2 text-sm font-medium transition",
                on ? "border-agua bg-agua-50 text-petroleo" : "border-grafite/10 bg-white text-grafite hover:border-grafite/25",
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "idle") return null;
  const map = {
    saving: { icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />, text: "Salvando…", cls: "text-grafite-500" },
    saved: { icon: <CheckCircle2 className="h-3.5 w-3.5" />, text: "Salvo", cls: "text-agua-600" },
    error: { icon: <CloudOff className="h-3.5 w-3.5" />, text: "Não salvou", cls: "text-red-600" },
  }[state];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", map.cls)} role="status" aria-live="polite">
      {map.icon}
      {map.text}
    </span>
  );
}

function StepHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-semibold leading-tight tracking-tight text-petroleo sm:text-[28px]">{title}</h1>
      {subtitle && <p className="mt-2 text-sm text-grafite-500">{subtitle}</p>}
    </div>
  );
}

/* ------------------------------------------------------------ assistente */

export default function OnboardingWizard({ mode }: { mode: WizardMode }) {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { business } = useBusiness();
  const ob = useOnboarding(mode);
  const { answers, setAnswers, setDraft, step, catalog } = ob;

  // Depois da primeira tentativa de avançar, a etapa é revalidada a cada alteração:
  // o aviso some assim que o campo fica certo.
  const [attempted, setAttempted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [customInput, setCustomInput] = useState("");
  const [slugStatus, setSlugStatus] = useState<SlugStatus>("idle");
  const [address, setAddress] = useState<ReturnType<typeof addressFromDraft> | null>(null);
  const addressForm = address ?? addressFromDraft(answers.draft);
  const needsSlug = mode === "criar";
  // Caminho escolhido na entrada (/comecar): "casa" (trabalhar de casa) ou "lavanderia" (lavanderia ou empresa)
  const [params] = useSearchParams();
  const path = params.get("perfil");
  const situations =
    path === "casa" && (!answers.situation || HOME_SITUATIONS.includes(answers.situation))
      ? SITUATIONS.filter((x) => HOME_SITUATIONS.includes(x.value))
      : path === "lavanderia" && (!answers.situation || BUSINESS_SITUATIONS.includes(answers.situation))
        ? SITUATIONS.filter((x) => BUSINESS_SITUATIONS.includes(x.value))
        : SITUATIONS;
  const atHome = answers.situation !== null && HOME_SITUATIONS.includes(answers.situation);

  const segment = previewSegment(answers);
  const featureCodes = useMemo(() => previewFeatures(answers, catalog.rules), [answers, catalog.rules]);
  const firstName = String(user?.user_metadata?.full_name ?? "").split(" ")[0];

  if (ob.loading) return <FullScreenLoader />;

  const errors: Record<string, string> = attempted ? validate(step) : {};
  const shownError = formError ?? (attempted && Object.keys(errors).length ? errors.step ?? "Confira os campos destacados." : null);

  function validate(s: number): Record<string, string> {
    switch (s) {
      case 1:
        return answers.situation ? {} : { step: "Escolha a opção que mais combina com você." };
      case 2:
        return answers.categories.length + answers.custom_categories.length > 0 ? {} : { step: "Escolha pelo menos um serviço." };
      case 3:
        return answers.operations.length > 0 ? {} : { step: "Escolha pelo menos uma opção." };
      case 5:
        return validateIdentity(answers.draft, addressForm, { needsSlug, slugStatus });
      default:
        return {};
    }
  }

  async function next() {
    setFormError(null);
    if (Object.keys(validate(step)).length) {
      setAttempted(true);
      return;
    }
    setBusy(true);
    const err = await ob.goTo(Math.min(step + 1, TOTAL));
    setBusy(false);
    if (err) setFormError(err);
    else setAttempted(false);
  }

  async function back() {
    setAttempted(false);
    setFormError(null);
    setBusy(true);
    await ob.goTo(Math.max(step - 1, 1));
    setBusy(false);
  }

  async function jump(to: number) {
    setAttempted(false);
    setFormError(null);
    await ob.goTo(to);
  }

  async function finish() {
    // confere tudo antes de concluir; leva para a primeira etapa com pendência
    for (const s of [1, 2, 3, 5]) {
      if (Object.keys(validate(s)).length) {
        await ob.goTo(s);
        setAttempted(true);
        return;
      }
    }
    setBusy(true);
    setFormError(null);
    const err = await ob.complete();
    setBusy(false);
    if (err) return setFormError(err);
    navigate("/app", { replace: true, state: { onboarded: true } });
  }

  const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  function addCustom() {
    const v = customInput.trim().replace(/\s+/g, " ");
    if (v.length < 2 || v.length > 60) return setFormError("O nome do serviço precisa ter de 2 a 60 caracteres.");
    if (answers.custom_categories.some((c) => c.toLowerCase() === v.toLowerCase())) return setCustomInput("");
    if (answers.custom_categories.length >= 10) return setFormError("Você pode adicionar até 10 serviços personalizados.");
    setFormError(null);
    setAnswers((a) => ({ custom_categories: [...a.custom_categories, v] }));
    setCustomInput("");
  }

  /* ---------------------------------------------------------- conteúdo de cada etapa */
  let content: ReactNode = null;

  if (step === 1) {
    content = (
      <>
        <StepHeading
          title={`${firstName ? `${firstName}, qual` : "Qual"} é sua situação atualmente?`}
          subtitle="Assim montamos um painel do seu tamanho. Você pode mudar depois."
        />
        <div className="space-y-3" role="radiogroup" aria-label="Sua situação">
          {situations.map(({ value, label, hint, icon: Icon }) => (
            <ChoiceCard
              key={value}
              selected={answers.situation === value}
              onClick={() =>
                setAnswers((a) => ({
                  situation: value,
                  // quem trabalha de casa já começa com "Trabalho em casa" marcado
                  operations: HOME_SITUATIONS.includes(value) && !a.operations.includes("trabalho_em_casa") ? [...a.operations, "trabalho_em_casa"] : a.operations,
                }))
              }
              icon={<Icon className="h-5 w-5" />}
            >
              <span className="block text-[15px] font-semibold text-petroleo">{label}</span>
              <span className="block text-xs text-grafite-500">{hint}</span>
            </ChoiceCard>
          ))}
        </div>
      </>
    );
  }

  if (step === 2) {
    content = (
      <>
        <StepHeading title="Quais serviços você pretende oferecer?" subtitle="Marque quantos quiser. Dá para incluir outros depois." />
        <div className="grid gap-2.5 sm:grid-cols-2" aria-label="Serviços">
          {catalog.categories.map((c) => (
            <ChoiceCard
              key={c.code}
              multiple
              selected={answers.categories.includes(c.code)}
              onClick={() => setAnswers((a) => ({ categories: toggle(a.categories, c.code) }))}
            >
              <span className="text-sm font-medium text-grafite">{c.name}</span>
            </ChoiceCard>
          ))}
        </div>
        <div className="mt-6">
          <label htmlFor="custom" className="text-sm font-semibold text-petroleo">
            Algum serviço que não está na lista?
          </label>
          <div className="mt-2 flex gap-2">
            <Input
              id="custom"
              placeholder="Ex.: Tingimento de tênis"
              value={customInput}
              maxLength={60}
              onChange={(e) => setCustomInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCustom();
                }
              }}
            />
            <Button type="button" variant="outline" onClick={addCustom} aria-label="Adicionar serviço">
              <Plus className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">Adicionar</span>
            </Button>
          </div>
          {answers.custom_categories.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {answers.custom_categories.map((c) => (
                <li key={c} className="inline-flex items-center gap-1.5 rounded-full bg-agua-50 py-1.5 pl-3 pr-1.5 text-sm font-medium text-petroleo">
                  {c}
                  <button
                    type="button"
                    onClick={() => setAnswers((a) => ({ custom_categories: a.custom_categories.filter((x) => x !== c) }))}
                    className="rounded-full p-0.5 hover:bg-white"
                    aria-label={`Remover ${c}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </>
    );
  }

  if (step === 3) {
    content = (
      <>
        <StepHeading title="Como funciona seu atendimento?" subtitle="Marque tudo o que acontece no seu dia a dia." />
        <div className="grid gap-2.5 sm:grid-cols-2">
          {OPERATIONS.map(({ value, label, icon: Icon, exclusiveWith }) => (
            <ChoiceCard
              key={value}
              multiple
              selected={answers.operations.includes(value)}
              icon={<Icon className="h-5 w-5" />}
              onClick={() =>
                setAnswers((a) => {
                  const on = a.operations.includes(value);
                  const list = on ? a.operations.filter((v) => v !== value) : [...a.operations.filter((v) => v !== exclusiveWith), value];
                  return { operations: list };
                })
              }
            >
              <span className="text-sm font-medium text-grafite">{label}</span>
            </ChoiceCard>
          ))}
        </div>
        {atHome && (
          <div className="mt-8 space-y-6 rounded-2xl border border-agua/40 bg-agua-50/40 p-4 sm:p-5" data-testid="work-profile">
            <div>
              <p className="text-sm font-semibold text-petroleo">Seu trabalho de casa</p>
              <p className="text-xs text-grafite-500">Ajuda os clientes a confiar em você. Tudo opcional e editável depois.</p>
            </div>
            <fieldset>
              <legend className="mb-2.5 text-sm font-semibold text-petroleo">Equipamentos que você tem</legend>
              <div className="flex flex-wrap gap-2">
                {EQUIPMENT.map((e) => {
                  const on = (answers.draft.equipment ?? []).includes(e.value);
                  return (
                    <button
                      key={e.value}
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      onClick={() => setDraft({ equipment: toggle(answers.draft.equipment ?? [], e.value) })}
                      className={cn(
                        "rounded-full border-2 px-3.5 py-1.5 text-sm font-medium transition",
                        on ? "border-agua bg-agua-50 text-petroleo" : "border-grafite/10 bg-white text-grafite hover:border-grafite/25",
                      )}
                    >
                      {e.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <div>
              <label htmlFor="capacity" className="text-sm font-semibold text-petroleo">
                Quantos pedidos você consegue atender por dia?
              </label>
              <Input
                id="capacity"
                type="number"
                inputMode="numeric"
                min={1}
                max={1000}
                className="mt-2 w-32"
                value={answers.draft.daily_capacity ?? ""}
                onChange={(e) => {
                  const v = e.target.value === "" ? null : Math.max(1, Math.min(1000, Math.round(Number(e.target.value))));
                  setDraft({ daily_capacity: Number.isFinite(v as number) ? v : null });
                }}
              />
            </div>
            <div>
              <label htmlFor="experience" className="text-sm font-semibold text-petroleo">
                Sua experiência
              </label>
              <Textarea
                id="experience"
                className="mt-2"
                rows={3}
                maxLength={300}
                placeholder="Ex.: Lavo tênis há 3 anos, com cuidado com camurça e tecidos delicados."
                value={answers.draft.experience ?? ""}
                onChange={(e) => setDraft({ experience: e.target.value })}
              />
            </div>
          </div>
        )}
      </>
    );
  }

  if (step === 4) {
    content = (
      <>
        <StepHeading title="Como está seu negócio hoje?" subtitle="Todas as perguntas são opcionais. Se preferir, pule esta etapa." />
        <div className="space-y-7">
          <Pills
            label="Você já possui clientes?"
            options={[
              { value: true, label: "Sim" },
              { value: false, label: "Ainda não" },
            ]}
            value={answers.has_clients}
            onChange={(v) => setAnswers({ has_clients: v })}
          />
          <Pills label="Quantos pedidos recebe por semana?" options={WEEKLY_ORDERS} value={answers.weekly_orders} onChange={(v) => setAnswers({ weekly_orders: v })} />
          <Pills label="Trabalha sozinho ou tem equipe?" options={TEAMS} value={answers.team} onChange={(v) => setAnswers({ team: v })} />
          <Pills
            label="Já tem preços definidos?"
            options={[
              { value: true, label: "Sim" },
              { value: false, label: "Ainda não" },
            ]}
            value={answers.has_prices}
            onChange={(v) => setAnswers({ has_prices: v })}
          />
          <div>
            <label htmlFor="region4" className="text-sm font-semibold text-petroleo">
              Qual cidade e região você atende?
            </label>
            <Input
              id="region4"
              className="mt-2.5"
              placeholder="Ex.: Campinas, região central"
              maxLength={160}
              value={answers.service_region}
              onChange={(e) => setAnswers((a) => ({ service_region: e.target.value, draft: { ...a.draft, service_region: e.target.value } }))}
            />
          </div>
        </div>
      </>
    );
  }

  if (step === 5) {
    content = (
      <>
        <StepHeading title="Agora, a identidade do seu negócio" subtitle="É assim que seus clientes vão te encontrar." />
        <IdentityStep
          draft={answers.draft}
          setDraft={(p) => {
            setDraft(p);
            if (p.service_region !== undefined) setAnswers({ service_region: p.service_region });
          }}
          address={addressForm}
          setAddress={setAddress}
          needsSlug={needsSlug}
          slugStatus={slugStatus}
          setSlugStatus={setSlugStatus}
          errors={errors}
        />
      </>
    );
  }

  if (step === 6) {
    const enabled = catalog.features.filter((f) => featureCodes.has(f.code));
    const ready = enabled.filter((f) => f.status === "disponivel");
    const soon = enabled.filter((f) => f.status === "em_breve");
    const catNames = [
      ...catalog.categories.filter((c) => answers.categories.includes(c.code)).map((c) => c.name),
      ...answers.custom_categories,
    ];
    const d = answers.draft;
    const Row = ({ label, value, to }: { label: string; value: ReactNode; to: number }) => (
      <div className="flex items-start justify-between gap-3 py-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-grafite-500">{label}</p>
          <div className="mt-0.5 text-sm text-grafite">{value}</div>
        </div>
        <button type="button" onClick={() => void jump(to)} className="shrink-0 rounded-lg p-1.5 text-grafite-500 hover:bg-nevoa" aria-label={`Alterar ${label}`}>
          <Pencil className="h-4 w-4" />
        </button>
      </div>
    );
    content = (
      <>
        <StepHeading title="Tudo pronto para montar seu painel" subtitle="Confira o resumo. Você pode alterar qualquer resposta." />
        {segment && (
          <div className="mb-5 rounded-2xl bg-petroleo p-5 text-white">
            <p className="text-xs font-semibold uppercase tracking-wide text-agua">Seu painel</p>
            <p className="mt-1 text-xl font-semibold">{SEGMENT_LABEL[segment].title}</p>
            <p className="mt-1 text-sm text-white/75">{SEGMENT_LABEL[segment].text}</p>
          </div>
        )}
        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-sm font-semibold text-petroleo">Vamos ativar</p>
            <ul className="space-y-2">
              {ready.map((f) => (
                <li key={f.code} className="flex items-start gap-2 text-sm text-grafite">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-agua-600" aria-hidden />
                  <span>
                    <span className="font-medium">{f.name}</span>
                    {f.description && <span className="text-grafite-500"> — {f.description}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          {soon.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-semibold text-petroleo">Já reservado para você (em breve)</p>
              <ul className="space-y-2">
                {soon.map((f) => (
                  <li key={f.code} className="flex items-start gap-2 text-sm text-grafite-500">
                    <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <span>{f.name}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="mt-6 divide-y divide-grafite/5 rounded-2xl border border-grafite/10 px-4">
          <Row label="Situação" value={SITUATIONS.find((s) => s.value === answers.situation)?.label ?? "—"} to={1} />
          <Row label="Serviços" value={catNames.join(", ") || "—"} to={2} />
          <Row label="Atendimento" value={OPERATIONS.filter((o) => answers.operations.includes(o.value)).map((o) => o.label).join(", ") || "—"} to={3} />
          <Row
            label="Negócio"
            value={
              <>
                {d.name || "—"}
                <span className="block text-xs text-grafite-500">
                  {[d.whatsapp, d.email, formatAddress({ street: d.street, street_number: d.street_number, neighborhood: d.neighborhood, city: d.city, state: d.state })]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </>
            }
            to={5}
          />
        </div>
      </>
    );
  }

  /* ---------------------------------------------------------- layout */
  return (
    <div className="min-h-screen bg-nevoa">
      <header className="sticky top-0 z-20 border-b border-grafite/5 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4">
          <Logo />
          <div className="flex items-center gap-4">
            <SaveIndicator state={ob.saveState} />
            {mode === "personalizar" ? (
              <Link to="/app" className="text-sm text-grafite-500 hover:text-petroleo">
                Fechar
              </Link>
            ) : (
              <button onClick={() => void signOut()} className="text-sm text-grafite-500 hover:text-petroleo">
                Sair
              </button>
            )}
          </div>
        </div>
        <div className="mx-auto max-w-2xl px-4 pb-3">
          <div className="flex items-center justify-between text-xs font-medium text-grafite-500">
            <span>
              Etapa {step} de {TOTAL} · {STEP_TITLES[step - 1]}
            </span>
            <span>{Math.round((step / TOTAL) * 100)}%</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-nevoa" role="progressbar" aria-valuemin={1} aria-valuemax={TOTAL} aria-valuenow={step}>
            <div className="h-full rounded-full bg-agua transition-all duration-500" style={{ width: `${(step / TOTAL) * 100}%` }} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 pb-32 pt-6 sm:pt-10">
        {mode === "personalizar" && step === 1 && business && (
          <p className="mb-4 flex items-center gap-2 text-sm text-grafite-500">
            <Sparkles className="h-4 w-4 text-agua-600" aria-hidden /> Personalizando o painel da {business.name}
          </p>
        )}
        {ob.loadError ? (
          <Alert>{ob.loadError}</Alert>
        ) : (
          <Card className="p-5 sm:p-8">
            {shownError && (
              <div className="mb-5">
                <Alert>{shownError}</Alert>
              </div>
            )}
            {content}
          </Card>
        )}
      </main>

      <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-grafite/5 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          {step > 1 ? (
            <Button variant="ghost" onClick={() => void back()} disabled={busy}>
              <ArrowLeft className="h-4 w-4" aria-hidden /> Voltar
            </Button>
          ) : (
            <span />
          )}
          <div className="ml-auto flex items-center gap-2">
            {step === 4 && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void next()}
              >
                Pular
              </Button>
            )}
            {step < TOTAL ? (
              <Button onClick={() => void next()} loading={busy}>
                Avançar <ArrowRight className="h-4 w-4" aria-hidden />
              </Button>
            ) : (
              <Button onClick={() => void finish()} loading={busy}>
                {mode === "criar" ? "Criar meu painel" : "Aplicar no meu painel"}
              </Button>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
