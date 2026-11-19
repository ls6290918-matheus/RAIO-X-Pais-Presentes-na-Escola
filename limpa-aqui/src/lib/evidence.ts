import { supabase } from "@/lib/supabase";
import { compressPhoto } from "@/lib/photos";

export const EVIDENCE_BUCKET = "payment-evidence";

/** Envia a foto do comprovante para <empresa>/<pedido>/<id>.jpg (bucket privado) e devolve o caminho. */
export async function uploadEvidence(file: File, businessId: string, orderId: string) {
  const blob = await compressPhoto(file);
  const path = `${businessId}/${orderId}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from(EVIDENCE_BUCKET).upload(path, blob, { contentType: "image/jpeg" });
  if (error) throw new Error("Não foi possível enviar o comprovante. Verifique a conexão e tente de novo.");
  return path;
}
