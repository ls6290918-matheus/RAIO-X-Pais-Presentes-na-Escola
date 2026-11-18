/**
 * Contas das calculadoras. São estimativas feitas só com os números que a pessoa informa —
 * não há nenhum valor de mercado embutido e nenhuma promessa de lucro.
 */

/** Valor da hora = (quanto quer tirar no mês + custos fixos do mês) ÷ horas trabalhadas no mês. */
export function hourValue(i: { incomeGoal: number; fixedCosts: number; hoursPerDay: number; daysPerMonth: number }) {
  const hours = i.hoursPerDay * i.daysPerMonth;
  if (!(hours > 0)) return null;
  return round2((i.incomeGoal + i.fixedCosts) / hours);
}

export type CostInputs = {
  products: number;
  water: number;
  energy: number;
  packaging: number;
  other: number;
  minutes: number;
  hourly: number;
  marginPct: number;
  cardFeePct: number;
};

export type CostResult = {
  materials: number;
  labor: number;
  total: number;
  /** Preço para cobrir o custo total, a taxa da maquininha e ainda sobrar a margem escolhida (sobre o preço). */
  suggested: number | null;
  /** Mesmo preço, arredondado para cima no próximo ",90". */
  rounded: number | null;
};

export function serviceCost(i: CostInputs): CostResult {
  const materials = round2(i.products + i.water + i.energy + i.packaging + i.other);
  const labor = round2((i.minutes / 60) * i.hourly);
  const total = round2(materials + labor);
  const share = (i.marginPct + i.cardFeePct) / 100;
  const suggested = share < 0.95 && total > 0 ? round2(total / (1 - share)) : null;
  return { materials, labor, total, suggested, rounded: suggested == null ? null : roundUp90(suggested) };
}

/**
 * Quanto sobra de um preço depois de pagar o custo e a taxa da maquininha, em reais e em % do preço.
 * Ex.: preço 60, custo 30, taxa 3% → sobra 60 − 30 − 1,80 = 28,20 (47% do preço).
 */
export function marginOf(price: number, totalCost: number, cardFeePct: number) {
  if (!(price > 0)) return null;
  const left = round2(price - totalCost - (price * cardFeePct) / 100);
  return { left, pct: Math.round((left / price) * 1000) / 10 };
}

/** 47,32 → 47,90 · 47,95 → 48,90 · 10 → 10,90 */
export function roundUp90(v: number) {
  const base = Math.floor(v);
  const c = base + 0.9;
  return round2(c >= v - 1e-9 ? c : c + 1);
}

export const round2 = (v: number) => Math.round(v * 100) / 100;
