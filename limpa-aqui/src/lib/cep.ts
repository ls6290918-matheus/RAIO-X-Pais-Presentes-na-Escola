import { onlyDigits } from "@/lib/format";

export type CepResult = { street: string; neighborhood: string; city: string; state: string };

/**
 * Busca o endereço de um CEP no ViaCEP (serviço público, sem chave).
 * Devolve null se o CEP não existir; lança erro se o serviço não responder.
 */
export async function lookupCep(cep: string): Promise<CepResult | null> {
  const d = onlyDigits(cep);
  if (d.length !== 8) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`https://viacep.com.br/ws/${d}/json/`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`ViaCEP ${res.status}`);
    const j = (await res.json()) as { erro?: boolean | string; logradouro?: string; bairro?: string; localidade?: string; uf?: string };
    if (j.erro) return null;
    return { street: j.logradouro ?? "", neighborhood: j.bairro ?? "", city: j.localidade ?? "", state: (j.uf ?? "").toUpperCase() };
  } finally {
    clearTimeout(timer);
  }
}
