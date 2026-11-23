import { useCallback, useRef } from "react";

/** Gera um identificador único (UUID v4). */
export function newRequestKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Erro de rede: o pedido pode ter sido criado sem a resposta chegar. */
export const isNetworkError = (err: unknown) => /failed to fetch|network|load failed|timeout/i.test((err as { message?: string })?.message ?? "");

/**
 * Chave de idempotência de uma operação (ex.: contratar, criar pedido).
 * - A mesma tentativa (mesmo conteúdo) reutiliza a mesma chave: repetir depois de um erro de rede
 *   devolve o pedido original em vez de criar outro.
 * - Se o conteúdo muda, é outra operação e ganha uma chave nova.
 * - Depois de um sucesso, `done()` descarta a chave.
 * - `begin()` bloqueia o segundo clique antes mesmo de a tela atualizar.
 */
export function useIdempotentRequest(payload: unknown) {
  const current = useRef<{ sig: string; key: string } | null>(null);
  const running = useRef(false);
  const sig = JSON.stringify(payload ?? null);

  const key = useCallback(() => {
    if (!current.current || current.current.sig !== sig) current.current = { sig, key: newRequestKey() };
    return current.current.key;
  }, [sig]);

  /** true se pode enviar; false se já há um envio em andamento. */
  const begin = useCallback(() => {
    if (running.current) return false;
    running.current = true;
    return true;
  }, []);
  const end = useCallback(() => {
    running.current = false;
  }, []);
  const done = useCallback(() => {
    current.current = null;
    running.current = false;
  }, []);

  return { key, begin, end, done };
}
