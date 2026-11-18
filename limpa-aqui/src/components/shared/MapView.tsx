import { useEffect, useRef, useState } from "react";
import { MapPinOff } from "lucide-react";
import { cn } from "@/components/shared/ui";
import { loadMaps, mapsEnabled } from "@/lib/maps";

export type MapMarker = { lat: number; lng: number; label?: string; title?: string; highlight?: boolean };

/**
 * Mapa do Google com um ou vários marcadores. Ajusta o zoom para mostrar todos.
 * Sem chave configurada (ou se o Google recusar a chave), não renderiza nada.
 */
export function MapView({ markers, className }: { markers: MapMarker[]; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const [failed, setFailed] = useState(false);
  const key = markers.map((m) => `${m.lat},${m.lng},${m.label ?? ""}`).join("|");

  useEffect(() => {
    if (!mapsEnabled || !ref.current || markers.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const [{ Map }, { Marker }] = await Promise.all([loadMaps(), google.maps.importLibrary("marker") as Promise<google.maps.MarkerLibrary>]);
        if (cancelled || !ref.current) return;
        mapRef.current ??= new Map(ref.current, {
          center: markers[0],
          zoom: 15,
          disableDefaultUI: true,
          zoomControl: true,
          clickableIcons: false,
          gestureHandling: "cooperative",
        });
        const map = mapRef.current;
        markersRef.current.forEach((m) => m.setMap(null));
        markersRef.current = markers.map(
          (m) =>
            new Marker({
              map,
              position: { lat: m.lat, lng: m.lng },
              title: m.title,
              label: m.label ? { text: m.label, color: "#ffffff", fontWeight: "600", fontSize: "12px" } : undefined,
              icon: m.highlight
                ? { path: google.maps.SymbolPath.CIRCLE, scale: 11, fillColor: "#102C35", fillOpacity: 1, strokeColor: "#61D6C3", strokeWeight: 3 }
                : undefined,
            }),
        );
        if (markers.length === 1) {
          map.setCenter(markers[0]);
          map.setZoom(16);
        } else {
          const bounds = new google.maps.LatLngBounds();
          markers.forEach((m) => bounds.extend(m));
          map.fitBounds(bounds, 48);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!mapsEnabled || markers.length === 0) return null;
  if (failed) {
    return (
      <div className={cn("flex items-center gap-2 rounded-xl bg-nevoa px-4 py-3 text-xs text-grafite-500", className)}>
        <MapPinOff className="h-4 w-4" aria-hidden /> Não foi possível carregar o mapa agora.
      </div>
    );
  }
  return <div ref={ref} className={cn("h-56 w-full overflow-hidden rounded-xl bg-nevoa", className)} role="img" aria-label="Mapa" />;
}
