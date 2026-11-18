/**
 * Convite pendente: guardado no navegador quando alguém abre o link do convite sem estar logado.
 * Depois de entrar (ou de confirmar o e-mail do cadastro), o app leva a pessoa de volta ao convite
 * em vez de mandar para o assistente de cadastro de lavanderia.
 */
const KEY = "limpaaqui.convite";

export function savePendingInvite(token: string) {
  try {
    localStorage.setItem(KEY, token);
  } catch {
    /* navegador sem armazenamento: a pessoa abre o link de novo */
  }
}

export function pendingInvite(): string | null {
  try {
    const t = localStorage.getItem(KEY);
    return t && /^[0-9a-f]{64}$/.test(t) ? t : null;
  } catch {
    return null;
  }
}

export function clearPendingInvite() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nada a fazer */
  }
}

export const inviteLink = (token: string) => `${window.location.origin}/convite/${token}`;
