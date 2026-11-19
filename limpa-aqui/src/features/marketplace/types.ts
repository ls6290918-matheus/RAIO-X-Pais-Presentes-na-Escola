import type { PricingUnit } from "@/lib/types";

export type ProviderType = "autonomo" | "empresa";
export const PROVIDER_TYPE_LABEL: Record<ProviderType, string> = { autonomo: "Autônomo(a)", empresa: "Lavanderia / empresa" };

export type SearchResult = {
  id: string;
  name: string;
  slug: string;
  provider_type: ProviderType | null;
  logo_path: string | null;
  public_description: string | null;
  neighborhood: string | null;
  municipality_name: string | null;
  categories: string[];
  min_price: number | null;
  services_count: number;
  offers_pickup: boolean;
  accepts_direct_payment: boolean;
  accepts_app_payment: boolean;
  distance_km: number | null;
};

export type PublicProvider = Omit<SearchResult, "min_price" | "services_count" | "distance_km"> & {
  opening_hours: Record<string, string> | null;
  services: Array<{ id: string; name: string; description: string | null; price: number; pricing_unit: PricingUnit; category: string | null }>;
  areas: string[];
};

export const HOURS_LABEL: Record<string, string> = {
  seg_sex: "Segunda a sexta",
  seg: "Segunda",
  ter: "Terça",
  qua: "Quarta",
  qui: "Quinta",
  sex: "Sexta",
  sab: "Sábado",
  dom: "Domingo",
};

export const formatKm = (km: number | null) =>
  km == null ? null : km < 1 ? "menos de 1 km" : `${String(km).replace(".", ",")} km`;
