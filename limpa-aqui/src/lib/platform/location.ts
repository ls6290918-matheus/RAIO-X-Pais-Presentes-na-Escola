// Localização: interface preparada para o rastreamento da Fase 5 (Smart Dispatch).
// Nesta fase NADA é enviado ao servidor nem guardado: só a abstração existe.
//  * Web/PWA: Geolocation API do navegador — só funciona com a tela aberta
//  * Capacitor (futuro): plugin de localização em segundo plano, com as permissões do sistema
// O consentimento é explícito e fica com a pessoa; a posição só será usada com o entregador online.
import { isNative } from "./index";

export type Position = { lat: number; lng: number; accuracy: number; at: number };
export type LocationPermission = "unsupported" | "prompt" | "granted" | "denied";

export interface LocationProvider {
  permission(): Promise<LocationPermission>;
  /** Uma leitura (pede permissão se preciso). */
  current(): Promise<Position>;
  /** Acompanha a posição enquanto a função de parar não for chamada. */
  watch(onPosition: (p: Position) => void, onError?: (e: Error) => void): () => void;
  /** true quando a plataforma entrega posição com o app em segundo plano. */
  readonly background: boolean;
}

const toPosition = (p: GeolocationPosition): Position => ({
  lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: p.timestamp,
});

class WebLocationProvider implements LocationProvider {
  readonly background = false;

  async permission(): Promise<LocationPermission> {
    if (typeof navigator === "undefined" || !navigator.geolocation) return "unsupported";
    try {
      const st = await navigator.permissions?.query({ name: "geolocation" as PermissionName });
      return (st?.state as LocationPermission) ?? "prompt";
    } catch {
      return "prompt";
    }
  }

  current(): Promise<Position> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error("unsupported"));
      navigator.geolocation.getCurrentPosition((p) => resolve(toPosition(p)), (e) => reject(new Error(e.message)), {
        enableHighAccuracy: true, timeout: 15000, maximumAge: 10000,
      });
    });
  }

  watch(onPosition: (p: Position) => void, onError?: (e: Error) => void): () => void {
    if (!navigator.geolocation) {
      onError?.(new Error("unsupported"));
      return () => undefined;
    }
    const id = navigator.geolocation.watchPosition((p) => onPosition(toPosition(p)), (e) => onError?.(new Error(e.message)), {
      enableHighAccuracy: true, maximumAge: 5000, timeout: 20000,
    });
    return () => navigator.geolocation.clearWatch(id);
  }
}

/** Reservado para o app nativo (plugin de localização em segundo plano). */
class NativeLocationProvider implements LocationProvider {
  readonly background = true;
  async permission(): Promise<LocationPermission> {
    return "unsupported";
  }
  current(): Promise<Position> {
    return Promise.reject(new Error("unsupported"));
  }
  watch(_: (p: Position) => void, onError?: (e: Error) => void): () => void {
    onError?.(new Error("unsupported"));
    return () => undefined;
  }
}

let provider: LocationProvider | null = null;
export function locationProvider(): LocationProvider {
  provider ??= isNative() ? new NativeLocationProvider() : new WebLocationProvider();
  return provider;
}
