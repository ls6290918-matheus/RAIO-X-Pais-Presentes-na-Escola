import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, MapPin, MapPinOff, MessageCircle, Navigation, Route, Truck } from "lucide-react";
import { Alert, Button, Card, EmptyState, InlineLoader, PageHeader, buttonClass, cn } from "@/components/shared/ui";
import { MapView, type MapMarker } from "@/components/shared/MapView";
import { useBusiness } from "@/contexts/BusinessContext";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { formatBRL, formatDayShort, todayISO, whatsappLink } from "@/lib/format";
import { type Address, ADDRESS_COLUMNS, distanceKm, formatAddress, hasLocation, mapsEnabled, mapsLink, orderByNearest, routeLinks } from "@/lib/maps";
import type { Order } from "@/lib/types";

type Stop = Pick<Order, "id" | "number" | "due_date" | "total" | "paid"> & {
  customers: ({ id: string; name: string; whatsapp: string | null } & Address) | null;
};

type Located = Stop & { lat: number; lng: number };

export default function RoutesPage() {
  const { business, settings } = useBusiness();
  const [stops, setStops] = useState<Stop[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const today = todayISO(settings?.timezone);

  const load = useCallback(async () => {
    if (!business) return;
    const { data, error: err } = await supabase
      .from("orders")
      .select(`id, number, due_date, total, paid, customers(id, name, whatsapp, ${ADDRESS_COLUMNS})`)
      .eq("business_id", business.id)
      .eq("status", "pronto")
      .eq("delivery_type", "entrega")
      .order("due_date")
      .limit(100);
    if (err) setError(friendlyError(err));
    setStops((data as unknown as Stop[]) ?? []);
  }, [business]);

  useEffect(() => {
    void load();
  }, [load]);

  const origin = business && hasLocation(business) ? { lat: business.lat, lng: business.lng } : null;

  const { ordered, missing } = useMemo(() => {
    const located: Located[] = [];
    const missing: Stop[] = [];
    for (const s of stops ?? []) {
      if (s.customers && hasLocation(s.customers)) located.push({ ...s, lat: s.customers.lat, lng: s.customers.lng });
      else missing.push(s);
    }
    return { ordered: orderByNearest(origin, located), missing };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops, origin?.lat, origin?.lng]);

  const totalKm = useMemo(() => {
    let km = 0;
    let prev = origin;
    for (const s of ordered) {
      if (prev) km += distanceKm(prev, s);
      prev = s;
    }
    return km;
  }, [ordered, origin]);

  const links = routeLinks(origin, ordered.map((s) => ({ lat: s.lat, lng: s.lng })));

  const markers: MapMarker[] = [
    ...(origin ? [{ ...origin, label: "L", title: business?.name, highlight: true }] : []),
    ...ordered.map((s, i) => ({ lat: s.lat, lng: s.lng, label: String(i + 1), title: `#${s.number} ${s.customers?.name ?? ""}` })),
  ];

  async function delivered(s: Stop) {
    setBusy(s.id);
    setError(null);
    const { error: err } = await supabase.rpc("set_order_status", { p_order_id: s.id, p_status: "entregue" });
    setBusy(null);
    if (err) return setError(friendlyError(err));
    setStops((list) => (list ?? []).filter((x) => x.id !== s.id));
  }

  const onTheWay = (s: Stop) =>
    `Olá, ${(s.customers?.name ?? "").split(" ")[0]}! Saímos para entregar o seu pedido #${s.number} da ${business?.name}. ` +
    (s.paid ? "Até já!" : `Valor: ${formatBRL(s.total)}. Até já!`);

  function StopCard({ s, index }: { s: Stop; index?: number }) {
    const c = s.customers;
    const late = s.due_date < today;
    return (
      <li className="flex gap-3 px-4 py-4 sm:px-5">
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
            index != null ? "bg-petroleo text-white" : "bg-nevoa text-grafite-500",
          )}
        >
          {index != null ? index + 1 : <MapPinOff className="h-4 w-4" aria-hidden />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <Link to={`/app/pedidos/${s.id}`} className="font-semibold text-petroleo hover:underline">
              #{s.number} · {c?.name}
            </Link>
            <span className={cn("text-xs", late ? "font-semibold text-red-600" : "text-grafite-500")}>
              {late ? "Atrasado · " : ""}
              {formatDayShort(s.due_date)} · {s.paid ? "Pago" : `Receber ${formatBRL(s.total)}`}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-grafite-500">{c && formatAddress(c) ? formatAddress(c) : "Sem endereço cadastrado"}</p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {c && (formatAddress(c) || hasLocation(c)) && (
              <a href={mapsLink(c)} target="_blank" rel="noreferrer" className={cn(buttonClass("outline"), "h-9 px-3 text-xs")}>
                <Navigation className="h-3.5 w-3.5" aria-hidden /> Maps
              </a>
            )}
            {c?.whatsapp && (
              <a href={whatsappLink(c.whatsapp, onTheWay(s))} target="_blank" rel="noreferrer" className={cn(buttonClass("outline"), "h-9 px-3 text-xs")}>
                <MessageCircle className="h-3.5 w-3.5" aria-hidden /> A caminho
              </a>
            )}
            <Button className="h-9 px-3 text-xs" loading={busy === s.id} disabled={!!busy} onClick={() => void delivered(s)}>
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Entregue
            </Button>
          </div>
        </div>
      </li>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rotas"
        description="Pedidos prontos para entregar no endereço do cliente, na melhor ordem a partir da lavanderia."
      />

      {error && <Alert>{error}</Alert>}
      {!origin && (
        <Alert>
          Cadastre o endereço da lavanderia em{" "}
          <Link to="/app/configuracoes" className="font-semibold underline">
            Configurações
          </Link>{" "}
          para a rota começar dela.
        </Alert>
      )}

      {stops === null ? (
        <InlineLoader />
      ) : stops.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Truck className="h-6 w-6" />}
            title="Nenhuma entrega pendente"
            description='Pedidos marcados como "Entregar" aparecem aqui quando ficam prontos.'
          />
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_380px] lg:items-start">
          <div className="space-y-6">
            {ordered.length > 0 && (
              <Card className="overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
                  <div>
                    <h2 className="text-base font-semibold text-petroleo">
                      {ordered.length} {ordered.length === 1 ? "entrega" : "entregas"}
                    </h2>
                    {origin && <p className="text-xs text-grafite-500">≈ {totalKm.toFixed(1).replace(".", ",")} km em linha reta</p>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {links.map((url, i) => (
                      <a key={url} href={url} target="_blank" rel="noreferrer" className={cn(buttonClass("dark"), "h-10")}>
                        <Route className="h-4 w-4" aria-hidden />
                        {links.length > 1 ? `Rota parte ${i + 1}` : "Abrir rota no Google Maps"}
                      </a>
                    ))}
                  </div>
                </div>
                <ol className="mt-3 divide-y divide-grafite/5">
                  {ordered.map((s, i) => (
                    <StopCard key={s.id} s={s} index={i} />
                  ))}
                </ol>
              </Card>
            )}

            {missing.length > 0 && (
              <Card className="overflow-hidden">
                <div className="px-5 pt-5">
                  <h2 className="flex items-center gap-2 text-base font-semibold text-petroleo">
                    <MapPin className="h-4 w-4" aria-hidden /> Sem localização no mapa
                  </h2>
                  <p className="text-xs text-grafite-500">
                    Edite o cliente e use a busca de endereço para incluí-lo na rota automática.
                  </p>
                </div>
                <ul className="mt-3 divide-y divide-grafite/5">
                  {missing.map((s) => (
                    <StopCard key={s.id} s={s} />
                  ))}
                </ul>
              </Card>
            )}
          </div>

          {mapsEnabled && markers.length > 0 && (
            <Card className="p-3 lg:sticky lg:top-24">
              <MapView markers={markers} className="h-80 lg:h-[480px]" />
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
