import { useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, BedDouble, Footprints, Layers, Search, Shirt, Sofa, Sparkles, SprayCan, Wind, type LucideIcon } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "./ui";

/* ------------------------------------------------------------ categorias da home */

/** As 8 entradas visuais da home e a categoria do catálogo de cada uma (só aparecem se a categoria estiver ativa). */
export const HOME_CATEGORIES: Array<{ label: string; code: string; icon: LucideIcon }> = [
  { label: "Roupas", code: "lavagem_roupas", icon: Shirt },
  { label: "Tênis", code: "lavagem_tenis", icon: Footprints },
  { label: "Sapatos", code: "limpeza_sapatos", icon: Footprints },
  { label: "Tapetes", code: "lavagem_tapetes", icon: Layers },
  { label: "Cortinas", code: "limpeza_cortinas", icon: Wind },
  { label: "Estofados", code: "higienizacao_sofas", icon: Sofa },
  { label: "Higienização", code: "higienizacao_calcados", icon: SprayCan },
  { label: "Outros", code: "outros", icon: Sparkles },
];

/** Ícone de qualquer categoria pelo código (para sugestões da busca). */
export function categoryIcon(code: string): LucideIcon {
  return HOME_CATEGORIES.find((c) => c.code === code)?.icon ?? (/edredo|cobertor|colch/.test(code) ? BedDouble : Sparkles);
}

/** Card de categoria: ícone grande em fundo claro e o nome embaixo. */
export function CategoryTile({ to, label, icon: Icon }: { to: string; label: string; icon: LucideIcon }) {
  return (
    <Link to={to} className="group flex flex-col items-center gap-1.5 text-center" data-testid="category-tile">
      <span className="flex aspect-square w-full max-w-[76px] items-center justify-center rounded-2xl bg-agua-50 text-petroleo ring-1 ring-agua/20 transition group-hover:bg-agua/20 group-active:scale-95">
        <Icon className="h-7 w-7" strokeWidth={1.6} aria-hidden />
      </span>
      <span className="text-[11px] font-semibold leading-tight text-grafite sm:text-xs">{label}</span>
    </Link>
  );
}

/* ------------------------------------------------------------ busca */

/**
 * Busca da home: procura nas categorias do catálogo enquanto a pessoa digita
 * e leva para /buscar já filtrado. Enter escolhe a primeira sugestão.
 */
