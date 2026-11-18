import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { ADDRESS_COLUMNS, type Address } from "@/lib/maps";

export type Business = Address & {
  id: string;
  name: string;
  slug: string;
  phone: string | null;
  whatsapp: string | null;
  created_at: string;
};

export type BusinessSettings = {
  business_id: string;
  default_due_days: number;
  timezone: string;
};

export type BusinessRole = "owner" | "staff";

type BusinessState = {
  business: Business | null;
  settings: BusinessSettings | null;
  role: BusinessRole | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
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
      finish();
      return;
    }

    const [{ data: b, error: bErr }, { data: s, error: sErr }] = await Promise.all([
      supabase
        .from("businesses")
        .select(`id, name, slug, phone, whatsapp, created_at, ${ADDRESS_COLUMNS}`)
        .eq("id", member.business_id)
        .single(),
      supabase
        .from("business_settings")
        .select("business_id, default_due_days, timezone")
        .eq("business_id", member.business_id)
        .single(),
    ]);

    if (bErr || sErr) setError((bErr ?? sErr)!.message);
    setBusiness((b as Business) ?? null);
    setSettings((s as BusinessSettings) ?? null);
    setRole(member.role as BusinessRole);
    finish();
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <BusinessContext.Provider value={{ business, settings, role, loading, error, refresh }}>
      {children}
    </BusinessContext.Provider>
  );
}

export function useBusiness() {
  const ctx = useContext(BusinessContext);
  if (!ctx) throw new Error("useBusiness precisa estar dentro de BusinessProvider");
  return ctx;
}
