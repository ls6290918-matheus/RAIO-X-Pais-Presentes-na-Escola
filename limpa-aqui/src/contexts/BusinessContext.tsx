import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { ADDRESS_COLUMNS, type Address } from "@/lib/maps";
import type { BusinessSegment } from "@/lib/types";

export type Business = Address & {
  id: string;
  name: string;
  slug: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  service_region: string | null;
  opening_hours: Record<string, string> | null;
  logo_path: string | null;
  segment: BusinessSegment | null;
  created_at: string;
};

export type BusinessSettings = {
  business_id: string;
  default_due_days: number;
  timezone: string;
};

export type BusinessRole = "owner" | "staff";

/** Recurso do catálogo + se está ligado nesta lavanderia. */
export type FeatureState = {
  code: string;
  name: string;
  description: string | null;
  route: string | null;
  status: "disponivel" | "em_breve";
  sort: number;
  enabled: boolean;
  source: "regra" | "manual" | null;
};

type BusinessState = {
  business: Business | null;
  settings: BusinessSettings | null;
  role: BusinessRole | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Todos os recursos do catálogo, com o estado nesta lavanderia. */
  features: FeatureState[];
  /** Módulos em destaque para o segmento da lavanderia (na ordem). */
  segmentModules: string[];
  /** false = lavanderia ainda não configurada pelo assistente (usa o painel padrão de antes). */
  configured: boolean;
  /** Recurso ligado? Sem configuração, vale o comportamento antigo: tudo o que já existe fica disponível. */
  hasFeature: (code: string) => boolean;
};

const BusinessContext = createContext<BusinessState | null>(null);

/**
 * Carrega a lavanderia do usuário logado.
 * O id daqui serve só para filtrar consultas na interface;
 * quem garante o acesso é o RLS no banco.
 */
export function BusinessProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [business, setBusiness] = useState<Business | null>(null);
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [role, setRole] = useState<BusinessRole | null>(null);
  const [fetching, setFetching] = useState(true);
  // Evita redirecionar para o onboarding no instante entre o login e o fim da consulta
  const [loadedFor, setLoadedFor] = useState<string | null | undefined>(undefined);
  // Ao recarregar uma lavanderia já exibida (ex.: depois de salvar), não volta para a tela de carregamento
  const loading = (fetching && !business) || loadedFor !== userId;
  const [error, setError] = useState<string | null>(null);
  const [features, setFeatures] = useState<FeatureState[]>([]);
  const [segmentModules, setSegmentModules] = useState<string[]>([]);
  const configured = features.some((f) => f.source !== null);

  const hasFeature = useCallback(
    (code: string) => {
      const f = features.find((x) => x.code === code);
      if (!f) return false;
      return configured ? f.enabled : f.status === "disponivel";
    },
    [features, configured],
  );

  const refresh = useCallback(async () => {
    const finish = () => {
      setLoadedFor(userId);
      setFetching(false);
    };
    if (!userId) {
      setBusiness(null);
      setSettings(null);
      setRole(null);
      finish();
      return;
    }
    setFetching(true);
    setError(null);

    const { data: member, error: mErr } = await supabase
      .from("business_members")
      .select("role, business_id")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (mErr) {
      setError(mErr.message);
      finish();
      return;
    }
    if (!member) {
      setBusiness(null);
      setSettings(null);
      setRole(null);
      setFeatures([]);
      finish();
      return;
    }

    const [{ data: b, error: bErr }, { data: s, error: sErr }, cat, bf] = await Promise.all([
      supabase
        .from("businesses")
        .select(`id, name, slug, phone, whatsapp, email, service_region, opening_hours, logo_path, segment, created_at, ${ADDRESS_COLUMNS}`)
        .eq("id", member.business_id)
        .single(),
      supabase
        .from("business_settings")
        .select("business_id, default_due_days, timezone")
        .eq("business_id", member.business_id)
        .single(),
      supabase.from("features").select("code, name, description, route, status, sort").order("sort"),
      supabase.from("business_features").select("feature_code, enabled, source").eq("business_id", member.business_id),
    ]);

    if (bErr || sErr) setError((bErr ?? sErr)!.message);
    const own = new Map(((bf.data ?? []) as Array<{ feature_code: string; enabled: boolean; source: "regra" | "manual" }>).map((r) => [r.feature_code, r]));
    setFeatures(
      ((cat.data ?? []) as Array<Omit<FeatureState, "enabled" | "source">>).map((f) => ({
        ...f,
        enabled: own.get(f.code)?.enabled ?? false,
        source: own.get(f.code)?.source ?? null,
      })),
    );
    const segment = (b as Business | null)?.segment;
    if (segment) {
      const { data: mods } = await supabase.from("segment_modules").select("feature_code").eq("segment", segment).order("sort");
      setSegmentModules(((mods ?? []) as Array<{ feature_code: string }>).map((m) => m.feature_code));
    } else {
      setSegmentModules([]);
    }
    setBusiness((b as Business) ?? null);
    setSettings((s as BusinessSettings) ?? null);
    setRole(member.role as BusinessRole);
    finish();
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <BusinessContext.Provider value={{ business, settings, role, loading, error, refresh, features, segmentModules, configured, hasFeature }}>
      {children}
    </BusinessContext.Provider>
  );
}

export function useBusiness() {
  const ctx = useContext(BusinessContext);
  if (!ctx) throw new Error("useBusiness precisa estar dentro de BusinessProvider");
  return ctx;
}
