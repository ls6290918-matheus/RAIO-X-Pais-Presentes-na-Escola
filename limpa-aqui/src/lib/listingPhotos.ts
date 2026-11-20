import { supabase } from "@/lib/supabase";
import { compressPhoto } from "@/lib/photos";

export const LISTING_BUCKET = "listing-photos";
export const MAX_LISTING_PHOTOS = 5;

export type ListingExtras = { listing_id: string; quantity: number | null; desired_date: string | null; photos: string[] };

/** Envia a foto para <anúncio>/<id>.jpg (bucket privado) e registra no anúncio. */
export async function uploadListingPhoto(file: File, listingId: string) {
  const blob = await compressPhoto(file);
  const path = `${listingId}/${crypto.randomUUID()}.jpg`;
  const up = await supabase.storage.from(LISTING_BUCKET).upload(path, blob, { contentType: "image/jpeg", cacheControl: "3600" });
  if (up.error) throw new Error("Não foi possível enviar a foto. Verifique a conexão e tente de novo.");
  const { error } = await supabase.from("listing_photos").insert({ listing_id: listingId, path });
  if (error) {
    await supabase.storage.from(LISTING_BUCKET).remove([path]);
    throw new Error(error.message.includes("5 fotos") ? "Cada anúncio pode ter até 5 fotos." : "Não foi possível salvar a foto.");
  }
  return path;
}

/** Quantidade, prazo e fotos (com links temporários) dos anúncios que a pessoa pode ver. */
export async function loadListingExtras(ids: string[]) {
  const out = new Map<string, ListingExtras & { urls: string[] }>();
  if (!ids.length) return out;
  const { data } = await supabase.rpc("listing_extras", { p_ids: ids });
  const rows = (data as ListingExtras[]) ?? [];
  const paths = rows.flatMap((r) => r.photos ?? []);
  const signed = new Map<string, string>();
  if (paths.length) {
    const { data: s } = await supabase.storage.from(LISTING_BUCKET).createSignedUrls(paths, 3600);
    (s ?? []).forEach((d) => d.path && d.signedUrl && signed.set(d.path, d.signedUrl));
  }
  rows.forEach((r) => out.set(r.listing_id, { ...r, urls: (r.photos ?? []).map((p) => signed.get(p)).filter(Boolean) as string[] }));
  return out;
}
