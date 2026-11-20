import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { Home, Package, Search, UserRound } from "lucide-react";
import { Logo, cn } from "@/components/shared/ui";
import { UserMenu } from "@/components/layout/AppLayout";

const TABS = [
  { to: "/cliente", label: "Início", icon: Home, end: true },
  { to: "/buscar", label: "Buscar", icon: Search, end: false },
  { to: "/cliente/pedidos", label: "Pedidos", icon: Package, end: false },
  { to: "/cliente/conta", label: "Perfil", icon: UserRound, end: false },
];

/** Barra de navegação do app do cliente (fixa embaixo no celular; no computador, no topo). */
export function ClientTabBar({ className }: { className?: string }) {
  return (
    <nav
      aria-label="Navegação do cliente"
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 border-t border-grafite/10 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden",
        className,
      )}
      data-testid="client-tabbar"
    >
      <ul className="mx-auto grid max-w-md grid-cols-4">
        {TABS.map(({ to, label, icon: Icon, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                cn("flex flex-col items-center gap-1 py-2.5 text-[11px] font-semibold", isActive ? "text-agua-600" : "text-grafite-500")
              }
            >
              <Icon className="h-5 w-5" aria-hidden />
              {label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function DesktopTabs() {
  return (
    <nav aria-label="Navegação do cliente" className="hidden items-center gap-1 sm:flex">
      {TABS.map(({ to, label, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            cn("rounded-xl px-3 py-2 text-sm font-semibold transition", isActive ? "bg-agua-50 text-petroleo" : "text-grafite-500 hover:bg-nevoa")
          }
        >
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

/**
 * Layout do app do cliente. `bare` = a tela desenha o próprio topo no celular (ex.: Início, com o cabeçalho colorido).
 */
export function ClientShell({ children, bare = false }: { children: ReactNode; bare?: boolean }) {
  return (
    <div className="min-h-screen bg-nevoa">
      <header
        className={cn(
          "sticky top-0 z-30 h-16 items-center justify-between gap-4 border-b border-grafite/5 bg-white/90 px-4 backdrop-blur sm:px-6",
          bare ? "hidden sm:flex" : "flex",
        )}
      >
        <Link to="/cliente" aria-label="Início">
          <Logo />
        </Link>
        <DesktopTabs />
        <UserMenu />
      </header>
      <main className={cn("mx-auto max-w-5xl px-4 pb-28 sm:px-6 sm:pb-10", bare ? "pt-0 sm:pt-8" : "pt-6 sm:pt-8")}>{children}</main>
      <ClientTabBar />
    </div>
  );
}
