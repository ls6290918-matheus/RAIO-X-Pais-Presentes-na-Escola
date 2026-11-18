import {
  Building2,
  Home,
  Package,
  Sparkles,
  Store,
  Truck,
  User,
  Users,
  HandHelping,
  Briefcase,
  type LucideIcon,
} from "lucide-react";
import type { BusinessSegment } from "@/lib/types";

/* ------------------------------------------------------------ Tipos do assistente */

export type Situation = "comecar_em_casa" | "autonomo" | "lavanderia" | "empresa_limpeza";
export type WeeklyOrders = "ate_10" | "11_50" | "51_200" | "mais_200";
export type Team = "sozinho" | "2_5" | "6_mais";

export type OpeningHours = { seg_sex: string; sab: string; dom: string };

/** Rascunho da identidade (etapa 5), salvo em onboarding_profiles.draft */
export type Draft = {
  name?: string;
  slug?: string;
  whatsapp?: string;
  email?: string;
  city?: string;
  state?: string;
  neighborhood?: string;
  street?: string;
  street_number?: string;
  complement?: string;
  postal_code?: string;
  lat?: number | null;
  lng?: number | null;
  place_id?: string | null;
  service_region?: string;
  opening_hours?: OpeningHours;
  logo_path?: string | null;
};

export type Answers = {
  situation: Situation | null;
  categories: string[];
  custom_categories: string[];
  operations: string[];
  has_clients: boolean | null;
  weekly_orders: WeeklyOrders | null;
  team: Team | null;
  has_prices: boolean | null;
  service_region: string;
  draft: Draft;
};

export const emptyAnswers = (): Answers => ({
  situation: null,
  categories: [],
  custom_categories: [],
  operations: [],
  has_clients: null,
  weekly_orders: null,
  team: null,
  has_prices: null,
  service_region: "",
  draft: {},
});

/* ------------------------------------------------------------ Opções */

export const SITUATIONS: Array<{ value: Situation; label: string; hint: string; icon: LucideIcon }> = [
  { value: "comecar_em_casa", label: "Quero começar meu negócio em casa", hint: "Estou dando os primeiros passos.", icon: Home },
  { value: "autonomo", label: "Já trabalho como autônomo", hint: "Atendo clientes por conta própria.", icon: User },
  { value: "lavanderia", label: "Tenho uma lavanderia", hint: "Tenho um ponto ou uma operação montada.", icon: Store },
  { value: "empresa_limpeza", label: "Tenho uma empresa de limpeza e higienização", hint: "Atendo com equipe e vários serviços.", icon: Building2 },
];

export const OPERATIONS: Array<{ value: string; label: string; icon: LucideIcon; exclusiveWith?: string }> = [
  { value: "trabalho_em_casa", label: "Trabalho em casa", icon: Home },
  { value: "estabelecimento", label: "Tenho estabelecimento comercial", icon: Store },
  { value: "recebe_na_residencia", label: "Recebo os itens na minha residência", icon: Package },
  { value: "busca_na_casa", label: "Busco os itens na casa dos clientes", icon: Truck },
  { value: "faz_entregas", label: "Faço entregas", icon: Truck },
  { value: "servico_na_casa_cliente", label: "Presto serviços na casa dos clientes", icon: HandHelping },
  { value: "com_funcionarios", label: "Trabalho com funcionários", icon: Users, exclusiveWith: "sozinho" },
  { value: "sozinho", label: "Trabalho sozinho", icon: Briefcase, exclusiveWith: "com_funcionarios" },
];

export const WEEKLY_ORDERS: Array<{ value: WeeklyOrders; label: string }> = [
  { value: "ate_10", label: "Até 10" },
  { value: "11_50", label: "11 a 50" },
  { value: "51_200", label: "51 a 200" },
  { value: "mais_200", label: "Mais de 200" },
];

export const TEAMS: Array<{ value: Team; label: string }> = [
  { value: "sozinho", label: "Sozinho(a)" },
  { value: "2_5", label: "2 a 5 pessoas" },
  { value: "6_mais", label: "6 ou mais" },
];

export const SEGMENT_LABEL: Record<BusinessSegment, { title: string; text: string }> = {
  iniciante: { title: "Começando", text: "Um painel com primeiros passos, calculadoras e o básico para atender bem." },
  profissional: { title: "Profissional", text: "Um painel focado em pedidos, clientes, serviços e entregas do dia a dia." },
  empresa: { title: "Empresa", text: "Um painel gerencial com equipe, pedidos, logística e indicadores." },
};

export const STEP_TITLES = [
  "Sua situação",
  "Seus serviços",
  "Seu atendimento",
  "Seu negócio hoje",
  "Identidade",
  "Resumo",
] as const;

export const CATEGORY_ICON: Record<string, LucideIcon> = { outros: Sparkles };

/* ------------------------------------------------------------ Prévia (mesmas regras do banco) */

export type CatalogCategory = { code: string; name: string; group_code: string; sort: number };
export type CatalogFeature = { code: string; name: string; description: string | null; status: "disponivel" | "em_breve"; sort: number };
export type CatalogRule = { trigger_type: "sempre" | "situacao" | "categoria" | "operacao" | "equipe"; trigger_value: string | null; feature_code: string };

/** Espelha o cálculo de segmento de apply_business_rules (o servidor é quem grava). */
export function previewSegment(a: Answers): BusinessSegment | null {
  switch (a.situation) {
    case "comecar_em_casa":
      return "iniciante";
    case "autonomo":
      return "profissional";
    case "lavanderia":
      return a.team === "2_5" || a.team === "6_mais" || a.operations.includes("com_funcionarios") ||
        a.weekly_orders === "51_200" || a.weekly_orders === "mais_200"
        ? "empresa"
        : "profissional";
    case "empresa_limpeza":
      return "empresa";
    default:
      return null;
  }
}

/** Recursos que as regras vão habilitar com as respostas atuais. */
export function previewFeatures(a: Answers, rules: CatalogRule[]) {
  const codes = new Set<string>();
  for (const r of rules) {
    const hit =
      r.trigger_type === "sempre" ||
      (r.trigger_type === "situacao" && r.trigger_value === a.situation) ||
      (r.trigger_type === "categoria" && r.trigger_value != null && a.categories.includes(r.trigger_value)) ||
      (r.trigger_type === "operacao" && r.trigger_value != null && a.operations.includes(r.trigger_value)) ||
      (r.trigger_type === "equipe" && r.trigger_value === a.team);
    if (hit) codes.add(r.feature_code);
  }
  return codes;
}
