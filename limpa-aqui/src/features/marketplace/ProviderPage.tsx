import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, BedDouble, Bike, Clock, Footprints, MapPin, Megaphone, Minus, Navigation, Plus, QrCode, SearchX, Shirt, ShoppingBag, Sofa, Sparkles, Wallet, type LucideIcon } from "lucide-react";
import { Card, EmptyState, InlineLoader, buttonClass, cn } from "@/components/shared/ui";
import { supabase } from "@/lib/supabase";
import { formatBRL } from "@/lib/format";
import { priceLabel } from "@/lib/pricing";
import { useAuth } from "@/contexts/AuthContext";
import { PublicLayout } from "./PublicLayout";
import { HireModal } from "./HireModal";
import { ProviderCover } from "./ProviderCard";
import { RatingBadge, StarsDisplay } from "@/components/shared/Stars";
import { HOURS_LABEL, PROVIDER_TYPE_LABEL, type PublicProvider } from "./types";

/** Ícone do item pelo nome da categoria/serviço. */
function itemIcon(text: string): LucideIcon {
  const t = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/tenis|sapato|calcad/.test(t)) return Footprints;
  if (/sofa|estofad|colch/.test(t)) return Sofa;
  if (/edredo|cobertor|cama|lencol/.test(t)) return BedDouble;
  if (/bolsa|mochila/.test(t)) return ShoppingBag;
  if (/roupa|passad|camis|calca|vestid|secag/.test(t)) return Shirt;
  return Sparkles;
}

