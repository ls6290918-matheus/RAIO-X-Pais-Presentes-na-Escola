import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  CalendarDays,
  ChevronDown,
  Globe,
  LayoutDashboard,
  LogOut,
  Menu,
  PackageOpen,
  Settings,
  Sparkles,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { Badge, Logo, cn } from "@/components/shared/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useBusiness } from "@/contexts/BusinessContext";

type NavItem = { to: string; label: string; icon: LucideIcon; soon?: boolean };

// Itens "soon" ficam visíveis, mas desabilitados até a etapa correspondente.
const NAV: NavItem[] = [
  { to: "/app", label: "Dashboard", icon: LayoutDashboard },
  { to: "/app/pedidos", label: "Pedidos", icon: PackageOpen },
  { to: "/app/clientes", label: "Clientes", icon: Users },
  { to: "/app/servicos", label: "Serviços", icon: Sparkles },
  { to: "/app/financeiro", label: "Financeiro", icon: Wallet, soon: true },
  { to: "/app/agenda", label: "Agenda", icon: CalendarDays, soon: true },
  { to: "/app/pagina-publica", label: "Página pública", icon: Globe, soon: true },
  { to: "/app/configuracoes", label: "Configurações", icon: Settings },
];

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="space-y-1" aria-label="Menu principal">
      {NAV.map(({ to, label, icon: Icon, soon }) =>
        soon ? (
          <div
            key={to}
            className="flex cursor-not-allowed items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-white/35"
            aria-disabled="true"
            title="Disponível em breve"
          >
            <Icon className="h-[18px] w-[18px]" aria-hidden />
            <span className="flex-1">{label}</span>
            <Badge>Em breve</Badge>
          </div>
        ) : (
          <NavLink
            key={to}
            to={to}
            end={to === "/app"}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                isActive ? "bg-agua text-petroleo" : "text-white/75 hover:bg-white/5 hover:text-white",
              )
            }
          >
            <Icon className="h-[18px] w-[18px]" aria-hidden />
            {label}
          </NavLink>
        ),
      )}
    </nav>
  );
}

function UserMenu() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const name = (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? "";
  const initials = name
    .split(/[\s@]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-nevoa"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-petroleo text-xs font-semibold text-agua">
          {initials || "?"}
        </span>
        <span className="hidden max-w-[160px] truncate text-sm font-medium text-grafite sm:block">{name}</span>
        <ChevronDown className="h-4 w-4 text-grafite-500" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-2 w-56 rounded-xl border border-grafite/10 bg-white p-1.5 shadow-card">
          <div className="truncate px-3 py-2 text-xs text-grafite-500">{user?.email}</div>
          <button
            role="menuitem"
            onClick={() => void signOut()}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-grafite hover:bg-nevoa"
          >
            <LogOut className="h-4 w-4" aria-hidden /> Sair
          </button>
        </div>
      )}
    </div>
  );
}

export function AppLayout() {
  const { business } = useBusiness();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  useEffect(() => setMobileOpen(false), [location.pathname]);

  return (
    <div className="min-h-screen bg-nevoa">
      {/* Sidebar desktop */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col bg-petroleo px-4 py-6 lg:flex">
        <div className="px-2">
          <Logo light />
        </div>
        <div className="mt-8 flex-1 overflow-y-auto">
          <NavList />
        </div>
      </aside>

      {/* Drawer mobile */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-petroleo/60" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col bg-petroleo px-4 py-6">
            <div className="flex items-center justify-between px-2">
              <Logo light />
              <button onClick={() => setMobileOpen(false)} className="rounded-lg p-1.5 text-white/70 hover:bg-white/10" aria-label="Fechar menu">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-8 flex-1 overflow-y-auto">
              <NavList onNavigate={() => setMobileOpen(false)} />
            </div>
          </aside>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-grafite/5 bg-white/85 px-4 backdrop-blur sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              onClick={() => setMobileOpen(true)}
              className="rounded-lg p-2 text-grafite hover:bg-nevoa lg:hidden"
              aria-label="Abrir menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-petroleo">{business?.name}</p>
              <p className="truncate text-xs text-grafite-500">limpaaqui.com.br/{business?.slug}</p>
            </div>
          </div>
          <UserMenu />
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
