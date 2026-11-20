import { CalendarDays, Hash } from "lucide-react";
import type { ListingExtras } from "@/lib/listingPhotos";

const DATE = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", timeZone: "UTC" });

/** Quantidade, prazo desejado e miniaturas das fotos de um anúncio (só o que existir). */
export function ListingExtrasView({ extras }: { extras?: ListingExtras & { urls: string[] } }) {
  if (!extras || (!extras.quantity && !extras.desired_date && extras.urls.length === 0)) return null;
  return (
    <div className="mt-3 space-y-2" data-testid="listing-extras">
      {(extras.quantity || extras.desired_date) && (
        <div className="flex flex-wrap gap-2 text-xs">
          {extras.quantity && (
            <span className="inline-flex items-center gap-1 rounded-full bg-nevoa px-2.5 py-1 font-semibold text-grafite">
              <Hash className="h-3.5 w-3.5" aria-hidden /> {extras.quantity} {extras.quantity === 1 ? "item" : "itens"}
            </span>
          )}
          {extras.desired_date && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 font-semibold text-amber-800">
              <CalendarDays className="h-3.5 w-3.5" aria-hidden /> Para {DATE.format(new Date(`${extras.desired_date}T00:00:00Z`))}
            </span>
          )}
        </div>
      )}
      {extras.urls.length > 0 && (
        <div className="flex gap-2 overflow-x-auto">
          {extras.urls.map((u, i) => (
            <a key={u} href={u} target="_blank" rel="noreferrer" className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-nevoa">
              <img src={u} alt={`Foto ${i + 1} do anúncio`} className="h-full w-full object-cover" loading="lazy" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