/** /p/:slug — perfil público do prestador: capa, itens por categoria com quantidade e barra com o total. */
export default function ProviderPage() {
  const { slug = "" } = useParams();
  const [p, setP] = useState<PublicProvider | null | undefined>(undefined);
  const [hiring, setHiring] = useState(false);
  const [cat, setCat] = useState<string>("");
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reviews, setReviews] = useState<Array<{ id: string; rating: number; comment: string | null; author: string; created_at: string; reply: string | null }>>([]);
  const { session } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    void supabase.rpc("get_public_provider", { p_slug: slug }).then(({ data }) => setP((data as PublicProvider | null) ?? null));
    void supabase.rpc("public_reviews", { p_slug: slug }).then(({ data }) => setReviews((data as typeof reviews) ?? []));
  }, [slug]);
  const avg = reviews.length ? reviews.reduce((a, r) => a + Number(r.rating), 0) / reviews.length : null;

  const categories = useMemo(() => [...new Set((p?.services ?? []).map((s) => s.category ?? "Outros serviços"))], [p]);
  const services = (p?.services ?? []).filter((s) => !cat || (s.category ?? "Outros serviços") === cat);
  const total = (p?.services ?? []).reduce((sum, s) => sum + (qty[s.id] ?? 0) * Number(s.price), 0);
  const count = Object.values(qty).reduce((a, b) => a + b, 0);
  const step = (id: string, d: number) => setQty((q) => ({ ...q, [id]: Math.max(0, Math.min(50, (q[id] ?? 0) + d)) }));

  if (p === undefined)
    return (
      <PublicLayout>
        <InlineLoader />
      </PublicLayout>
    );

  if (p === null)
    return (
      <PublicLayout>
        <Card>
          <EmptyState
            icon={<SearchX className="h-6 w-6" />}
            title="Prestador não encontrado"
            description="Este endereço não existe ou o prestador não está aparecendo na busca no momento."
            action={
              <Link to="/buscar" className={buttonClass()}>
                Buscar prestadores
              </Link>
            }
          />
        </Card>
      </PublicLayout>
    );

  const hours = Object.entries(p.opening_hours ?? {}).filter(([, v]) => v);
  const place = [p.neighborhood, p.municipality_name].filter(Boolean).join(", ");
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.name} ${place}`)}`;

  return (
    <PublicLayout>
      <div className="-mx-4 -mt-6 sm:mx-0 sm:mt-0">
        {/* Capa */}
        <div className="relative">
          <ProviderCover logo={p.logo_path} name={p.name} className="h-52 sm:h-64 sm:rounded-3xl" />
          <button
            type="button"
            onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/buscar"))}
            className="absolute left-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-petroleo shadow"
            aria-label="Voltar"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        </div>

        {/* Folha branca */}
        <div className="relative -mt-6 space-y-6 rounded-t-[28px] bg-nevoa px-4 pb-40 pt-5 sm:mt-6 sm:rounded-none sm:px-0">
          <section className="rounded-2xl bg-white p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <h1 className="text-xl font-semibold tracking-tight text-petroleo sm:text-2xl">{p.name}</h1>
                <p className="mt-0.5 flex items-center gap-1 text-sm text-grafite-500">
                  <MapPin className="h-4 w-4 shrink-0 text-agua-600" aria-hidden /> {place}
                </p>
                <p className="flex flex-wrap items-center gap-2 text-xs text-grafite-500">
                  {p.provider_type ? PROVIDER_TYPE_LABEL[p.provider_type] : "Prestador"}
                  <RatingBadge rating={avg != null ? Math.round(avg * 10) / 10 : null} count={reviews.length} />
                </p>
              </div>
              {p.featured && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-800">
                  <Sparkles className="h-3 w-3" aria-hidden /> Destaque
                </span>
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {p.offers_pickup && (
                <span className="inline-flex items-center gap-1 rounded-full bg-agua-50 px-2.5 py-1 font-semibold text-petroleo">
                  <Bike className="h-3.5 w-3.5" aria-hidden /> Coleta e entrega
                </span>
              )}
              {p.accepts_app_payment && (
                <span className="inline-flex items-center gap-1 rounded-full bg-agua-50 px-2.5 py-1 font-semibold text-petroleo">
                  <QrCode className="h-3.5 w-3.5" aria-hidden /> Pix pelo app
                </span>
              )}
              {p.accepts_direct_payment && (
                <span className="inline-flex items-center gap-1 rounded-full bg-nevoa px-2.5 py-1 font-semibold text-grafite-500">
                  <Wallet className="h-3.5 w-3.5" aria-hidden /> Pagamento direto
                </span>
              )}
            </div>
            {p.public_description && <p className="mt-3 whitespace-pre-line text-sm text-grafite">{p.public_description}</p>}
          </section>

          {/* Itens do pedido */}
          <section>
            <h2 className="mb-3 text-base font-semibold text-grafite">Itens do pedido</h2>
            {categories.length > 1 && (
              <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" role="tablist" data-testid="category-chips">
                {["", ...categories].map((c) => (
                  <button
                    key={c || "todos"}
                    role="tab"
                    aria-selected={cat === c}
                    onClick={() => setCat(c)}
                    className={cn(
                      "shrink-0 rounded-full px-4 py-2 text-xs font-semibold transition",
                      cat === c ? "bg-petroleo text-white" : "bg-white text-grafite-500 ring-1 ring-grafite/10",
                    )}
                  >
                    {c || "Todos"}
                  </button>
                ))}
              </div>
            )}
            <ul className="space-y-2" data-testid="public-services">
              {services.map((s) => {
                const quote = s.pricing_unit === "orcamento";
                const n = qty[s.id] ?? 0;
                return (
                  <li key={s.id} className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm">
                    {(() => {
                      const Icon = itemIcon(`${s.category ?? ""} ${s.name}`);
                      return (
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-agua-50 text-agua-600" aria-hidden>
                          <Icon className="h-6 w-6" />
                        </span>
                      );
                    })()}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-grafite">{s.name}</p>
                      <p className="text-xs text-grafite-500">
                        {quote ? "Sob orçamento" : priceLabel(Number(s.price), s.pricing_unit)}
                        {n > 0 && !quote && <span className="font-semibold text-agua-600"> · {formatBRL(n * Number(s.price))}</span>}
                      </p>
                    </div>
                    {quote ? (
                      session ? (
                        <Link to="/cliente" className="text-xs font-semibold text-agua-600" title="Peça um orçamento no Início">
                          <Megaphone className="inline h-4 w-4" aria-hidden /> Orçamento
                        </Link>
                      ) : null
                    ) : (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => step(s.id, -1)}
                          disabled={n === 0}
                          className="flex h-8 w-8 items-center justify-center rounded-full border border-grafite/15 text-grafite disabled:opacity-40"
                          aria-label={`Menos ${s.name}`}
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <span className="w-6 text-center text-sm font-semibold text-petroleo">{n}</span>
                        <button
                          type="button"
                          onClick={() => step(s.id, 1)}
                          className="flex h-8 w-8 items-center justify-center rounded-full border border-agua-600 text-agua-600"
                          aria-label={`Mais ${s.name}`}
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          {reviews.length > 0 && (
            <section className="rounded-2xl bg-white p-5 shadow-sm" data-testid="public-reviews">
              <h2 className="flex items-center gap-2 text-base font-semibold text-grafite">
                Avaliações <RatingBadge rating={avg != null ? Math.round(avg * 10) / 10 : null} count={reviews.length} />
              </h2>
              <ul className="mt-3 divide-y divide-grafite/5">
                {reviews.slice(0, 6).map((r) => (
                  <li key={r.id} className="py-3">
                    <div className="flex items-center gap-2">
                      <StarsDisplay value={Number(r.rating)} size={13} />
                      <span className="text-xs font-semibold text-grafite">{r.author}</span>
                      <span className="text-[11px] text-grafite-500">{new Date(r.created_at).toLocaleDateString("pt-BR")}</span>
                    </div>
                    {r.comment && <p className="mt-1 text-sm text-grafite">{r.comment}</p>}
                    {r.reply && <p className="mt-2 rounded-xl bg-nevoa px-3 py-2 text-xs text-grafite-500"><span className="font-semibold text-petroleo">Resposta da lavanderia:</span> {r.reply}</p>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <section className="rounded-2xl bg-white p-5 shadow-sm">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-petroleo">
                <MapPin className="h-4 w-4" aria-hidden /> Onde atende
              </h2>
              <p className="mt-2 text-sm text-grafite">{p.areas.join(", ") || p.municipality_name}</p>
            </section>
            {hours.length > 0 && (
              <section className="rounded-2xl bg-white p-5 shadow-sm">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-petroleo">
                  <Clock className="h-4 w-4" aria-hidden /> Horário
                </h2>
                <ul className="mt-2 space-y-1 text-sm text-grafite">
                  {hours.map(([k, v]) => (
                    <li key={k}>
                      <span className="text-grafite-500">{HOURS_LABEL[k] ?? k}:</span> {v}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      </div>

      {/* Barra do pedido */}
      <div
        className={cn("fixed inset-x-0 z-20 border-t border-grafite/10 bg-white px-4 py-3 shadow-[0_-8px_24px_rgba(16,44,53,0.08)]", session ? "bottom-[60px] sm:bottom-0" : "bottom-0")}
        data-testid="order-bar"
      >
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-grafite-500">Total {count > 0 ? `· ${count} ${count === 1 ? "item" : "itens"}` : ""}</p>
            <p className="text-lg font-bold text-petroleo" data-testid="bar-total">
              {formatBRL(total)}
            </p>
          </div>
          <a href={mapsUrl} target="_blank" rel="noreferrer" className={cn(buttonClass("outline"), "hidden sm:inline-flex")}>
            <Navigation className="h-4 w-4" aria-hidden /> Como chegar
          </a>
          {session ? (
            <button type="button" onClick={() => setHiring(true)} className={buttonClass()} data-testid="hire-button">
              {count > 0 ? "Continuar" : "Contratar"}
            </button>
          ) : (
            <Link to="/login" state={{ from: location.pathname }} className={buttonClass()}>
              Entrar para contratar
            </Link>
          )}
        </div>
      </div>

      {hiring && <HireModal provider={p} initialQty={qty} onClose={() => setHiring(false)} />}
    </PublicLayout>
  );
}
