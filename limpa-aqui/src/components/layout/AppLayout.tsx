import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import {
  ChevronDown,
  Inbox,
  LayoutDashboard,
  Search,
  ShieldCheck,
  Store,
  UserRound,
  LogOut,
  MapPin,
  Menu,
  Settings,
  X,
  type LucideIcon,
} from "lucide-react";
import { Badge, Logo, cn } from "@/components/shared/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useBusiness } from "@/contexts/BusinessContext";
import { useRoles } from "@/contexts/RolesContext";
import { FEATURE_META, LEGACY_SOON, MENU_FEATURES, featureIcon } from "@/lib/featureMeta";
import { logoUrl } from "@/lib/logo";

type NavItem = { to: string; label: string; icon: LucideIcon; soon?: boolean };

/**
 * Menu montado pelos recursos ligados na lavanderia (business_features).
 * Recursos "em breve" aparecem desabilitados, sem tela.
 * Lavanderia ainda não configurada pelo assistente vê o menu de antes.
 */
function useNav(): NavItem[] {
  const { features, configured, hasFeature, role } = useBusiness();
  const items: NavItem[] = [{ to: "/app", label: "Dashboard", icon: LayoutDashboard }];
  // Anúncios de clientes da região (marketplace) — quem propõe é o dono
  if (role === "owner") items.push({ to: "/app/oportunidades", label: "Oportunidades", icon: Inbox });
  for (const code of MENU_FEATURES) {
    const f = features.find((x) => x.code === code);
    if (!f) continue;
    // Equipe é só do dono
    if (code === "equipe" && role !== "owner") continue;
    const label = FEATURE_META[code]?.menuLabel ?? f.name;
    if (f.status === "disponivel" && f.route) {
      if (hasFeature(code)) items.push({ to: f.route, label, icon: featureIcon(code) });
    } else if (configured ? f.enabled : LEGACY_SOON.includes(code)) {
      items.push({ to: `/app/${code}`, label, icon: featureIcon(code), soon: true });
    }
  }
  items.push({ to: "/app/configuracoes", label: "Configurações", icon: Settings });
  return items;
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const nav = useNav();
  return (
    <nav className="space-y-1" aria-label="Menu principal">
      {nav.map(({ to, label, icon: Icon, soon }) =>
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

/** Menu da conta: troca de perfil (conta, lavanderia, administração) e sair. */
export function UserMenu() {
  const { user, signOut } = useAuth();
  const { business } = useBusiness();
  const { hasRole } = useRoles();
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
          <Link role="menuitem" to="/conta" onClick={() => setOpen(false)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-grafite hover:bg-nevoa">
            <UserRound className="h-4 w-4" aria-hidden /> Minha conta e perfis
          </Link>
          <Link role="menuitem" to="/buscar" onClick={() => setOpen(false)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-grafite hover:bg-nevoa">
            <MapPin className="h-4 w-4" aria-hidden /> Buscar prestadores
          </Link>
          {hasRole("anunciante") && (
            <Link role="menuitem" to="/cliente" onClick={() => setOpen(false)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-grafite hover:bg-nevoa">
              <Search className="h-4 w-4" aria-hidden /> Contratar serviços
            </Link>
          )}
          {business && (
            <Link role="menuitem" to="/app" onClick={() => setOpen(false)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-grafite hover:bg-nevoa">
              <Store className="h-4 w-4" aria-hidden /> Minha lavanderia
            </Link>
          )}
          {hasRole("admin") && (
            <Link role="menuitem" to="/admin" onClick={() => setOpen(false)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-grafite hover:bg-nevoa">
              <ShieldCheck className="h-4 w-4" aria-hidden /> Administração
            </Link>
          )}
          <div className="my-1 border-t border-grafite/5" />
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
            {business?.logo_path && (
              <img src={logoUrl(business.logo_path) ?? undefined} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover" />
            )}
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
