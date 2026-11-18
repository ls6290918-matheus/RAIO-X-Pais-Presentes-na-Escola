export const TIMEZONE = "America/Sao_Paulo";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const formatBRL = (value: number | string | null | undefined) =>
  brl.format(Number(value ?? 0));

export const formatDate = (iso: string | Date) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: TIMEZONE, dateStyle: "short" }).format(
    typeof iso === "string" ? new Date(iso) : iso,
  );

export const onlyDigits = (v: string) => v.replace(/\D/g, "");

/** (11) 98888-7777 / (11) 3333-4444 */
export function maskPhone(value: string) {
  const d = onlyDigits(value).slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** "Lavanderia do João!" -> "lavanderia-do-joao" */
export function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40)
    .replace(/-$/g, "");
}

/** Link wa.me com DDI do Brasil */
export function whatsappLink(phoneDigits: string, message?: string) {
  const d = onlyDigits(phoneDigits);
  const full = d.startsWith("55") && d.length > 11 ? d : `55${d}`;
  const text = message ? `?text=${encodeURIComponent(message)}` : "";
  return `https://wa.me/${full}${text}`;
}

export const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
  "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;

export const PUBLIC_DOMAIN = "limpaaqui.com.br";
