import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useBusiness, type Business } from "@/contexts/BusinessContext";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { maskPhone } from "@/lib/format";
import {
  type Answers,
  type CatalogCategory,
  type CatalogFeature,
  type CatalogRule,
  type Draft,
  emptyAnswers,
} from "./catalog";

export type SaveState = "idle" | "saving" | "saved" | "error";
export type WizardMode = "criar" | "personalizar";

type ProfileRow = Omit<Answers, "service_region" | "draft"> & {
  service_region: string | null;
  draft: Draft | null;
  current_step: number;
  completed_at: string | null;
};

/** Rascunho da identidade a partir da lavanderia que já existe (modo "Personalizar"). */
function draftFromBusiness(b: Business): Draft {
  return {
    name: b.name,
    whatsapp: maskPhone(b.whatsapp ?? ""),
    email: b.email ?? "",
    city: b.city ?? "",
    state: b.state ?? "",
    neighborhood: b.neighborhood ?? "",
    street: b.street ?? "",
    street_number: b.street_number ?? "",
    complement: b.complement ?? "",
    postal_code: b.postal_code ?? "",
    lat: b.lat,
    lng: b.lng,
    place_id: b.place_id,
    service_region: b.service_region ?? "",
    opening_hours: (b.opening_hours as Draft["opening_hours"]) ?? undefined,
    logo_path: b.logo_path,
  };
}

/** Só as chaves que o servidor aceita (save_onboarding_step ignora o resto). */
function payload(a: Answers) {
  return {
    situation: a.situation,
    categories: a.categories,
    custom_categories: a.custom_categories,
    operations: a.operations,
    has_clients: a.has_clients,
    weekly_orders: a.weekly_orders,
    team: a.team,
    has_prices: a.has_prices,
    service_region: a.service_region,
    draft: a.draft,
  };
}

export function useOnboarding(mode: WizardMode) {
  const { user } = useAuth();
  const { business, refresh } = useBusiness();
  const [answers, setAnswersState] = useState<Answers>(emptyAnswers);
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [catalog, setCatalog] = useState<{ categories: CatalogCategory[]; features: CatalogFeature[]; rules: CatalogRule[] }>({
    categories: [],
    features: [],
    rules: [],
  });

  const dirty = useRef(false);
  const stepRef = useRef(1);
  const answersRef = useRef(answers);
  answersRef.current = answers;
  stepRef.current = step;

  /* ---------------------------------------------------------- carregar */
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const [profile, cats, feats, rules] = await Promise.all([
        supabase.from("onboarding_profiles").select("*").eq("user_id", user.id).maybeSingle(),
        supabase.from("service_categories").select("code, name, group_code, sort").order("sort"),
        supabase.from("features").select("code, name, description, status, sort").order("sort"),
        supabase.from("feature_rules").select("trigger_type, trigger_value, feature_code"),
      ]);
      if (cancelled) return;
      const err = profile.error ?? cats.error ?? feats.error ?? rules.error;
      if (err) {
        setLoadError(friendlyError(err));
        setLoading(false);
        return;
      }
      setCatalog({
        categories: (cats.data as CatalogCategory[]) ?? [],
        features: (feats.data as CatalogFeature[]) ?? [],
        rules: (rules.data as CatalogRule[]) ?? [],
      });

      const p = profile.data as ProfileRow | null;
      const base = emptyAnswers();
      const restored: Answers = p
        ? {
            situation: p.situation,
            categories: p.categories ?? [],
            custom_categories: p.custom_categories ?? [],
            operations: p.operations ?? [],
            has_clients: p.has_clients,
            weekly_orders: p.weekly_orders,
            team: p.team,
            has_prices: p.has_prices,
            service_region: p.service_region ?? "",
            draft: p.draft ?? {},
          }
        : base;

      // Personalizar: a identidade vem da lavanderia (o que está salvo nela é a verdade)
      if (mode === "personalizar" && business) {
        restored.draft = { ...draftFromBusiness(business), ...(p?.completed_at ? {} : restored.draft) };
        restored.service_region = restored.service_region || business.service_region || "";
      }

      setAnswersState(restored);
      // Retoma na etapa salva; quem já concluiu e voltou para personalizar começa do início para revisar
      setStep(p && !p.completed_at ? Math.min(Math.max(p.current_step, 1), 6) : 1);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, mode]);

  /* ---------------------------------------------------------- salvar */
  const save = useCallback(async (toStep: number) => {
    setSaveState("saving");
    const { error } = await supabase.rpc("save_onboarding_step", { p_step: toStep, p_data: payload(answersRef.current) });
    if (error) {
      setSaveState("error");
      return friendlyError(error);
    }
    dirty.current = false;
    setSaveState("saved");
    return null;
  }, []);

  // Salvamento automático: 1 segundo depois da última alteração
  useEffect(() => {
    if (loading || !dirty.current) return;
    const t = setTimeout(() => void save(stepRef.current), 1000);
    return () => clearTimeout(t);
  }, [answers, loading, save]);

  // Ao sair da página com alteração pendente, avisa o navegador
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (dirty.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, []);

  const setAnswers = useCallback((patch: Partial<Answers> | ((a: Answers) => Partial<Answers>)) => {
    dirty.current = true;
    setAnswersState((a) => ({ ...a, ...(typeof patch === "function" ? patch(a) : patch) }));
  }, []);

  const setDraft = useCallback(
    (patch: Partial<Draft>) => setAnswers((a) => ({ draft: { ...a.draft, ...patch } })),
    [setAnswers],
  );

  /** Vai para outra etapa salvando as respostas (sempre grava a etapa de destino). */
  const goTo = useCallback(
    async (next: number) => {
      const err = await save(next);
      if (err) return err;
      setStep(next);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return null;
    },
    [save],
  );

  /** Conclui: cria/atualiza a lavanderia e aplica as regras no servidor. */
  const complete = useCallback(async () => {
    const err = await save(6);
    if (err) return err;
    const { error } = await supabase.rpc("complete_onboarding");
    if (error) return friendlyError(error);
    await refresh();
    return null;
  }, [save, refresh]);

  return { loading, loadError, answers, setAnswers, setDraft, step, goTo, complete, saveState, catalog };
}
