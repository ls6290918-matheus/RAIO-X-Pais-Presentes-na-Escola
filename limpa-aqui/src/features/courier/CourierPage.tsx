import { useCallback, useEffect, useMemo, useState } from "react";
import { Bike, CircleDot, Clock, History, MapPin, MessageCircle, Navigation, Plus, Power, Search, Wallet, X } from "lucide-react";
import { Alert, Button, Card, EmptyState, Field, InlineLoader, Input, PageHeader, Select, cn } from "@/components/shared/ui";
import { SimpleLayout } from "@/components/layout/SimpleLayout";
import { useAuth } from "@/contexts/AuthContext";
import { useRoles } from "@/contexts/RolesContext";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { formatBRL, maskPhone, onlyDigits, whatsappLink } from "@/lib/format";
import { CourierPayouts } from "./CourierPayouts";

type Vehicle = "bicicleta" | "moto" | "carro";
type Mun = { id: number; name: string };
type Available = {
  id: string;
  leg: "pickup" | "return";
  municipality_name: string;
  origin_neighborhood: string | null;
  dest_neighborhood: string | null;
  distance_km: number;
  delivery_fee: number;
  created_at: string;
};
type Mine = {
  id: string;
  leg: "pickup" | "return";
  status: "aceita" | "coletada" | "entregue" | "cancelada" | "disponivel";
  order_number: number;
  origin_label: string;
  origin_address: string;
  origin_lat: number | null;
  origin_lng: number | null;
  origin_phone: string | null;
  dest_label: string;
  dest_address: string;
  dest_lat: number | null;
  dest_lng: number | null;
  dest_phone: string | null;
  distance_km: number;
  delivery_fee: number;
  courier_earnings: number;
};

const VEHICLE_LABEL: Record<Vehicle, string> = { bicicleta: "Bicicleta", moto: "Moto", carro: "Carro" };
const LEG_LABEL = { pickup: "Coleta na casa do cliente", return: "Devolução ao cliente" } as const;
const STATUS_LABEL = { disponivel: "Disponível", aceita: "Aceita: vá buscar", coletada: "Coletada: vá entregar", entregue: "Entregue", cancelada: "Cancelada" } as const;
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const mapsTo = (lat: number | null, lng: number | null, address: string) =>
  `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(lat != null && lng != null ? `${lat},${lng}` : address)}`;

