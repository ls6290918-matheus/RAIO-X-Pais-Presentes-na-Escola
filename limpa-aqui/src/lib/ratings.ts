import { supabase } from "@/lib/supabase";

export type Rating = { rating: number; reviews: number };

/** Médias públicas por slug (busca, perfil, propostas). */
export async function loadRatings(slugs: string[]) {
  const out = new Map<string, Rating>();
  const uniq = [...new Set(slugs.filter(Boolean))];
  if (!uniq.length) return out;
  const { data } = await supabase.rpc("provider_ratings", { p_slugs: uniq });
  for (const r of (data as Array<{ slug: string; rating: number; reviews: number }>) ?? []) out.set(r.slug, { rating: Number(r.rating), reviews: Number(r.reviews) });
  return out;
}
