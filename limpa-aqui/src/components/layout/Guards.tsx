import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useBusiness } from "@/contexts/BusinessContext";
import { Card, EmptyState, FullScreenLoader, buttonClass } from "@/components/shared/ui";
import { Link } from "react-router-dom";
import { PowerOff } from "lucide-react";
import { pendingInvite } from "@/lib/invite";

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
  // Quem abriu um link de convite antes de entrar volta para o convite, não para o cadastro de lavanderia
  const invite = pendingInvite();
  if (invite) return <Navigate to={`/convite/${invite}`} replace />;
  return <>{children}</>;
}

/** Telas de login/cadastro: quem já está logado vai para o painel. */
export function GuestOnly({ children }: { children: ReactNode }) {
  const { session, loading, recovering } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (session && !recovering) return <Navigate to="/app" replace />;
  return <>{children}</>;
}

/** Telas só do dono da lavanderia (ex.: personalizar o painel). Funcionário volta para o painel. */
export function RequireOwner({ children }: { children: ReactNode }) {
  const { role, loading } = useBusiness();
  if (loading) return <FullScreenLoader />;
  if (role !== "owner") return <Navigate to="/app" replace />;
  return <>{children}</>;
}

/** Telas de um recurso que a lavanderia pode desligar em Configurações. */
export function RequireFeature({ code, children }: { code: string; children: ReactNode }) {
  const { hasFeature, features, role } = useBusiness();
  if (hasFeature(code)) return <>{children}</>;
  const name = features.find((f) => f.code === code)?.name ?? "Este recurso";
  return (
    <Card>
      <EmptyState
        icon={<PowerOff className="h-6 w-6" />}
        title={`${name} está desligado`}
        description={
          role === "owner"
            ? "Você pode ligar este recurso em Configurações, na parte Categorias e recursos."
            : "Peça ao dono da lavanderia para ligar este recurso em Configurações."
        }
        action={
          role === "owner" && (
            <Link to="/app/configuracoes#recursos" className={buttonClass("outline")}>
              Abrir Configurações
            </Link>
          )
        }
      />
    </Card>
  );
}
