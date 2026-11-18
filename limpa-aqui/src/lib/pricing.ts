import type { PricingUnit } from "@/lib/types";
import { formatBRL } from "@/lib/format";

/** Rótulos das unidades de cobrança (enum pricing_unit no banco). */
export const PRICING_UNITS: Array<{ value: PricingUnit; label: string; short: string }> = [
  { value: "unidade", label: "Por unidade", short: "unidade" },
  { value: "par", label: "Por par", short: "par" },
  { value: "peca", label: "Por peça", short: "peça" },
  { value: "kg", label: "Por quilo", short: "kg" },
  { value: "conjunto", label: "Por conjunto", short: "conjunto" },
  { value: "m2", label: "Por m²", short: "m²" },
  { value: "orcamento", label: "Sob orçamento", short: "orçamento" },
];

export const unitShort = (u: PricingUnit) => PRICING_UNITS.find((p) => p.value === u)?.short ?? "unidade";

/** "R$ 40,00 / par" · "Sob orçamento" · "A partir de R$ 150,00" */
export function priceLabel(price: number, unit: PricingUnit) {
  if (unit === "orcamento") return Number(price) > 0 ? `A partir de ${formatBRL(price)}` : "Sob orçamento";
  return `${formatBRL(price)} / ${unitShort(unit)}`;
}
