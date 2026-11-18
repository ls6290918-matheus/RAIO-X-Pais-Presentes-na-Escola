import type { PricingUnit, Service } from "@/lib/types";
import { moneyInput, parseMoney } from "@/lib/format";

/**
 * Ficha do item por categoria do serviço. Os campos só aparecem quando o recurso
 * correspondente está ligado na lavanderia (Configurações → Categorias e recursos).
 * O banco valida de novo (clean_item_attributes): só estas chaves são aceitas.
 */
export type AttrKey = "marca" | "modelo" | "cor" | "numeracao" | "tipo_peca" | "tecido" | "largura_cm" | "profundidade_cm" | "altura_cm" | "lugares";

type FieldDef = { key: AttrKey; label: string; placeholder?: string; numeric?: boolean; max?: number; list?: string[] };

export const PIECE_TYPES = [
  "Camisa", "Camiseta", "Blusa", "Calça", "Bermuda", "Vestido", "Saia", "Casaco / Jaqueta", "Terno",
  "Uniforme", "Lençol", "Fronha", "Toalha", "Edredom", "Cobertor", "Manta", "Cortina", "Tapete",
];

const F: Record<AttrKey, FieldDef> = {
  marca: { key: "marca", label: "Marca", placeholder: "Ex.: Nike" },
  modelo: { key: "modelo", label: "Modelo", placeholder: "Ex.: Air Force 1" },
  cor: { key: "cor", label: "Cor", placeholder: "Ex.: Branco" },
  numeracao: { key: "numeracao", label: "Numeração", placeholder: "Ex.: 42", max: 10 },
  tipo_peca: { key: "tipo_peca", label: "Tipo de peça", placeholder: "Ex.: Camisa", list: PIECE_TYPES },
  tecido: { key: "tecido", label: "Tecido / material", placeholder: "Ex.: Suede" },
  largura_cm: { key: "largura_cm", label: "Largura (cm)", numeric: true },
  profundidade_cm: { key: "profundidade_cm", label: "Profundidade (cm)", numeric: true },
  altura_cm: { key: "altura_cm", label: "Altura (cm)", numeric: true },
  lugares: { key: "lugares", label: "Lugares", numeric: true },
};

export type ItemKind = { title: string; feature: string; fields: FieldDef[] };

const KINDS: Record<string, ItemKind> = {
  calcado: { title: "Ficha do calçado", feature: "campos_calcado", fields: [F.marca, F.modelo, F.cor, F.numeracao] },
  bolsa: { title: "Ficha do item", feature: "campos_calcado", fields: [F.marca, F.modelo, F.cor] },
  roupa: { title: "Peça", feature: "catalogo_roupas", fields: [F.tipo_peca, F.cor] },
  cortina: { title: "Medidas", feature: "dimensoes_item", fields: [F.largura_cm, F.altura_cm, F.tecido] },
  sofa: { title: "Medidas e características", feature: "dimensoes_item", fields: [F.largura_cm, F.profundidade_cm, F.altura_cm, F.lugares, F.tecido] },
  colchao: { title: "Medidas e características", feature: "dimensoes_item", fields: [F.largura_cm, F.profundidade_cm, F.altura_cm, F.tecido] },
};

const KIND_BY_CATEGORY: Record<string, keyof typeof KINDS> = {
  lavagem_tenis: "calcado",
  limpeza_sapatos: "calcado",
  limpeza_bolsas: "bolsa",
  lavagem_roupas: "roupa",
  secagem_roupas: "roupa",
  passadoria: "roupa",
  lavagem_edredons: "roupa",
  lavagem_cobertores: "roupa",
  limpeza_cortinas: "cortina",
  higienizacao_sofas: "sofa",
  limpeza_estofados: "sofa",
  higienizacao_colchoes: "colchao",
};

/** Qual ficha mostrar para o serviço (null = só a descrição livre). */
export function itemKind(service: Service | undefined, hasFeature: (code: string) => boolean): ItemKind | null {
  const k = service?.category_code ? KIND_BY_CATEGORY[service.category_code] : undefined;
  if (!k) return null;
  const kind = KINDS[k];
  return hasFeature(kind.feature) ? kind : null;
}

/** Unidades que aceitam quantidade quebrada (2,5 kg; 3,2 m²). */
export const allowsFraction = (u: PricingUnit | undefined) => u === "kg" || u === "m2";

/* ------------------------------------------------------------ rascunho dos itens */

export type ItemDraft = {
  key: number;
  serviceId: string;
  description: string;
  quantity: string;
  price: string;
  attributes: Partial<Record<AttrKey, string>>;
};

let nextKey = 1;
export const emptyItem = (): ItemDraft => ({ key: nextKey++, serviceId: "", description: "", quantity: "1", price: "", attributes: {} });

/** "2,5" → 2.5 */
export const parseQty = (v: string) => {
  const s = v.trim().replace(",", ".");
  return /^\d+(\.\d{1,2})?$/.test(s) ? Number(s) : NaN;
};

