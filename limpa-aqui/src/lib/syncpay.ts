import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export type PixCharge = { pix_code: string; amount: number; created_at: string; reused: boolean };
export type CheckoutResult = PixCharge | { needs_cpf: true; amount: number };

/** Chama a função do servidor que fala com a SyncPay. Devolve a mensagem de erro já pronta para a tela. */
export async function syncpay<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("syncpay", { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const j = await error.context.json().catch(() => null);
      throw new Error(typeof j?.error === "string" ? j.error : "Não foi possível falar com o pagamento agora. Tente de novo.");
    }
    throw new Error("Sem conexão com o pagamento agora. Confira sua internet e tente de novo.");
  }
  return data as T;
}

export function maskCpf(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 11);
  return d.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
}

export function isValidCpf(value: string) {
  const cpf = value.replace(/\D/g, "");
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const digit = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}
