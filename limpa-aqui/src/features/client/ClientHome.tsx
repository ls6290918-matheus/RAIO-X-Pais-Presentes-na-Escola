import { useCallback, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Check, CheckCircle2, ChevronDown, ChevronRight, Circle, MapPin, Megaphone, Plus, Store } from "lucide-react";
import { Alert, Button, Card, Modal, cn } from "@/components/shared/ui";
import { Skeleton } from "@/components/shared/steps";
import { BannerCarousel, CategoryTile, HOME_CATEGORIES, ServiceSearch, type Banner } from "@/components/shared/market";
import { UserMenu } from "@/components/layout/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { ADDRESS_COLUMNS } from "@/lib/maps";
import { ProviderCard } from "@/features/marketplace/ProviderCard";
import type { SearchResult } from "@/features/marketplace/types";
import { ClientShell } from "./ClientShell";
import { ActiveOrderCard } from "./OrderTracker";
import { ListingModal } from "./ListingModal";
import { AddressModal } from "./AddressModal";
import { isActiveOrder, type MyOrder, type UserAddress } from "./clientTypes";
import { loadRatings } from "@/lib/ratings";

const addrLine = (a: UserAddress) => [a.street && `${a.street}${a.street_number ? `, ${a.street_number}` : ""}`, a.neighborhood].filter(Boolean).join(" · ") || a.label;

/** Troca do endereço principal (o que a home e a busca usam). */
function AddressPicker({ addresses, onClose, onChanged }: { addresses: UserAddress[]; onClose: () => void; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  if (adding)
    return (
      <AddressModal
        address={null}
        onClose={() => setAdding(false)}
        onSaved={async () => {
          await onChanged();
          onClose();
        }}
      />
    );
  return (
    <Modal open title="Onde você está?" onClose={onClose}>
      <div className="space-y-3" data-testid="address-picker">
        {error && <Alert>{error}</Alert>}
        <ul className="space-y-2">
          {addresses.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                disabled={busy !== null}
                onClick={async () => {
                  if (a.is_default) return onClose();
                  setBusy(a.id);
                  const { error: err } = await supabase.rpc("set_default_address", { p_address_id: a.id });
                  setBusy(null);
                  if (err) return setError(friendlyError(err));
                  await onChanged();
                  onClose();
                }}
                className={cn(
                  "flex w-full items-center gap-3 rounded-2xl border-2 p-3 text-left transition",
                  a.is_default ? "border-agua bg-agua-50/50" : "border-grafite/10 hover:border-grafite/25",
                  busy === a.id && "animate-pulse",
                )}
              >
                <MapPin className="h-5 w-5 shrink-0 text-agua-600" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-petroleo">{a.label}</span>
                  <span className="block truncate text-xs text-grafite-500">
                    {addrLine(a)} · {a.municipality?.name ?? a.city}
                  </span>
                </span>
                {a.is_default && <Check className="h-5 w-5 text-agua-600" aria-hidden />}
              </button>
            </li>
          ))}
        </ul>
        <Button variant="outline" block onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" aria-hidden /> Novo endereço pelo CEP
        </Button>
      </div>
    </Modal>
  );
}