export function itemsTotal(items: ItemDraft[]) {
  return items.reduce((sum, it) => {
    const p = it.price.trim() === "" ? 0 : parseMoney(it.price);
    const q = parseQty(it.quantity);
    return sum + (Number.isNaN(p) || Number.isNaN(q) ? 0 : Math.round(p * q * 100) / 100);
  }, 0);
}

/** Valida os itens; devolve { "campo-chave": mensagem }. */
export function validateItems(items: ItemDraft[], services: Map<string, Service>) {
  const errs: Record<string, string> = {};
  for (const it of items) {
    const s = services.get(it.serviceId);
    if (!it.serviceId) errs[`service-${it.key}`] = "Escolha o serviço.";
    const q = parseQty(it.quantity);
    if (Number.isNaN(q) || q <= 0 || q > 500) errs[`qty-${it.key}`] = "Quantidade inválida.";
    else if (!allowsFraction(s?.pricing_unit) && !Number.isInteger(q)) errs[`qty-${it.key}`] = "Use um número inteiro.";
    const p = it.price.trim() === "" && s?.pricing_unit === "orcamento" ? 0 : parseMoney(it.price);
    if (Number.isNaN(p) || p > 99999) errs[`price-${it.key}`] = "Valor inválido.";
    if (it.description.length > 160) errs[`desc-${it.key}`] = "Máximo de 160 caracteres.";
    for (const [k, v] of Object.entries(it.attributes)) {
      const def = F[k as AttrKey];
      if (!v || !def) continue;
      if (def.numeric) {
        const n = Number(v.replace(",", "."));
        const bad = k === "lugares" ? !Number.isInteger(n) || n < 1 || n > 20 : Number.isNaN(n) || n <= 0 || n > 2000;
        if (bad) errs[`attr-${it.key}-${k}`] = k === "lugares" ? "De 1 a 20." : "De 1 a 2000 cm.";
      } else if (v.length > (def.max ?? 60)) errs[`attr-${it.key}-${k}`] = "Muito longo.";
    }
  }
  return errs;
}

/** Itens no formato das RPCs create_order / update_quote_items. */
export function itemsPayload(items: ItemDraft[]) {
  return items.map((it) => {
    const attributes: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(it.attributes)) {
      if (!v?.trim()) continue;
      attributes[k] = F[k as AttrKey]?.numeric ? Number(v.replace(",", ".")) : v.trim();
    }
    return {
      service_id: it.serviceId,
      description: it.description.trim() || null,
      quantity: parseQty(it.quantity),
      unit_price: it.price.trim() === "" ? 0 : parseMoney(it.price),
      attributes,
    };
  });
}

/** Itens já gravados → rascunho (para editar um orçamento). */
export function draftsFromItems(
  items: Array<{ service_id: string | null; description: string | null; quantity: number; unit_price: number; attributes: Record<string, unknown> | null }>,
) {
  return items
    .filter((i) => i.service_id)
    .map((i) => ({
      ...emptyItem(),
      serviceId: i.service_id!,
      description: i.description ?? "",
      quantity: String(i.quantity).replace(".", ","),
      price: moneyInput(i.unit_price),
      attributes: Object.fromEntries(Object.entries(i.attributes ?? {}).map(([k, v]) => [k, String(v)])) as ItemDraft["attributes"],
    }));
}

/** Texto curto da ficha: "Nike Air Force 1 · Branco · nº 42" / "210 × 90 cm · 3 lugares · Suede" */
export function formatAttributes(a: Record<string, unknown> | null | undefined) {
  if (!a) return "";
  const parts: string[] = [];
  const name = [a.tipo_peca, a.marca, a.modelo].filter(Boolean).join(" ");
  if (name) parts.push(name);
  if (a.cor) parts.push(String(a.cor));
  if (a.numeracao) parts.push(`nº ${a.numeracao}`);
  const dims = [a.largura_cm, a.profundidade_cm, a.altura_cm].filter((x) => x != null && x !== "");
  if (dims.length) parts.push(`${dims.join(" × ")} cm`);
  if (a.lugares) parts.push(`${a.lugares} ${Number(a.lugares) === 1 ? "lugar" : "lugares"}`);
  if (a.tecido) parts.push(String(a.tecido));
  return parts.join(" · ");
}

/** Quantidade para exibir: 2,5 kg · 2 pares · 1 peça */
export function formatQty(q: number, unit: PricingUnit | undefined) {
  const n = Number(q).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  switch (unit) {
    case "kg":
      return `${n} kg`;
    case "m2":
      return `${n} m²`;
    case "par":
      return `${n} ${Number(q) === 1 ? "par" : "pares"}`;
    case "peca":
      return `${n} ${Number(q) === 1 ? "peça" : "peças"}`;
    default:
      return `${n}×`;
  }
}
