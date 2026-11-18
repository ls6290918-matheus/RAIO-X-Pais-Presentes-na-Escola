/** Converte erros do Supabase em mensagens claras em português. */
export function friendlyError(err: unknown): string {
  const e = err as { message?: string; code?: string; status?: number } | null;
  const msg = e?.message ?? "";

  // Restrições do banco com nome conhecido
  const constraints: Array<[RegExp, string]> = [
    [/customers_business_whatsapp_uq/, "Já existe um cliente com este WhatsApp."],
    [/orders_business_id_customer_id_fkey/, "Este cliente tem pedidos e não pode ser excluído."],
  ];
  for (const [re, text] of constraints) if (re.test(msg) || re.test((e as { details?: string })?.details ?? "")) return text;
  if (e?.code === "42501") return "Você não tem permissão para fazer isso.";

  // Mensagens já escritas em português pelas funções do banco (RAISE EXCEPTION)
  if (e?.code && ["P0001", "22023", "23505", "28000"].includes(e.code) && msg) return msg;

  const map: Array<[RegExp, string]> = [
    [/invalid login credentials/i, "E-mail ou senha incorretos."],
    [/email not confirmed/i, "Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada."],
    [/user already registered/i, "Já existe uma conta com este e-mail."],
    [/password should be at least/i, "A senha precisa ter pelo menos 8 caracteres."],
    [/rate limit|too many requests/i, "Muitas tentativas. Aguarde alguns minutos e tente novamente."],
    [/same password/i, "A nova senha precisa ser diferente da anterior."],
    [/failed to fetch|network/i, "Sem conexão com o servidor. Verifique sua internet."],
    [/jwt|session/i, "Sua sessão expirou. Entre novamente."],
  ];
  for (const [re, text] of map) if (re.test(msg)) return text;
  return msg || "Algo deu errado. Tente novamente.";
}
