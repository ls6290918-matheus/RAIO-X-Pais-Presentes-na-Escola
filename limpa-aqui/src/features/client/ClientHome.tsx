import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { CheckCircle2, ChevronRight, Circle, MapPin, Megaphone, Search, Shirt, Sofa, Footprints, Store } from "lucide-react";
import { Alert, Card, InlineLoader, cn } from "@/components/shared/ui";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { ADDRESS_COLUMNS } from "@/lib/maps";
import { ProviderCard } from "@/features/marketplace/ProviderCard";
import type { SearchResult } from "@/features/marketplace/types";
import { ClientShell } from "./ClientShell";
import { ActiveOrderCard } from "./OrderTracker";
import { ListingModal } from "./ListingModal";
import { isActiveOrder, type MyOrder, type UserAddress } from "./clientTypes";

const QUICK = [
  { code: "lavagem_tenis", label: "Tênis", icon: Footprints },
  { code: "lavagem_roupas", label: "Roupas", icon: Shirt },
  { code: "higienizacao_sofas", label: "Sofás", icon: Sofa },
];

/** /cliente — Início do app do cliente: saudação, busca, pedidos em andamento e lavanderias perto de você. */
export default function ClientHome() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState<string | null>(null);
  const [addresses, setAddresses] = useState<UserAddress[] | null>(null);
  const [orders, setOrders] = useState<MyOrder[]>([]);
  const [nearby, setNearby] = useState<SearchResult[] | null>(null);
  const [cats, setCats] = useState<Array<{ code: string; name: string }>>([]);
  const [newListing, setNewListing] = useState(false);
  const [msg, setMsg] = useState<string | null>((location.state as { success?: string } | null)?.success ?? null);

  const load = useCallback(async () => {
    if (!user) return;
    const [p, a, o, c] = await Promise.all([
      supabase.from("profiles").select("full_name, phone").eq("id", user.id).maybeSingle(),
      supabase.from("user_addresses").select(`id, label, is_default, municipality_id, ${ADDRESS_COLUMNS}, municipality:municipalities(name)`).order("created_at"),
      supabase.rpc("my_orders"),
      supabase.rpc("public_categories"),
    ]);
    setName(p.data?.full_name ?? String(user.user_metadata?.full_name ?? ""));
    setPhone(p.data?.phone ?? null);
    const list = (a.data as unknown as UserAddress[]) ?? [];
    setAddresses(list);
    setOrders((o.data as MyOrder[]) ?? []);
    setCats((c.data as Array<{ code: string; name: string }>) ?? []);
    const main = list.find((x) => x.is_default) ?? list[0];
    if (main?.municipality_id) {
      const { data } = await supabase.rpc("search_providers", {
        p_municipality_id: main.municipality_id,
        p_category: null,
        p_lat: main.lat ?? null,
        p_lng: main.lng ?? null,
      });
      setNearby(((data as SearchResult[]) ?? []).map((r) => ({ ...r, min_price: r.min_price == null ? null : Number(r.min_price), distance_km: r.distance_km == null ? null : Number(r.distance_km) })));
    } else {
      setNearby([]);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const main = addresses?.find((x) => x.is_default) ?? addresses?.[0];
  const firstName = name.split(" ")[0];
  const active = orders.filter(isActiveOrder);
  const steps = [
    { done: !!phone, label: "Informe seu WhatsApp" },
    { done: (addresses?.length ?? 0) > 0, label: "Cadastre seu endereço" },
  ];
  const quick = QUICK.filter((q) => cats.some((c) => c.code === q.code));
  const searchHref = main?.municipality_id ? `/buscar?m=${main.municipality_id}` : "/buscar";

  return (
    <ClientShell bare>
      {/* Cabeçalho colorido (celular ocupa a largura toda) */}
      <section className="-mx-4 rounded-b-[28px] bg-gradient-to-br from-[#1F8F86] to-agua-600 px-5 pb-6 pt-6 text-white sm:mx-0 sm:rounded-3xl sm:px-8" data-testid="client-hero">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold">{firstName ? `Olá, ${firstName}` : "Olá!"}</p>
            <p className="mt-0.5 flex items-center gap-1 truncate text-sm text-white/85">
              <MapPin className="h-4 w-4 shrink-0" aria-hidden />
              {main ? [main.neighborhood, main.municipality?.name ?? main.city].filter(Boolean).join(", ") : "Cadastre seu endereço"}
            </p>
          </div>
          <div className="rounded-xl bg-white/15 text-white sm:hidden [&_button]:text-white">
            <NotificationBell />
          </div>
        </div>
        <button
          type="button"
          onClick={() => navigate(searchHref)}
          className="mt-5 flex w-full items-center gap-2 rounded-2xl bg-white/20 px-4 py-3 text-left text-sm text-white/90 ring-1 ring-white/25 transition hover:bg-white/25"
          data-testid="hero-search"
        >
          <Search className="h-4 w-4" aria-hidden />
          Buscar lavanderias {main?.municipality?.name ? `em ${main.municipality.name}` : "perto de você"}
        </button>
      </section>

      <div className="mt-5 space-y-6">
        {msg && (
          <div onClick={() => setMsg(null)}>
            <Alert kind="success">{msg}</Alert>
          </div>
        )}

        {addresses === null ? (
          <InlineLoader />
        ) : (
          <>
            {steps.some((s) => !s.done) && (
              <Link to="/cliente/conta" className="block">
                <Card className="flex items-center gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-petroleo">Complete seu cadastro para contratar</p>
                    <ul className="mt-2 space-y-1">
                      {steps.map((s) => (
                        <li key={s.label} className="flex items-center gap-2 text-sm">
                          {s.done ? <CheckCircle2 className="h-4 w-4 text-agua-600" aria-hidden /> : <Circle className="h-4 w-4 text-grafite-300" aria-hidden />}
                          <span className={cn(s.done ? "text-grafite-500 line-through" : "text-grafite")}>{s.label}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <ChevronRight className="h-5 w-5 text-grafite-300" aria-hidden />
                </Card>
              </Link>
            )}

            {/* Pedidos em andamento */}
            {active.length > 0 && (
              <section>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-base font-semibold text-grafite">Pedidos em andamento</h2>
                  <Link to="/cliente/pedidos" className="text-sm font-semibold text-agua-600 hover:underline">
                    Ver todos
                  </Link>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {active.slice(0, 2).map((o) => (
                    <ActiveOrderCard key={o.id} order={o} />
                  ))}
                </div>
              </section>
            )}

            {/* Atalhos por tipo de serviço */}
            {quick.length > 0 && (
              <section className="grid grid-cols-4 gap-2">
                {quick.map(({ code, label, icon: Icon }) => (
                  <Link
                    key={code}
                    to={`${searchHref}${searchHref.includes("?") ? "&" : "?"}c=${code}`}
                    className="flex flex-col items-center gap-1.5 rounded-2xl bg-white p-3 text-xs font-semibold text-grafite shadow-sm"
                  >
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-agua-50 text-agua-600">
                      <Icon className="h-5 w-5" aria-hidden />
                    </span>
                    {label}
                  </Link>
                ))}
                <button type="button" onClick={() => setNewListing(true)} className="flex flex-col items-center gap-1.5 rounded-2xl bg-white p-3 text-xs font-semibold text-grafite shadow-sm">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                    <Megaphone className="h-5 w-5" aria-hidden />
                  </span>
                  Pedir orçamento
                </button>
              </section>
            )}

            {/* Perto de você */}
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-semibold text-grafite">Lavanderias perto de você</h2>
                <Link to={searchHref} className="text-sm font-semibold text-agua-600 hover:underline">
                  Ver todas
                </Link>
              </div>
              {nearby === null ? (
                <InlineLoader />
              ) : nearby.length === 0 ? (
                <Card className="flex items-center gap-3 p-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-agua-50 text-petroleo">
                    <Store className="h-5 w-5" aria-hidden />
                  </span>
                  <p className="min-w-0 flex-1 text-sm text-grafite-500">
                    {main ? "Ainda não há lavanderias atendendo o seu endereço. Veja outras cidades na busca ou peça um orçamento." : "Cadastre seu endereço para ver quem atende perto de você."}
                  </p>
                  <Link to={main ? "/buscar" : "/cliente/conta"} className="text-sm font-semibold text-agua-600">
                    {main ? "Buscar" : "Cadastrar"}
                  </Link>
                </Card>
              ) : (
                <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0" data-testid="nearby-list">
                  {nearby.slice(0, 8).map((r) => (
                    <div key={r.id} className="sm:contents">
                      <div className="sm:hidden">
                        <ProviderCard r={r} compact />
                      </div>
                      <div className="hidden sm:block">
                        <ProviderCard r={r} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {newListing && addresses && (
        <ListingModal
          addresses={addresses}
          onClose={() => setNewListing(false)}
          onSaved={async () => {
            setNewListing(false);
            setMsg("Pedido de orçamento publicado! As lavanderias da sua região já podem mandar propostas. Acompanhe em Conta → Meus anúncios.");
          }}
        />
      )}
    </ClientShell>
  );
}
