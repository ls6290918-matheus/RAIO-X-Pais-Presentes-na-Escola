// Camada de plataforma: o resto do app não sabe se está no navegador, no PWA instalado
// ou (no futuro) no aplicativo Capacitor para Android/iOS.
import { newRequestKey } from "@/lib/idempotency";

export type Platform = "web" | "pwa" | "android" | "ios";

type CapacitorGlobal = { isNativePlatform?: () => boolean; getPlatform?: () => string };
const capacitor = (): CapacitorGlobal | undefined => (globalThis as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;

/** Está rodando dentro do app nativo (Capacitor)? */
export const isNative = () => Boolean(capacitor()?.isNativePlatform?.());

/** Plataforma atual, no formato que o backend registra. */
export function currentPlatform(): Platform {
  const cap = capacitor();
  if (cap?.isNativePlatform?.()) return cap.getPlatform?.() === "ios" ? "ios" : "android";
  const standalone =
    typeof window !== "undefined" &&
    (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
  return standalone ? "pwa" : "web";
}

/** iPhone/iPad no navegador (sem o app instalado na tela inicial, o iOS não entrega push). */
export const isIosBrowser = () =>
  typeof navigator !== "undefined" && /iPhone|iPad|iPod/.test(navigator.userAgent) && currentPlatform() === "web";

const DEVICE_KEY = "limpaaqui.device-id";

/** Identificador estável deste aparelho/navegador (não é dado pessoal; só separa os aparelhos da conta). */
export function deviceId(): string {
  try {
    const saved = localStorage.getItem(DEVICE_KEY);
    if (saved && /^[A-Za-z0-9_-]{8,100}$/.test(saved)) return saved;
    const id = newRequestKey();
    localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    return newRequestKey(); // navegação privada: um id por sessão
  }
}

/** Nome amigável do aparelho para a lista "Seus aparelhos". */
export function deviceName(): string {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad|iPod/.test(ua) ? "iPhone" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "Aparelho";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "navegador";
  return currentPlatform() === "pwa" ? `App Limpa Aqui no ${os}` : `${browser} no ${os}`;
}
