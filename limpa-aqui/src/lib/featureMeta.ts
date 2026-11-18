import {
  BarChart3,
  Calculator,
  CalendarDays,
  Camera,
  ClipboardCheck,
  FileText,
  Footprints,
  Gauge,
  Globe,
  PackageOpen,
  Ruler,
  Route,
  Shirt,
  Sparkles,
  Users,
  UsersRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";

/** Ícone e rótulo curto de cada recurso (o nome completo e o status vêm do banco). */
export const FEATURE_META: Record<string, { icon: LucideIcon; menuLabel?: string }> = {
  pedidos: { icon: PackageOpen },
  clientes: { icon: Users },
  servicos: { icon: Sparkles },
  entregas: { icon: Route, menuLabel: "Entregas" },
  checklist: { icon: ClipboardCheck },
  campos_calcado: { icon: Footprints },
  catalogo_roupas: { icon: Shirt },
  dimensoes_item: { icon: Ruler },
  orcamento: { icon: FileText },
  fotos: { icon: Camera },
  calculadoras: { icon: Calculator, menuLabel: "Calculadoras" },
  equipe: { icon: UsersRound },
  agenda: { icon: CalendarDays },
  financeiro: { icon: Wallet },
  relatorios: { icon: BarChart3 },
  pagina_publica: { icon: Globe, menuLabel: "Página pública" },
  indicadores: { icon: Gauge, menuLabel: "Indicadores" },
};

export const featureIcon = (code: string) => FEATURE_META[code]?.icon ?? Sparkles;

/** Recursos que viram item de menu, nesta ordem. Os demais funcionam dentro de outras telas (ex.: fotos no pedido). */
export const MENU_FEATURES = [
  "pedidos",
  "entregas",
  "clientes",
  "servicos",
  "calculadoras",
  "equipe",
  "agenda",
  "financeiro",
  "relatorios",
  "indicadores",
  "pagina_publica",
];

/** Painel de antes do assistente: o que aparecia como "Em breve" no menu. */
export const LEGACY_SOON = ["financeiro", "agenda", "pagina_publica"];
