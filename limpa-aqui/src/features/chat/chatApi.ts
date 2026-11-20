import { supabase } from "@/lib/supabase";
import { compressPhoto } from "@/lib/photos";
import { friendlyError } from "@/lib/errors";

export const CHAT_BUCKET = "chat-images";

export type Conversation = {
  id: string;
  kind: "pedido" | "anuncio";
  subject: string;
  counterpart: string;
  listing_id: string | null;
  order_id: string | null;
  last_message: string | null;
  last_message_at: string | null;
  last_mine: boolean | null;
  unread: number;
  blocked: boolean;
};

export type Message = { id: string; sender_id: string; mine: boolean; body: string | null; image_path: string | null; created_at: string };

/** Abre (ou reabre) a conversa e devolve o id; em caso de erro, devolve a mensagem amigável. */
export async function openConversation(
  kind: "proposta" | "pedido" | "anuncio",
  args: { proposalId?: string; orderId?: string; listingId?: string; businessId?: string },
): Promise<{ id?: string; error?: string }> {
  const r =
    kind === "proposta"
      ? await supabase.rpc("open_proposal_conversation", { p_proposal_id: args.proposalId })
      : kind === "pedido"
        ? await supabase.rpc("open_order_conversation", { p_order_id: args.orderId })
        : await supabase.rpc("open_listing_conversation", { p_listing_id: args.listingId, p_business_id: args.businessId });
  return r.error ? { error: friendlyError(r.error) } : { id: r.data as string };
}

/** Envia a imagem para <conversa>/<id>.jpg (bucket privado) e devolve o caminho. */
export async function uploadChatImage(file: File, conversationId: string) {
  const blob = await compressPhoto(file);
  const path = `${conversationId}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from(CHAT_BUCKET).upload(path, blob, { contentType: "image/jpeg", cacheControl: "3600" });
  if (error) throw new Error("Não foi possível enviar a imagem. Verifique a conexão e tente de novo.");
  return path;
}

export async function signedChatUrls(paths: string[]) {
  const out = new Map<string, string>();
  if (!paths.length) return out;
  const { data } = await supabase.storage.from(CHAT_BUCKET).createSignedUrls(paths, 3600);
  (data ?? []).forEach((d) => d.path && d.signedUrl && out.set(d.path, d.signedUrl));
  return out;
}
