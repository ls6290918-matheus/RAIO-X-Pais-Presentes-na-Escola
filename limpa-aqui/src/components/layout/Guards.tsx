import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useBusiness } from "@/contexts/BusinessContext";
import { FullScreenLoader } from "@/components/shared/ui";

/** Exige sessão. Sem sessão → /login. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullScreenLoader />;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

/** Exige lavanderia cadastrada. Sem lavanderia → /onboarding. */
export function RequireBusiness({ children }: { children: ReactNode }) {
  const { business, loading } = useBusiness();
  if (loading) return <FullScreenLoader />;
  if (!business) return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

/** Onboarding só para quem ainda não tem lavanderia. */
export function RequireNoBusiness({ children }: { children: ReactNode }) {
  const { business, loading } = useBusiness();
  if (loading) return <FullScreenLoader />;
  if (business) return <Navigate to="/app" replace />;
  return <>{children}</>;
}

/** Telas de login/cadastro: quem já está logado vai para o painel. */
export function GuestOnly({ children }: { children: ReactNode }) {
  const { session, loading, recovering } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (session && !recovering) return <Navigate to="/app" replace />;
  return <>{children}</>;
}
