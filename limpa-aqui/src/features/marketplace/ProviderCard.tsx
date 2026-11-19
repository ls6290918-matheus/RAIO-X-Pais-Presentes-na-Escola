import { Link } from "react-router-dom";
import { Bike, MapPin, Sparkles, Store } from "lucide-react";
import { cn } from "@/components/shared/ui";
import { formatBRL } from "@/lib/format";
import { logoUrl } from "@/lib/logo";
import { formatKm, type SearchResult } from "./types";

/** Capa do prestador: o logotipo sobre um fundo da marca (ou o ícone, sem logotipo). */
export function ProviderCover({ logo, name, className }: { logo: string | null; name: string; className?: string }) {
  const url = logo ? logoUrl(logo) : null;
  return (
    <div className={cn("relative flex items-center justify-center overflow-hidden bg-gradient-to-br from-agua-50 via-white to-agua/30", className)}>
      {url ? (
        <img src={url} alt={`Logotipo de ${name}`} className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-petroleo text-agua shadow-sm">
          <Store className="h-7 w-7" aria-hidden />
        </span>
      )}
    </div>
  );
}

/** Cartão de lavanderia (lista "perto de você" e resultados da busca). */
export function ProviderCard({ r, compact = false }: { r: SearchResult; compact?: boolean }) {
  return (
    <Link
      to={`/p/${r.slug}`}
      className={cn("group flex flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-grafite/5 transition hover:shadow-md", compact ? "w-56 shrink-0" : "")}
      data-testid="provider-card"
    >
      <div className="relative">
        <ProviderCover logo={r.logo_path} name={r.name} className={compact ? "h-28" : "h-36"} />
        {r.featured && (
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
            <Sparkles className="h-3 w-3" aria-hidden /> Destaque
          </span>
        )}
        {r.offers_pickup && (
          <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-semibold text-petroleo">
            <Bike className="h-3 w-3" aria-hidden /> Coleta
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col p-3">
        <p className="truncate text-sm font-semibold text-grafite">{r.name}</p>
        <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-grafite-500">
          <MapPin className="h-3 w-3 shrink-0 text-agua-600" aria-hidden />
          {r.distance_km != null ? formatKm(r.distance_km) : [r.neighborhood, r.municipality_name].filter(Boolean).join(", ")}
        </p>
        {!compact && r.categories.length > 0 && <p className="mt-1 line-clamp-1 text-xs text-grafite-500">{r.categories.join(" · ")}</p>}
        <p className="mt-auto pt-2 text-sm font-bold text-petroleo">
          {r.min_price != null ? (
            <>
              <span className="text-xs font-normal text-grafite-500">a partir de </span>
              {formatBRL(r.min_price)}
            </>
          ) : (
            <span className="text-xs font-semibold text-grafite-500">Sob orçamento</span>
          )}
        </p>
      </div>
    </Link>
  );
}
