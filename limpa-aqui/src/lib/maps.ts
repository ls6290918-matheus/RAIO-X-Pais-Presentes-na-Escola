import { Loader } from "@googlemaps/js-api-loader";

/**
 * Google Maps. A chave é de navegador (aparece no JavaScript do site), por isso
 * precisa estar restrita no Google Cloud ao domínio do site e às APIs usadas.
 * Sem chave, o app funciona normalmente: os endereços viram campos comuns e o mapa some.
 */
const apiKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined)?.trim();

export const mapsEnabled = Boolean(apiKey);

let loader: Loader | null = null;

function getLoader() {
  if (!apiKey) throw new Error("Google Maps não configurado.");
  loader ??= new Loader({ apiKey, version: "weekly", language: "pt-BR", region: "BR" });
  return loader;
}

export const loadPlaces = () => getLoader().importLibrary("places");
export const loadMaps = () => getLoader().importLibrary("maps");

/* ------------------------------------------------------------ Endereço */

export type Address = {
  street: string | null;
  street_number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  lat: number | null;
  lng: number | null;
  place_id: string | null;
};

export const ADDRESS_COLUMNS =
  "street, street_number, complement, neighborhood, city, state, postal_code, lat, lng, place_id";

export const emptyAddress = (): Address => ({
  street: null,
  street_number: null,
  complement: null,
  neighborhood: null,
  city: null,
  state: null,
  postal_code: null,
  lat: null,
  lng: null,
  place_id: null,
});

export const hasLocation = (a: Pick<Address, "lat" | "lng"> | null | undefined): a is { lat: number; lng: number } =>
  a != null && typeof a.lat === "number" && typeof a.lng === "number";

/** "Rua da Mooca, 1000 - Apto 12 - Mooca, São Paulo/SP" */
export function formatAddress(a: Partial<Address> | null | undefined) {
  if (!a) return "";
  const line1 = [a.street, a.street_number].filter(Boolean).join(", ");
  const line = [line1, a.complement].filter(Boolean).join(" - ");
  const cityUf = [a.city, a.state].filter(Boolean).join("/");
  return [line, a.neighborhood, cityUf].filter(Boolean).join(" - ");
}

export const hasAddress = (a: Partial<Address> | null | undefined) => Boolean(a?.street || hasLocation(a as Address));

/* ------------------------------------------------------------ Links (não consomem cota da API) */

type Point = { lat: number; lng: number } | string;
const pointParam = (p: Point) => encodeURIComponent(typeof p === "string" ? p : `${p.lat},${p.lng}`);

/** Abre o endereço no Google Maps (app no celular, site no computador). */
export function mapsLink(a: Partial<Address>) {
  const q = hasLocation(a as Address) ? `${a.lat},${a.lng}` : formatAddress(a);
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

/**
 * Links de rota do Google Maps. O Maps aceita até 9 paradas intermediárias por link,
 * então rotas maiores são divididas em trechos (o fim de um é o começo do próximo).
 */
export function routeLinks(origin: Point | null, stops: Point[]) {
  const links: string[] = [];
  let start = origin;
  let rest = stops.slice();
  while (rest.length) {
    const chunk = rest.slice(0, 10); // 9 paradas + destino
    rest = rest.slice(chunk.length);
    const destination = chunk[chunk.length - 1];
    const waypoints = chunk.slice(0, -1);
    let url = `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${pointParam(destination)}`;
    if (start) url += `&origin=${pointParam(start)}`;
    if (waypoints.length) url += `&waypoints=${waypoints.map(pointParam).join("%7C")}`;
    links.push(url);
    start = destination;
  }
  return links;
}

/* ------------------------------------------------------------ Ordem da rota */

/** Distância em km entre dois pontos (fórmula de Haversine). */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Ordena as paradas partindo da lavanderia e indo sempre à mais próxima ainda não visitada.
 * Não é a rota perfeita, mas é boa para poucas paradas e não usa nenhuma API paga.
 */
export function orderByNearest<T extends { lat: number; lng: number }>(start: { lat: number; lng: number } | null, stops: T[]) {
  const pending = stops.slice();
  const ordered: T[] = [];
  let current: { lat: number; lng: number } = start ?? pending[0];
  while (pending.length) {
    let best = 0;
    for (let i = 1; i < pending.length; i++) {
      if (distanceKm(current, pending[i]) < distanceKm(current, pending[best])) best = i;
    }
    const next = pending.splice(best, 1)[0];
    ordered.push(next);
    current = next;
  }
  return ordered;
}