/** /cliente — Início do cliente: endereço, busca, categorias, banners, mural, pedidos e prestadores perto. */
export default function ClientHome() {
  const { user } = useAuth();
  const location = useLocation();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState<string | null>(null);
  const [addresses, setAddresses] = useState<UserAddress[] | null>(null);
  const [orders, setOrders] = useState<MyOrder[]>([]);
  const [nearby, setNearby] = useState<SearchResult[] | null>(null);
  const [cats, setCats] = useState<Array<{ code: string; name: string }>>([]);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [newListing, setNewListing] = useState(false);
  const [picker, setPicker] = useState(false);
  const [msg, setMsg] = useState<string | null>((location.state as { success?: string } | null)?.success ?? null);

  const load = useCallback(async () => {
    if (!user) return;
    const [p, a, o, c, b] = await Promise.all([
      supabase.from("profiles").select("full_name, phone").eq("id", user.id).maybeSingle(),
      supabase.from("user_addresses").select(`id, label, is_default, municipality_id, ${ADDRESS_COLUMNS}, municipality:municipalities(name)`).order("created_at"),
      supabase.rpc("my_orders"),
      supabase.rpc("public_categories"),
      supabase.rpc("public_banners"),
    ]);
    setName(p.data?.full_name ?? String(user.user_metadata?.full_name ?? ""));
    setPhone(p.data?.phone ?? null);
    const list = (a.data as unknown as UserAddress[]) ?? [];
    setAddresses(list);
    setOrders((o.data as MyOrder[]) ?? []);
    setCats((c.data as Array<{ code: string; name: string }>) ?? []);
    setBanners((b.data as Banner[]) ?? []);
    const main = list.find((x) => x.is_default) ?? list[0];
    if (main?.municipality_id) {
      const { data } = await supabase.rpc("search_providers", {
        p_municipality_id: main.municipality_id,
        p_category: null,
        p_lat: main.lat ?? null,
        p_lng: main.lng ?? null,
      });
      const list = ((data as SearchResult[]) ?? []).map((r) => ({ ...r, min_price: r.min_price == null ? null : Number(r.min_price), distance_km: r.distance_km == null ? null : Number(r.distance_km) }));
      const rt = await loadRatings(list.map((r) => r.slug));
      setNearby(list.map((r) => ({ ...r, ...rt.get(r.slug) })));
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
  const mun = main?.municipality_id ?? null;
  const catHref = (code: string) => `/buscar?${mun ? `m=${mun}&` : ""}c=${code}`;
  const tiles = HOME_CATEGORIES.filter((t) => cats.some((c) => c.code === t.code));

  return (
    <ClientShell bare>
      {/* Topo: endereço atual e conta (no computador o topo do app já aparece) */}
      <div className="-mx-4 flex items-center gap-2 bg-white px-4 py-3 sm:mx-0 sm:mb-2 sm:rounded-2xl sm:px-5 sm:shadow-sm" data-testid="home-top">
        <button
          type="button"
          onClick={() => setPicker(true)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-xl py-1 text-left"
          data-testid="address-button"
        >
          <MapPin className="h-5 w-5 shrink-0 text-agua-600" aria-hidden />
          <span className="min-w-0">
            <span className="block text-[11px] font-medium text-grafite-500">{firstName ? `Olá, ${firstName}! Entregar em` : "Seu endereço"}</span>
            <span className="flex items-center gap-1 text-sm font-semibold text-petroleo">
              <span className="truncate">{addresses === null ? "Carregando…" : main ? `${addrLine(main)}` : "Escolher endereço"}</span>
              <ChevronDown className="h-4 w-4 shrink-0" aria-hidden />
            </span>
          </span>
        </button>
        <div className="sm:hidden">
          <UserMenu />
        </div>
      </div>

      <div className="mt-3 space-y-6">
        <ServiceSearch categories={cats} municipalityId={mun} />

        {msg && (
          <div onClick={() => setMsg(null)}>
            <Alert kind="success">{msg}</Alert>
          </div>
        )}

        {/* Categorias */}
        {cats.length === 0 ? (
          <div className="grid grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="aspect-square" />
            ))}
          </div>
        ) : (
          <section className="grid grid-cols-4 gap-x-3 gap-y-4 sm:grid-cols-8" aria-label="Categorias" data-testid="home-categories">
            {tiles.map((t) => (
              <CategoryTile key={t.code} to={catHref(t.code)} label={t.label} icon={t.icon} />
            ))}
          </section>
        )}

        <BannerCarousel banners={banners} />

        {addresses !== null && steps.some((s) => !s.done) && (
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

        {/* Mural: publicar o que precisa lavar */}
        <section className="rounded-3xl bg-petroleo p-5 text-white sm:flex sm:items-center sm:gap-4" data-testid="mural-cta">
          <div className="flex items-center gap-4 sm:flex-1">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-agua text-petroleo">
              <Megaphone className="h-6 w-6" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">Não achou? Publique o que precisa</p>
              <p className="text-xs text-white/70">Ex.: "Preciso lavar 3 pares de tênis". Prestadores da sua região mandam propostas.</p>
            </div>
          </div>
          <Button className="mt-4 w-full shrink-0 sm:mt-0 sm:w-auto" onClick={() => setNewListing(true)} data-testid="mural-open">
            Publicar pedido
          </Button>
        </section>

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

        {/* Perto de você */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-grafite">Perto de você</h2>
            <Link to={mun ? `/buscar?m=${mun}` : "/buscar"} className="text-sm font-semibold text-agua-600 hover:underline">
              Ver mais
            </Link>
          </div>
          {nearby === null ? (
            <div className="grid gap-3 sm:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-48" />
              ))}
            </div>
          ) : nearby.length === 0 ? (
            <Card className="flex items-center gap-3 p-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-agua-50 text-petroleo">
                <Store className="h-5 w-5" aria-hidden />
              </span>
              <p className="min-w-0 flex-1 text-sm text-grafite-500">
                {main ? "Ainda não há prestadores atendendo o seu endereço. Publique o que precisa ou veja outras cidades." : "Escolha seu endereço para ver quem atende perto de você."}
              </p>
              {main ? (
                <Link to="/buscar" className="text-sm font-semibold text-agua-600">
                  Buscar
                </Link>
              ) : (
                <button type="button" onClick={() => setPicker(true)} className="text-sm font-semibold text-agua-600">
                  Escolher
                </button>
              )}
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
      </div>

      {picker && addresses && <AddressPicker addresses={addresses} onClose={() => setPicker(false)} onChanged={load} />}

      {newListing && addresses && (
        <ListingModal
          addresses={addresses}
          onClose={() => setNewListing(false)}
          onSaved={async () => {
            setNewListing(false);
            setMsg("Publicado! Os prestadores da sua região já podem mandar propostas. Acompanhe em Perfil → Meus anúncios.");
          }}
        />
      )}
    </ClientShell>
  );
}
