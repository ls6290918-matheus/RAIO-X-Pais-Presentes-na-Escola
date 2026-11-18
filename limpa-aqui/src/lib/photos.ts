import { supabase } from "@/lib/supabase";

export const PHOTO_BUCKET = "order-photos";
export const MAX_PHOTOS = 12;
const MAX_SIDE = 1600;

/**
 * Reduz a foto para no máximo 1600 px no lado maior e converte em JPEG (~200–400 KB):
 * leve para enviar pelo 4G e boa o bastante para mostrar o antes e depois.
 */
export async function compressPhoto(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("Escolha uma imagem.");
  if (file.size > 25 * 1024 * 1024) throw new Error("Imagem muito grande (máximo de 25 MB).");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("Não foi possível abrir esta imagem. Tente uma foto JPG ou PNG.");
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
  if (!blob) throw new Error("Não foi possível processar a imagem.");
  return blob;
}

/** Envia para <empresa>/<pedido>/<id>.jpg e devolve o caminho no bucket privado. */
export async function uploadOrderPhoto(file: File, businessId: string, orderId: string) {
  const blob = await compressPhoto(file);
  const path = `${businessId}/${orderId}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: "image/jpeg", cacheControl: "3600" });
  if (error) throw new Error("Não foi possível enviar a foto. Verifique a conexão e tente de novo.");
  return path;
}

/** Links temporários (1 hora) para mostrar fotos do bucket privado. */
export async function signedPhotoUrls(paths: string[]) {
  if (!paths.length) return new Map<string, string>();
  const { data } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 3600);
  return new Map<string, string>((data ?? []).filter((d) => d.signedUrl && d.path).map((d) => [d.path!, d.signedUrl as string]));
}

export async function removeOrderPhotoFile(path: string) {
  await supabase.storage.from(PHOTO_BUCKET).remove([path]);
}