/** /entregas — área do entregador: cadastro, corridas livres na região e minhas corridas. */
export default function CourierPage() {
  const { user } = useAuth();
  const { statusOf, addRole, refresh } = useRoles();
  const status = statusOf("entregador");
  const [profile, setProfile] = useState<{ vehicle: Vehicle; cpf_last4: string } | null | undefined>(undefined);
  const [areas, setAreas] = useState<Mun[]>([]);
  const [all, setAll] = useState<Mun[]>([]);
  const [editing, setEditing] = useState(false);
  const [vehicle, setVehicle] = useState<Vehicle>("moto");
  const [cpf, setCpf] = useState("");
  const [phone, setPhone] = useState("");
  const [q, setQ] = useState("");
  const [available, setAvailable] = useState<Available[]>([]);
  const [mine, setMine] = useState<Mine[]>([]);
  const [tab, setTab] = useState<"livres" | "minhas" | "historico">("livres");
  const [summary, setSummary] = useState<{ online: boolean; today_rides: number; today_earnings: number; week_rides: number; week_earnings: number; active: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    const [c, a, m, p] = await Promise.all([
      supabase.from("couriers").select("vehicle, cpf_last4").eq("user_id", user.id).maybeSingle(),
      supabase.from("courier_areas").select("municipality:municipalities(id, name)").eq("user_id", user.id),
      supabase.from("municipalities").select("id, name").eq("state_id", 33).order("name"),
      supabase.from("profiles").select("phone").eq("id", user.id).maybeSingle(),
    ]);
    const prof = c.data as { vehicle: Vehicle; cpf_last4: string } | null;
    setProfile(prof);
    setAreas(((a.data as unknown as Array<{ municipality: Mun }>) ?? []).map((x) => x.municipality).sort((x, y) => x.name.localeCompare(y.name)));
    setAll((m.data as Mun[]) ?? []);
    setPhone(maskPhone(p.data?.phone ?? ""));
    if (prof) {
      setVehicle(prof.vehicle);
      setCpf(prof.cpf_last4);
    }
    if (status === "ativo") {
      const [av, my, su] = await Promise.all([supabase.rpc("courier_available_deliveries"), supabase.rpc("my_deliveries"), supabase.rpc("courier_summary")]);
      const sm = su.data as Record<string, unknown> | null;
      setSummary(sm ? { online: Boolean(sm.online), today_rides: Number(sm.today_rides), today_earnings: Number(sm.today_earnings), week_rides: Number(sm.week_rides), week_earnings: Number(sm.week_earnings), active: Number(sm.active) } : null);
      setAvailable(((av.data as Available[]) ?? []).map((x) => ({ ...x, delivery_fee: Number(x.delivery_fee), distance_km: Number(x.distance_km) })));
      setMine(((my.data as Mine[]) ?? []).map((x) => ({ ...x, delivery_fee: Number(x.delivery_fee), courier_earnings: Number(x.courier_earnings) })));
    }
  }, [user, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const suggestions = useMemo(() => {
    const k = norm(q.trim());
    if (!k) return [];
    const have = new Set(areas.map((a) => a.id));
    return all.filter((m) => !have.has(m.id) && norm(m.name).includes(k)).slice(0, 6);
  }, [q, all, areas]);

  async function saveProfile() {
    if (!/^\d{4}$/.test(cpf)) return setMsg({ kind: "error", text: "Informe os 4 últimos números do CPF." });
    if (onlyDigits(phone).length < 10) return setMsg({ kind: "error", text: "Informe seu WhatsApp com DDD." });
    if (areas.length === 0) return setMsg({ kind: "error", text: "Escolha pelo menos um município onde você faz entregas." });
    setBusy("profile");
    setMsg(null);
    const { error } = await supabase.rpc("save_courier_profile", {
      p_vehicle: vehicle,
      p_cpf_last4: cpf,
      p_phone: onlyDigits(phone),
      p_municipalities: areas.map((a) => a.id),
    });
    setBusy(null);
    if (error) return setMsg({ kind: "error", text: friendlyError(error) });
    setEditing(false);
    setMsg({ kind: "success", text: "Cadastro salvo." });
    await load();
  }

  async function run(key: string, fn: () => PromiseLike<{ error: unknown }>, ok: string) {
    setBusy(key);
    setMsg(null);
    const { error } = await fn();
    setBusy(null);
    if (error) setMsg({ kind: "error", text: friendlyError(error) });
    else setMsg({ kind: "success", text: ok });
    await load();
  }

  if (profile === undefined)
    return (
      <SimpleLayout>
        <InlineLoader />
      </SimpleLayout>
    );

  if (!status)
    return (
      <SimpleLayout>
        <Card>
          <EmptyState
            icon={<Bike className="h-6 w-6" />}
            title="Faça entregas com o Limpa Aqui"
            description="Coletas e devoluções de roupas e calçados na sua cidade. Seu cadastro passa por aprovação."
            action={
              <Button
                onClick={async () => {
                  await addRole("entregador");
                  await refresh();
                }}
              >
                Quero fazer entregas
              </Button>
            }
          />
        </Card>
      </SimpleLayout>
    );

  const showForm = !profile || editing;
  const shownMine = mine.filter((m) => (tab === "historico" ? m.status === "entregue" || m.status === "cancelada" : m.status === "aceita" || m.status === "coletada"));

  return (
    <SimpleLayout>
      <div className="space-y-6">
        <PageHeader
          title="Entregas"
          description={profile ? `${VEHICLE_LABEL[profile.vehicle]} · ${areas.map((a) => a.name).join(", ")}` : "Complete seu cadastro de entregador."}
          action={
            profile &&
            !editing && (
              <Button variant="outline" onClick={() => setEditing(true)}>
                Editar cadastro
              </Button>
            )
          }
        />
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
        {status === "pendente" && profile && !editing && (
          <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800" role="status">
            Cadastro em análise pela administração. Quando for aprovado, as corridas da sua região aparecem aqui.
          </div>
        )}
        {status === "suspenso" && <Alert>Seu cadastro de entregador está suspenso. Fale com a administração do Limpa Aqui.</Alert>}

        {showForm && (
          <Card className="space-y-4 p-5">
            <h2 className="text-base font-semibold text-petroleo">Seu cadastro</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Veículo" htmlFor="cr-vehicle">
                <Select id="cr-vehicle" value={vehicle} onChange={(e) => setVehicle(e.target.value as Vehicle)}>
                  {Object.entries(VEHICLE_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="4 últimos números do CPF" htmlFor="cr-cpf" hint="Só guardamos estes 4 números.">
                <Input id="cr-cpf" inputMode="numeric" maxLength={4} value={cpf} onChange={(e) => setCpf(onlyDigits(e.target.value).slice(0, 4))} />
              </Field>
              <Field label="WhatsApp" htmlFor="cr-phone">
                <Input id="cr-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(maskPhone(e.target.value))} />
              </Field>
            </div>
            <div>
              <p className="text-sm font-semibold text-grafite">Municípios onde você faz entregas</p>
              <div className="mt-2 flex flex-wrap gap-2" data-testid="cr-areas">
                {areas.map((m) => (
                  <span key={m.id} className="inline-flex items-center gap-1 rounded-full bg-agua-50 py-1 pl-3 pr-1 text-sm font-medium text-petroleo">
                    {m.name}
                    <button type="button" onClick={() => setAreas(areas.filter((x) => x.id !== m.id))} className="rounded-full p-1 hover:bg-white" aria-label={`Remover ${m.name}`}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="relative mt-2 sm:max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-grafite-500" aria-hidden />
                <Input className="pl-9" placeholder="Adicionar município do RJ" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Adicionar município de entrega" />
              </div>
              {suggestions.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {suggestions.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        setAreas([...areas, m].sort((x, y) => x.name.localeCompare(y.name)));
                        setQ("");
                      }}
                      className="inline-flex items-center gap-1 rounded-full border border-grafite/15 px-3 py-1 text-sm text-grafite hover:border-agua"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden /> {m.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <Button loading={busy === "profile"} onClick={() => void saveProfile()}>
                Salvar cadastro
              </Button>
              {profile && (
                <Button variant="outline" onClick={() => setEditing(false)}>
                  Cancelar
                </Button>
              )}
            </div>
          </Card>
        )}

        {status === "ativo" && profile && (
          <>
            {/* Painel do entregador: online/offline e ganhos */}
            <section className="rounded-3xl bg-petroleo p-5 text-white shadow-lg" data-testid="courier-panel">
              <div className="flex items-center gap-3">
                <span className={cn("h-3 w-3 shrink-0 rounded-full", summary?.online ? "bg-agua shadow-[0_0_0_4px_rgba(97,214,195,0.25)]" : "bg-white/30")} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-lg font-semibold" data-testid="courier-state">{summary?.online ? "Você está online" : "Você está offline"}</p>
                  <p className="text-xs text-white/60">{summary?.online ? "Recebendo corridas de " + areas.map((a) => a.name).join(", ") : "Fique online para receber corridas da sua região."}</p>
                </div>
                <button
                  type="button"
                  disabled={busy === "online"}
                  onClick={() => void run("online", () => supabase.rpc("set_courier_online", { p_online: !summary?.online }), summary?.online ? "Você ficou offline." : "Você está online! As corridas da sua região aparecem abaixo.")}
                  className={cn(
                    "inline-flex h-12 shrink-0 items-center gap-2 rounded-2xl px-4 text-sm font-bold transition disabled:opacity-60",
                    summary?.online ? "bg-white/10 text-white hover:bg-white/15" : "bg-agua text-petroleo hover:bg-agua-600",
                  )}
                  data-testid="courier-toggle"
                >
                  <Power className="h-4 w-4" aria-hidden /> {summary?.online ? "Ficar offline" : "Ficar online"}
                </button>
              </div>
              <div className="mt-5 grid grid-cols-3 gap-2 text-center">
                {[
                  ["Hoje", formatBRL(summary?.today_earnings ?? 0), `${summary?.today_rides ?? 0} corrida(s)`],
                  ["Semana", formatBRL(summary?.week_earnings ?? 0), `${summary?.week_rides ?? 0} corrida(s)`],
                  ["Em andamento", String(summary?.active ?? 0), "corrida(s)"],
                ].map(([l, v, n]) => (
                  <div key={l} className="rounded-2xl bg-white/[0.06] px-2 py-3">
                    <p className="text-[11px] text-white/60">{l}</p>
                    <p className="mt-0.5 text-base font-bold">{v}</p>
                    <p className="text-[10px] text-white/50">{n}</p>
                  </div>
                ))}
              </div>
            </section>

            <div className="flex gap-2 overflow-x-auto" role="tablist">
              {(
                [
                  ["livres", `Corridas (${available.length})`, CircleDot],
                  ["minhas", `Em andamento (${mine.filter((m) => m.status === "aceita" || m.status === "coletada").length})`, Bike],
                  ["historico", "Histórico", History],
                ] as const
              ).map(([k, label, Icon]) => (
                <button
                  key={k}
                  role="tab"
                  aria-selected={tab === k}
                  onClick={() => setTab(k)}
                  className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold", tab === k ? "bg-petroleo text-white" : "bg-white text-grafite")}
                >
                  <Icon className="h-4 w-4" aria-hidden /> {label}
                </button>
              ))}
            </div>

            {tab === "livres" ? (
              !summary?.online ? (
                <Card>
                  <EmptyState icon={<Power className="h-6 w-6" />} title="Você está offline" description="Toque em Ficar online para ver e aceitar as coletas e devoluções da sua região." />
                </Card>
              ) : available.length === 0 ? (
                <Card>
                  <EmptyState icon={<Clock className="h-6 w-6" />} title="Nenhuma corrida livre agora" description="Fique por perto: quando um cliente da sua região pedir coleta ou devolução, ela aparece aqui." />
                </Card>
              ) : (
                <ul className="space-y-3" data-testid="available-list">
                  {available.map((d) => (
                    <li key={d.id}>
                      <Card className="space-y-4 p-4">
                        <div className="flex items-start gap-3">
                          <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-bold", d.leg === "pickup" ? "bg-agua-50 text-petroleo" : "bg-amber-50 text-amber-800")}>
                            {d.leg === "pickup" ? "Coleta" : "Devolução"}
                          </span>
                          <span className="flex-1 text-xs text-grafite-500">{d.municipality_name} · ~{String(d.distance_km).replace(".", ",")} km</span>
                          <span className="text-xl font-bold text-petroleo">{formatBRL(d.delivery_fee)}</span>
                        </div>
                        <ol className="relative space-y-3 pl-6 text-sm">
                          <span className="absolute bottom-2 left-[7px] top-2 w-px bg-grafite/15" aria-hidden />
                          <li className="relative">
                            <span className="absolute -left-6 top-1 h-3.5 w-3.5 rounded-full border-2 border-agua-600 bg-white" aria-hidden />
                            <p className="text-[11px] text-grafite-500">Buscar em</p>
                            <p className="font-semibold text-grafite">{d.origin_neighborhood ?? "Bairro informado ao aceitar"}</p>
                          </li>
                          <li className="relative">
                            <span className="absolute -left-6 top-1 h-3.5 w-3.5 rounded-full bg-petroleo" aria-hidden />
                            <p className="text-[11px] text-grafite-500">Entregar em</p>
                            <p className="font-semibold text-grafite">{d.dest_neighborhood ?? "Bairro informado ao aceitar"}</p>
                          </li>
                        </ol>
                        <Button block loading={busy === d.id} onClick={() => void run(d.id, () => supabase.rpc("accept_delivery", { p_delivery_id: d.id }), "Corrida aceita! Veja em Em andamento.")}>
                          Aceitar corrida
                        </Button>
                      </Card>
                    </li>
                  ))}
                </ul>
              )
            ) : shownMine.length === 0 ? (
              <Card>
                <EmptyState
                  icon={tab === "minhas" ? <Bike className="h-6 w-6" /> : <Wallet className="h-6 w-6" />}
                  title={tab === "minhas" ? "Nenhuma corrida em andamento" : "Nenhuma corrida concluída ainda"}
                  description={tab === "minhas" ? "Aceite uma corrida para começar." : "As corridas entregues e canceladas aparecem aqui."}
                />
              </Card>
            ) : (
              <ul className="space-y-3" data-testid="my-list">
                {shownMine.map((d) => {
                  const going = d.status === "aceita" ? { lat: d.origin_lat, lng: d.origin_lng, address: d.origin_address } : { lat: d.dest_lat, lng: d.dest_lng, address: d.dest_address };
                  return (
                    <li key={d.id}>
                      <Card className="space-y-3 p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="flex-1 text-sm font-semibold text-petroleo">
                            {LEG_LABEL[d.leg]} · pedido #{d.order_number}
                          </p>
                          <span className="rounded-full bg-nevoa px-2.5 py-1 text-xs font-semibold text-grafite">{STATUS_LABEL[d.status]}</span>
                        </div>
                        {[
                          ["Buscar em", d.origin_label, d.origin_address, d.origin_phone],
                          ["Entregar em", d.dest_label, d.dest_address, d.dest_phone],
                        ].map(([t, label, address, phoneNum]) => (
                          <div key={t} className="flex items-start gap-2 text-sm">
                            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-agua-600" aria-hidden />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs text-grafite-500">{t}</p>
                              <p className="font-medium text-grafite">{label}</p>
                              <p className="text-grafite-500">{address}</p>
                            </div>
                            {phoneNum && (d.status === "aceita" || d.status === "coletada") && (
                              <a href={whatsappLink(phoneNum)} target="_blank" rel="noreferrer" className="rounded-lg p-2 text-petroleo hover:bg-nevoa" aria-label={`WhatsApp de ${label}`}>
                                <MessageCircle className="h-4 w-4" />
                              </a>
                            )}
                          </div>
                        ))}
                        <p className="text-xs text-grafite-500">
                          Corrida de {formatBRL(d.delivery_fee)} · pagamento direto: receba do cliente {d.leg === "pickup" ? "na coleta" : "na entrega"}.
                        </p>
                        {(d.status === "aceita" || d.status === "coletada") && (
                          <div className="flex flex-wrap gap-2">
                            <a href={mapsTo(going.lat, going.lng, going.address)} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1 rounded-xl border border-grafite/15 px-3 text-sm font-semibold text-petroleo">
                              <Navigation className="h-4 w-4" aria-hidden /> Rota
                            </a>
                            {d.status === "aceita" ? (
                              <>
                                <Button className="h-9" loading={busy === d.id} onClick={() => void run(d.id, () => supabase.rpc("advance_delivery", { p_delivery_id: d.id, p_status: "coletada" }), "Coleta registrada.")}>
                                  Coletei
                                </Button>
                                <Button variant="outline" className="h-9" disabled={busy === d.id} onClick={() => window.confirm("Desistir desta corrida? Ela volta para os outros entregadores.") && void run(d.id, () => supabase.rpc("release_delivery", { p_delivery_id: d.id }), "Corrida liberada.")}>
                                  Desistir
                                </Button>
                              </>
                            ) : (
                              <Button className="h-9" loading={busy === d.id} onClick={() => void run(d.id, () => supabase.rpc("advance_delivery", { p_delivery_id: d.id, p_status: "entregue" }), "Entrega registrada. Obrigado!")}>
                                Entreguei
                              </Button>
                            )}
                          </div>
                        )}
                      </Card>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
        {profile && !editing && <CourierPayouts />}
      </div>
    </SimpleLayout>
  );
}
