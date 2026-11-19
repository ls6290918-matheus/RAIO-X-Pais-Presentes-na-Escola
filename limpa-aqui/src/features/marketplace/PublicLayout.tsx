import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { Logo, buttonClass } from "@/components/shared/ui";
import { UserMenu } from "@/components/layout/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { useRoles } from "@/contexts/RolesContext";
import { ClientTabBar } from "@/features/client/ClientShell";

/** Layout das páginas abertas ao público (busca e perfil de prestador). */
export function PublicLayout({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const { hasRole } = useRoles();
  const location = useLocation();
  const tabs = Boolean(session) && hasRole("anunciante");
  return (
    <div className="min-h-screen bg-nevoa">
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-grafite/5 bg-white/85 px-4 backdrop-blur sm:px-6">
        <Link to="/buscar" aria-label="Limpa Aqui — buscar">
          <Logo />
        </Link>
        {session ? (
          <UserMenu />
        ) : (
          <div className="flex items-center gap-2">
            <Link to="/login" state={{ from: location.pathname + location.search }} className={buttonClass("outline")}>
              Entrar
            </Link>
            <Link to="/cadastro" className={`${buttonClass()} hidden sm:inline-flex`}>
              Criar conta
            </Link>
          </div>
        )}
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
      <footer className={`mx-auto flex max-w-5xl flex-wrap gap-x-4 gap-y-1 px-4 text-xs text-grafite-500 sm:px-6 ${tabs ? "pb-24 sm:pb-8" : "pb-8"}`}>
        <span>© {new Date().getFullYear()} Limpa Aqui</span>
        <Link to="/termos" className="hover:underline">Termos de Uso</Link>
        <Link to="/privacidade" className="hover:underline">Política de Privacidade</Link>
      </footer>
      {tabs && <ClientTabBar />}
    </div>
  );
}
