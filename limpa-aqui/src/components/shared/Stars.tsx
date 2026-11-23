import { Star } from "lucide-react";
import { cn } from "./ui";

/** Nota com estrela (só aparece com avaliação real). Ex.: ★ 4,8 (12) */
export function RatingBadge({ rating, count, className }: { rating: number | null | undefined; count?: number | null; className?: string }) {
  if (rating == null || !count) return null;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-semibold text-grafite", className)} data-testid="rating-badge" aria-label={`Nota ${rating} de 5, ${count} avaliações`}>
      <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-hidden />
      {Number(rating).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
      <span className="font-normal text-grafite-500">({count})</span>
    </span>
  );
}

/** Estrelas fixas (exibição). */
export function StarsDisplay({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`${value} de 5 estrelas`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} style={{ width: size, height: size }} className={i <= Math.round(value) ? "fill-amber-400 text-amber-400" : "text-grafite/20"} aria-hidden />
      ))}
    </span>
  );
}

/** Escolha de 1 a 5 estrelas. */
export function StarsInput({ value, onChange, label, size = 32 }: { value: number; onChange: (v: number) => void; label: string; size?: number }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex gap-1">
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          role="radio"
          aria-checked={value === i}
          aria-label={`${i} ${i === 1 ? "estrela" : "estrelas"}`}
          onClick={() => onChange(i)}
          className="rounded-md p-0.5 transition active:scale-90"
        >
          <Star style={{ width: size, height: size }} className={i <= value ? "fill-amber-400 text-amber-400" : "text-grafite/25"} />
        </button>
      ))}
    </div>
  );
}
