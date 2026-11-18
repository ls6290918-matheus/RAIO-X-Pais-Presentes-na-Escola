import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { useBusiness } from "@/contexts/BusinessContext";
import { friendlyError } from "@/lib/errors";

export type UserRole = "anunciante" | "prestador" | "entregador" | "admin";
export type RoleStatus = "ativo" | "pendente" | "suspenso";
export type RoleRow = { role: UserRole; status: RoleStatus };

type RolesState = {
  roles: RoleRow[];
  loading: boolean;
  refresh: () => Promise<void>;
  /** Perfil ativo (aprovado e não suspenso). */
  hasRole: (role: UserRole) => boolean;
  /** Situação do perfil na conta, ou null se a conta não tem esse perfil. */
  statusOf: (role: UserRole) => RoleStatus | null;
  /** Acrescenta um perfil à própria conta (entregador fica aguardando aprovação). */
  addRole: (role: Exclude<UserRole, "admin">) => Promise<string | null>;
};

const RolesContext = createContext<RolesState | null>(null);

/** Perfis da conta logada (anunciante, prestador, entregador, admin), lidos de user_roles. */
export function RolesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const { business } = useBusiness();
  const businessId = business?.id ?? null;
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!userId) {
      setRoles([]);
      setLoadedFor(null);
      return;
    }
    const { data } = await supabase.from("user_roles").select("role, status").eq("user_id", userId);
    setRoles((data as RoleRow[] | null) ?? []);
    setLoadedFor(userId);
  }, [userId]);

  // Recarrega também quando a lavanderia muda: entrar numa lavanderia dá o perfil de prestador
  useEffect(() => {
    void refresh();
  }, [refresh, businessId]);

  const statusOf = (role: UserRole) => roles.find((r) => r.role === role)?.status ?? null;
  const hasRole = (role: UserRole) => statusOf(role) === "ativo";

  const addRole = async (role: Exclude<UserRole, "admin">) => {
    const { error } = await supabase.rpc("add_my_role", { p_role: role });
    if (error) return friendlyError(error);
    await refresh();
    return null;
  };

  return (
    <RolesContext.Provider value={{ roles, loading: !!userId && loadedFor !== userId, refresh, hasRole, statusOf, addRole }}>
      {children}
    </RolesContext.Provider>
  );
}

export function useRoles() {
  const ctx = useContext(RolesContext);
  if (!ctx) throw new Error("useRoles precisa estar dentro de RolesProvider");
  return ctx;
}

export const ROLE_LABEL: Record<UserRole, string> = {
  anunciante: "Contratar serviços",
  prestador: "Oferecer serviços",
  entregador: "Fazer entregas",
  admin: "Administração",
};
