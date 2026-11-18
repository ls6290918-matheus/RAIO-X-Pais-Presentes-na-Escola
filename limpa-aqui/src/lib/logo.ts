import { supabase } from "@/lib/supabase";

const BUCKET = "logos";
const MAX_SIDE = 512;
const ACCEPTED = ["image/png", "image/jpeg", "image/webp"];

/** URL pública do logotipo guardado em businesses.logo_path. */
export function logoUrl(path: string | null | undefined) {
  if (!path) return null;
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Reduz a imagem para no máximo 512 px e converte em WebP (fica leve para o celular). */
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.88));
  if (!blob) throw new Error("Não foi possível processar a imagem.");
  return blob;
}

/**
 * Envia o logotipo para logos/<id do usuário>/logo-<data>.webp e devolve o caminho.
 * O Storage só aceita gravação dentro da pasta do próprio usuário (regra no banco).
 */
export async function uploadLogo(file: File, userId: string) {
  if (!ACCEPTED.includes(file.type)) throw new Error("Envie uma imagem PNG, JPG ou WebP.");
  if (file.size > 8 * 1024 * 1024) throw new Error("Imagem muito grande (máximo de 8 MB).");
  const blob = await shrink(file);
  const path = `${userId}/logo-${Date.now()}.webp`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: "image/webp", cacheControl: "31536000" });
  if (error) throw new Error("Não foi possível enviar o logotipo. Tente de novo.");
  return path;
}