export function ServiceSearch({ categories, municipalityId, placeholder = "Qual serviço você precisa hoje?" }: {
  categories: Array<{ code: string; name: string }>;
  municipalityId?: number | null;
  placeholder?: string;
}) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const matches = useMemo(() => {
    const k = norm(q.trim());
    if (!k) return categories.slice(0, 6);
    return categories.filter((c) => norm(c.name).includes(k) || k.split(/\s+/).every((w) => norm(c.name).includes(w))).slice(0, 6);
  }, [q, categories]);
  const href = (code?: string) => {
    const p = new URLSearchParams();
    if (municipalityId) p.set("m", String(municipalityId));
    if (code) p.set("c", code);
    const s = p.toString();
    return s ? `/buscar?${s}` : "/buscar";
  };

  return (
    <div
      ref={box}
      className="relative"
      onBlur={(e) => {
        if (!box.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          navigate(href(q.trim() ? matches[0]?.code : undefined));
        }}
        className="flex items-center gap-2 rounded-2xl bg-white px-4 shadow-card ring-1 ring-grafite/10 focus-within:ring-2 focus-within:ring-agua"
      >
        <Search className="h-5 w-5 shrink-0 text-grafite-500" aria-hidden />
        <input
          type="search"
          value={q}
          onChange={(e) => (setQ(e.target.value), setOpen(true))}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="h-12 min-w-0 flex-1 bg-transparent text-[15px] text-grafite placeholder:text-grafite-500 focus:outline-none"
          data-testid="home-search"
        />
      </form>
      {open && (
        <ul className="absolute inset-x-0 top-14 z-20 overflow-hidden rounded-2xl bg-white py-1 shadow-card ring-1 ring-grafite/10" role="listbox" data-testid="search-suggestions">
          {matches.length === 0 ? (
            <li className="px-4 py-3 text-sm text-grafite-500">Nenhum serviço com esse nome. Tente "tênis", "tapete" ou "roupas".</li>
          ) : (
            matches.map((c) => {
              const Icon = categoryIcon(c.code);
              return (
                <li key={c.code}>
                  <Link to={href(c.code)} className="flex items-center gap-3 px-4 py-2.5 text-sm text-grafite hover:bg-nevoa" role="option" aria-selected={false}>
                    <Icon className="h-4 w-4 text-agua-600" aria-hidden /> {c.name}
                  </Link>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ banners */

export type Banner = { id: string; title: string; subtitle: string | null; image_path: string | null; link_path: string | null; tone: "petroleo" | "agua" | "claro" };

export const bannerImageUrl = (path: string) => supabase.storage.from("banners").getPublicUrl(path).data.publicUrl;

const TONE: Record<Banner["tone"], string> = {
  petroleo: "bg-gradient-to-br from-petroleo-600 to-petroleo text-white",
  agua: "bg-gradient-to-br from-agua to-[#2FAE9B] text-petroleo",
  claro: "bg-agua-50 text-petroleo ring-1 ring-agua/30",
};

function BannerCard({ b }: { b: Banner }) {
  const body: ReactNode = (
    <div className={cn("relative flex h-36 w-full overflow-hidden rounded-3xl p-5 sm:h-40", TONE[b.tone])}>
      {b.image_path && <img src={bannerImageUrl(b.image_path)} alt="" className="absolute inset-y-0 right-0 h-full w-1/2 object-cover" loading="lazy" />}
      {b.image_path && <span className={cn("absolute inset-y-0 right-1/2 w-16 translate-x-full", b.tone === "petroleo" ? "bg-gradient-to-r from-petroleo" : "bg-gradient-to-r from-agua-50")} aria-hidden />}
      <div className={cn("relative flex flex-col justify-between", b.image_path ? "w-1/2 pr-2" : "w-full")}>
        <div>
          <p className="text-lg font-bold leading-tight">{b.title}</p>
          {b.subtitle && <p className="mt-1 text-xs opacity-80">{b.subtitle}</p>}
        </div>
        {b.link_path && (
          <span className="inline-flex items-center gap-1 text-xs font-semibold">
            Ver agora <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </span>
        )}
      </div>
    </div>
  );
  return b.link_path ? <Link to={b.link_path}>{body}</Link> : body;
}

/** Carrossel horizontal de banners (rolagem com encaixe; some se não houver banner). */
export function BannerCarousel({ banners }: { banners: Banner[] }) {
  const [idx, setIdx] = useState(0);
  if (banners.length === 0) return null;
  return (
    <section aria-label="Destaques" data-testid="banners">
      <div
        className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0"
        onScroll={(e) => {
          const el = e.currentTarget;
          setIdx(Math.round(el.scrollLeft / Math.max(1, el.scrollWidth / banners.length)));
        }}
      >
        {banners.map((b) => (
          <div key={b.id} className={cn("shrink-0 snap-start", banners.length === 1 ? "w-full" : "w-[86%] sm:w-[48%]")}>
            <BannerCard b={b} />
          </div>
        ))}
      </div>
      {banners.length > 1 && (
        <div className="mt-2 flex justify-center gap-1.5" aria-hidden>
          {banners.map((b, i) => (
            <span key={b.id} className={cn("h-1.5 rounded-full transition-all", i === idx ? "w-4 bg-petroleo" : "w-1.5 bg-grafite/20")} />
          ))}
        </div>
      )}
    </section>
  );
}
