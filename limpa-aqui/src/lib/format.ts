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

/* ------------------------------------------------------------ Datas sem hora
 * Colunas "date" do banco chegam como "2026-11-20". new Date("2026-11-20") é meia-noite UTC,
 * que no Brasil vira o dia anterior; por isso estas funções tratam a data como texto. */

/** Hoje no fuso da lavanderia, como "AAAA-MM-DD". */
export function todayISO(timeZone = TIMEZONE) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(),
  );
}

/** "2026-11-20" + 3 dias -> "2026-11-23" */
export function addDaysISO(isoDate: string, days: number) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** "2026-11-20" -> "20/11/2026" */
export function formatDay(isoDate: string) {
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y}`;
}

/** "2026-11-20" -> "sex., 20/11" */
export function formatDayShort(isoDate: string) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const weekday = new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
  return `${weekday}, ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
}

/** Data e hora curtas no fuso da lavanderia: "20/11/2026 14:30" */
export const formatDateTime = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: TIMEZONE, dateStyle: "short", timeStyle: "short" }).format(
    new Date(iso),
  );

/* ------------------------------------------------------------ Dinheiro */

/** "1.234,50" | "70,5" | "70.50" -> 1234.5 / 70.5 / 70.5 ; inválido -> NaN */
export function parseMoney(value: string) {
  const v = value.trim().replace(/[R$\s]/g, "");
  if (!v) return NaN;
  const normalized = v.includes(",") ? v.replace(/\./g, "").replace(",", ".") : v;
  return /^\d+(\.\d{1,2})?$/.test(normalized) ? Number(normalized) : NaN;
}

/** 70.5 -> "70,50" (para preencher campos de valor) */
export const moneyInput = (value: number | string) => Number(value).toFixed(2).replace(".", ",");

/** Limpa o texto de busca: remove caracteres com significado nos filtros do PostgREST (vírgula, parênteses, %, _). */
export const searchTerm = (q: string) => q.trim().replace(/[%_,()\\]/g, " ").replace(/\s+/g, " ");
