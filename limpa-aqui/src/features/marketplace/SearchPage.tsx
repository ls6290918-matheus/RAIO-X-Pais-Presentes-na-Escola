import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Bike, LocateFixed, MapPin, Search, Store, Wallet } from "lucide-react";
import { Alert, Button, Card, EmptyState, Field, InlineLoader, Select, buttonClass, cn } from "@/components/shared/ui";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { formatBRL } from "@/lib/format";
import { logoUrl } from "@/lib/logo";
import { PublicLayout } from "./PublicLayout";
import { PROVIDER_TYPE_LABEL, formatKm, type SearchResult } from "./types";

type Mun = { id: number; name: string; providers: number };
type Cat = { code: string; name: string };
type Point = { lat: number; lng: number; source: "endereco" | "aparelho" };

/** /buscar — busca pública de prestadores por município, categoria e distância (não precisa de conta). */
export default function SearchPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [muns, setMuns] = useState<Mun[] | null>(null);
  const [cats, setCats] = useState<Cat[]>([]);
  const [point, setPoint] = useState<Point | null>(null);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  const mun = params.get("m") ?? "";
  const cat = params.get("c") ?? "";
  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  // Municípios com atendimento, categorias e (logado) o endereço principal
  useEffect(() => {
    void (async () => {
      const [m, c, a] = await Promise.all([
        supabase.rpc("marketplace_municipalities"),
        supabase.rpc("public_categories"),
        user ? supabase.from("user_addresses").select("lat, lng, municipality_id").eq("is_default", true).maybeSingle() : Promise.resolve({ data: null, error: null }),
      ]);
      if (m.error || c.error) setError(friendlyError(m.error ?? c.error));
      const list = ((m.data as Mun[]) ?? []).map((x) => ({ ...x, providers: Number(x.providers) }));
      setMuns(list);
      setCats((c.data as Cat[]) ?? []);
      const addr = a.data as { lat: number | null; lng: number | null; municipality_id: number | null } | null;
      if (addr?.lat != null && addr?.lng != null) setPoint({ lat: addr.lat, lng: addr.lng, source: "endereco" });
      if (!params.get("m") && addr?.municipality_id && list.some((x) => x.id === addr.municipality_id)) setParam("m", String(addr.municipality_id));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    if (!mun) return setResults(null);
    setSearching(true);
    void supabase
      .rpc("search_providers", { p_municipality_id: Number(mun), p_category: cat || null, p_lat: point?.lat ?? null, p_lng: point?.lng ?? null })
      .then(({ data, error: err }) => {
        setSearching(false);
        if (err) setError(friendlyError(err));
        setResults(((data as SearchResult[]) ?? []).map((r) => ({ ...r, min_price: r.min_price == null ? null : Number(r.min_price), distance_km: r.distance_km == null ? null : Number(r.distance_km) })));
      });
  }, [mun, cat, point]);

  function locate() {
    if (!navigator.geolocation) return setError("Seu navegador não informa a localização.");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setPoint({ lat: pos.coords.latitude, lng: pos.coords.longitude, source: "aparelho" });
      },
      () => {
        setLocating(false);
        setError("Não foi possível pegar sua localização. Confira a permissão do navegador.");
      },
      { timeout: 10000, maximumAge: 300000 },
    );
  }

  return (
    <PublicLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-petroleo">Encontre quem lava perto de você</h1>
          <p className="mt-1 text-sm text-grafite-500">Lavanderias e profissionais autônomos do estado do Rio de Janeiro.</p>
        </div>
        {error && <Alert>{error}</Alert>}

        {muns === null ? (
          <InlineLoader />
        ) : muns.length === 0 ? (
          <Card>
            <EmptyState
              icon={<MapPin className="h-6 w-6" />}
              title="Estamos chegando ao Rio de Janeiro"
              description="Ainda não há prestadores disponíveis na busca. Se você lava tênis, roupas ou estofados, cadastre-se e seja um dos primeiros."
              action={
                <Link to="/cadastro" className={buttonClass()}>
                  Quero oferecer meus serviços
                </Link>
              }
            />
          </Card>
        ) : (
          <>
            <Card className="p-4 sm:p-5">
              <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <Field label="Município" htmlFor="b-mun">
                  <Select id="b-mun" value={mun} onChange={(e) => setParam("m", e.target.value)}>
                    <option value="">Escolha o município</option>
                    {muns.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.providers})
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Serviço" htmlFor="b-cat">
                  <Select id="b-cat" value={cat} onChange={(e) => setParam("c", e.target.value)}>
                    <option value="">Todos os serviços</option>
                    {cats.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Button variant="outline" loading={locating} onClick={locate}>
                  <LocateFixed className="h-4 w-4" aria-hidden /> {point?.source === "aparelho" ? "Localização atualizada" : "Usar minha localização"}
                </Button>
              </div>
              {point && (
                <p className="mt-3 text-xs text-grafite-500">
                  Distâncias em linha reta a partir {point.source === "endereco" ? "do seu endereço principal" : "da sua localização atual"}.
                </p>
              )}
            </Card>

            {!mun ? (
              <p className="text-sm text-grafite-500">Escolha um município para ver quem atende por lá.</p>
            ) : searching || results === null ? (
              <InlineLoader />
            ) : results.length === 0 ? (
              <Card>
                <EmptyState
                  icon={<Search className="h-6 w-6" />}
                  title="Ninguém com esse serviço aqui ainda"
                  description="Tente outro serviço ou um município vizinho."
                />
              </Card>
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2" data-testid="search-results">
                {results.map((r) => (
                  <li key={r.id}>
                    <Link to={`/p/${r.slug}`} className="block h-full">
                      <Card className="h-full p-5 transition hover:border-agua">
                        <div className="flex items-start gap-3">
                          {r.logo_path ? (
                            <img src={logoUrl(r.logo_path) ?? undefined} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover" />
                          ) : (
                            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-petroleo text-agua">
                              <Store className="h-5 w-5" aria-hidden />
                            </span>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="flex items-center gap-2 text-base font-semibold text-petroleo">
                              <span className="truncate">{r.name}</span>
                              {r.featured && <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Destaque</span>}
                            </p>
                            <p className="text-xs text-grafite-500">
                              {r.provider_type ? PROVIDER_TYPE_LABEL[r.provider_type] : "Prestador"} ·{" "}
                              {[r.neighborhood, r.municipality_name].filter(Boolean).join(", ")}
                            </p>
                          </div>
                          {r.distance_km != null && (
                            <span className="shrink-0 rounded-full bg-nevoa px-2.5 py-1 text-xs font-semibold text-grafite">{formatKm(r.distance_km)}</span>
                          )}
                        </div>
                        {r.public_description && <p className="mt-3 line-clamp-2 text-sm text-grafite-500">{r.public_description}</p>}
                        {r.categories.length > 0 && <p className="mt-3 text-xs text-grafite">{r.categories.join(" · ")}</p>}
                        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                          {r.min_price != null && <span className="font-semibold text-petroleo">A partir de {formatBRL(r.min_price)}</span>}
                          {r.offers_pickup && (
                            <span className={cn("inline-flex items-center gap-1 rounded-full bg-agua-50 px-2 py-0.5 font-semibold text-petroleo")}>
                              <Bike className="h-3 w-3" aria-hidden /> Coleta e entrega
                            </span>
                          )}
                          {r.accepts_direct_payment && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-nevoa px-2 py-0.5 font-semibold text-grafite-500">
                              <Wallet className="h-3 w-3" aria-hidden /> Pagamento direto
                            </span>
                          )}
                        </div>
                      </Card>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </PublicLayout>
  );
}
