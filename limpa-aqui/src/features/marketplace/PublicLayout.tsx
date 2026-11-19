import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { Logo, buttonClass } from "@/components/shared/ui";
import { UserMenu } from "@/components/layout/AppLayout";
import { useAuth } from "@/contexts/AuthContext";

/** Layout das páginas abertas ao público (busca e perfil de prestador). */
export function PublicLayout({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const location = useLocation();
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
    </div>
  );
}
