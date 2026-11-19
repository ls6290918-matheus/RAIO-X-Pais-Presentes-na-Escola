import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Bike, Clock, MapPin, SearchX, Store, Wallet } from "lucide-react";
import { Button, Card, EmptyState, InlineLoader, buttonClass } from "@/components/shared/ui";
import { supabase } from "@/lib/supabase";
import { logoUrl } from "@/lib/logo";
import { priceLabel } from "@/lib/pricing";
import { PublicLayout } from "./PublicLayout";
import { HOURS_LABEL, PROVIDER_TYPE_LABEL, type PublicProvider } from "./types";

/** /p/:slug — perfil público de um prestador visível no marketplace. */
export default function ProviderPage() {
  const { slug = "" } = useParams();
  const [p, setP] = useState<PublicProvider | null | undefined>(undefined);

  useEffect(() => {
    void supabase.rpc("get_public_provider", { p_slug: slug }).then(({ data }) => setP((data as PublicProvider | null) ?? null));
  }, [slug]);

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

  return (
    <PublicLayout>
      <div className="space-y-6">
        <Link to="/buscar" className="inline-flex items-center gap-1 text-sm font-semibold text-petroleo hover:underline">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Voltar para a busca
        </Link>

        <Card className="p-6">
          <div className="flex flex-wrap items-start gap-4">
            {p.logo_path ? (
              <img src={logoUrl(p.logo_path) ?? undefined} alt="" className="h-16 w-16 shrink-0 rounded-2xl object-cover" />
            ) : (
              <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-petroleo text-agua">
                <Store className="h-7 w-7" aria-hidden />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-semibold tracking-tight text-petroleo">{p.name}</h1>
              <p className="text-sm text-grafite-500">
                {p.provider_type ? PROVIDER_TYPE_LABEL[p.provider_type] : "Prestador"} · {[p.neighborhood, p.municipality_name].filter(Boolean).join(", ")}
              </p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                {p.offers_pickup && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-agua-50 px-2.5 py-1 font-semibold text-petroleo">
                    <Bike className="h-3.5 w-3.5" aria-hidden /> Faz coleta e entrega
                  </span>
                )}
                {p.accepts_direct_payment && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-nevoa px-2.5 py-1 font-semibold text-grafite-500">
                    <Wallet className="h-3.5 w-3.5" aria-hidden /> Pagamento direto ao prestador
                  </span>
                )}
              </div>
            </div>
          </div>
          {p.public_description && <p className="mt-4 whitespace-pre-line text-sm text-grafite">{p.public_description}</p>}
          <div className="mt-5 rounded-xl bg-nevoa p-4">
            <Button disabled block>
              Contratar
            </Button>
            <p className="mt-2 text-center text-xs text-grafite-500">A contratação pelo Limpa Aqui chega na próxima atualização.</p>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <h2 className="px-6 pt-5 text-base font-semibold text-petroleo">Serviços e preços</h2>
          <ul className="mt-3 divide-y divide-grafite/5" data-testid="public-services">
            {p.services.map((s, i) => (
              <li key={i} className="flex flex-wrap items-start gap-3 px-6 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-grafite">{s.name}</p>
                  <p className="text-xs text-grafite-500">{[s.category, s.description].filter(Boolean).join(" · ")}</p>
                </div>
                <span className="text-sm font-semibold text-petroleo">{priceLabel(Number(s.price), s.pricing_unit)}</span>
              </li>
            ))}
          </ul>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="p-6">
            <h2 className="flex items-center gap-2 text-base font-semibold text-petroleo">
              <MapPin className="h-5 w-5" aria-hidden /> Onde atende
            </h2>
            <p className="mt-2 text-sm text-grafite">{p.areas.join(", ") || p.municipality_name}</p>
          </Card>
          {hours.length > 0 && (
            <Card className="p-6">
              <h2 className="flex items-center gap-2 text-base font-semibold text-petroleo">
                <Clock className="h-5 w-5" aria-hidden /> Horário
              </h2>
              <ul className="mt-2 space-y-1 text-sm text-grafite">
                {hours.map(([k, v]) => (
                  <li key={k}>
                    <span className="text-grafite-500">{HOURS_LABEL[k] ?? k}:</span> {v}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </PublicLayout>
  );
}
