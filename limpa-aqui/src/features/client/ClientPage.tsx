import { useCallback, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { CheckCircle2, Circle, MapPin, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { Alert, Button, Card, Field, InlineLoader, Input, PageHeader, cn } from "@/components/shared/ui";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { maskPhone, onlyDigits } from "@/lib/format";
import { ADDRESS_COLUMNS, formatAddress } from "@/lib/maps";
import { ClientShell } from "./ClientShell";
import { NotificationSettings } from "@/features/settings/NotificationSettings";
import { AddressModal } from "./AddressModal";
import type { UserAddress } from "./clientTypes";
import { ListingModal } from "./ListingModal";
import { listingStatus, type MyListing } from "./ListingPage";

/** /cliente/conta — conta de quem contrata: dados, endereços e anúncios. */
export default function ClientPage() {
  const { user } = useAuth();
  const location = useLocation();
  const [listings, setListings] = useState<MyListing[]>([]);
  const [newListing, setNewListing] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [savedPhone, setSavedPhone] = useState<string | null>(null);
  const [addresses, setAddresses] = useState<UserAddress[] | null>(null);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(
    (location.state as { success?: string } | null)?.success ? { kind: "success", text: (location.state as { success: string }).success } : null,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<UserAddress | "new" | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    const [p, a, l] = await Promise.all([
      supabase.from("profiles").select("full_name, phone").eq("id", user.id).maybeSingle(),
      supabase
        .from("user_addresses")
        .select(`id, label, is_default, municipality_id, ${ADDRESS_COLUMNS}, municipality:municipalities(name)`)
        .order("created_at"),
      supabase.rpc("my_listings"),
    ]);
    const err = p.error ?? a.error;
    if (err) setMsg({ kind: "error", text: friendlyError(err) });
    setName(p.data?.full_name ?? String(user.user_metadata?.full_name ?? ""));
    setPhone(maskPhone(p.data?.phone ?? ""));
    setSavedPhone(p.data?.phone ?? null);
    setAddresses((a.data as unknown as UserAddress[]) ?? []);
    setListings((l.data as MyListing[]) ?? []);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveProfile() {
    const n = name.trim();
    const d = onlyDigits(phone);
    if (n.length < 2) return setMsg({ kind: "error", text: "Informe seu nome." });
    if (d && (d.length < 10 || d.length > 11)) return setMsg({ kind: "error", text: "WhatsApp com DDD: 10 ou 11 números." });
    setBusy("profile");
    setMsg(null);
    const { error } = await supabase.from("profiles").update({ full_name: n, phone: d || null }).eq("id", user!.id);
    setBusy(null);
    if (error) return setMsg({ kind: "error", text: friendlyError(error) });
    setMsg({ kind: "success", text: "Seus dados foram salvos." });
    await load();
  }

  async function makeDefault(a: UserAddress) {
    setBusy(a.id);
    const { error } = await supabase.rpc("set_default_address", { p_address_id: a.id });
    setBusy(null);
    if (error) return setMsg({ kind: "error", text: friendlyError(error) });
    await load();
  }

  async function remove(a: UserAddress) {
    if (!window.confirm(`Apagar o endereço "${a.label}"?`)) return;
    setBusy(a.id);
    const { error } = await supabase.from("user_addresses").delete().eq("id", a.id);
    setBusy(null);
    if (error) return setMsg({ kind: "error", text: friendlyError(error) });
    setMsg({ kind: "success", text: "Endereço apagado." });
    await load();
  }

  if (addresses === null)
    return (
      <ClientShell>
        <InlineLoader />
      </ClientShell>
    );

  const steps = [
    { done: !!savedPhone, label: "Informe seu WhatsApp, para os prestadores falarem com você" },
    { done: addresses.length > 0, label: "Cadastre o endereço onde os itens serão coletados ou entregues" },
  ];
  const firstName = name.split(" ")[0];

  return (
    <ClientShell>
      <div className="space-y-6">
        <PageHeader title="Minha conta" description={firstName ? `${firstName}, aqui ficam seus dados, endereços e pedidos de orçamento.` : "Seus dados, endereços e pedidos de orçamento."} />
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

        {steps.some((s) => !s.done) && (
          <Card className="p-5">
            <h2 className="text-base font-semibold text-petroleo">Complete seu cadastro</h2>
            <ul className="mt-3 space-y-2">
              {steps.map((s) => (
                <li key={s.label} className="flex items-center gap-2 text-sm">
                  {s.done ? <CheckCircle2 className="h-4 w-4 text-agua" aria-hidden /> : <Circle className="h-4 w-4 text-grafite-500" aria-hidden />}
                  <span className={cn(s.done ? "text-grafite-500 line-through" : "text-grafite")}>{s.label}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {/* Dados */}
        <Card className="p-5">
          <h2 className="text-base font-semibold text-petroleo">Seus dados</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Nome" htmlFor="cl-name">
              <Input id="cl-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="WhatsApp" htmlFor="cl-phone" hint="Com DDD. Só aparece para quem você contratar.">
              <Input id="cl-phone" inputMode="tel" placeholder="(21) 98888-7777" value={phone} onChange={(e) => setPhone(maskPhone(e.target.value))} />
            </Field>
          </div>
          <Button className="mt-4" loading={busy === "profile"} onClick={() => void saveProfile()}>
            Salvar dados
          </Button>
        </Card>

        {/* Endereços */}
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-5 pt-5">
            <h2 className="text-base font-semibold text-petroleo">Endereços</h2>
            {addresses.length < 10 && (
              <Button variant="outline" className="h-9" onClick={() => setEditing("new")}>
                <Plus className="h-4 w-4" aria-hidden /> Novo endereço
              </Button>
            )}
          </div>
          {addresses.length === 0 ? (
            <p className="px-5 py-6 text-sm text-grafite-500">Nenhum endereço ainda. Cadastre pelo CEP: a rua, o bairro e a cidade são preenchidos sozinhos.</p>
          ) : (
            <ul className="mt-3 divide-y divide-grafite/5" data-testid="address-list">
              {addresses.map((a) => (
                <li key={a.id} className="flex flex-wrap items-start gap-3 px-5 py-4">
                  <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-petroleo" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-grafite">
                      {a.label}
                      {a.is_default && <span className="rounded-full bg-agua-50 px-2 py-0.5 text-[11px] font-semibold text-petroleo">Principal</span>}
                    </p>
                    <p className="text-sm text-grafite-500">{formatAddress(a)}</p>
                    <p className="text-xs text-grafite-500">
                      {a.municipality ? (
                        `Município: ${a.municipality.name}`
                      ) : (
                        <span className="text-amber-700">Fora do estado do RJ: por enquanto o Limpa Aqui atende só o Rio de Janeiro.</span>
                      )}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    {!a.is_default && (
                      <button
                        type="button"
                        disabled={busy === a.id}
                        onClick={() => void makeDefault(a)}
                        className="rounded-lg p-2 text-grafite-500 hover:bg-nevoa"
                        aria-label={`Tornar ${a.label} o endereço principal`}
                        title="Tornar principal"
                      >
                        <Star className="h-4 w-4" />
                      </button>
                    )}
                    <button type="button" onClick={() => setEditing(a)} className="rounded-lg p-2 text-grafite-500 hover:bg-nevoa" aria-label={`Editar ${a.label}`}>
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      disabled={busy === a.id}
                      onClick={() => void remove(a)}
                      className="rounded-lg p-2 text-grafite-500 hover:bg-red-50 hover:text-red-600"
                      aria-label={`Apagar ${a.label}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Anúncios */}
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
            <div>
              <h2 className="text-base font-semibold text-petroleo">Meus pedidos de orçamento</h2>
              <p className="text-xs text-grafite-500">Descreva o que precisa e receba propostas dos prestadores da sua região.</p>
            </div>
            <Button className="h-9" onClick={() => setNewListing(true)}>
              <Plus className="h-4 w-4" aria-hidden /> Publicar anúncio
            </Button>
          </div>
          {listings.length === 0 ? (
            <p className="px-5 py-6 text-sm text-grafite-500">Nenhum anúncio ainda.</p>
          ) : (
            <ul className="mt-3 divide-y divide-grafite/5" data-testid="listing-list">
              {listings.map((l) => (
                <li key={l.id}>
                  <Link to={`/cliente/anuncios/${l.id}`} className="flex flex-wrap items-center gap-3 px-5 py-4 hover:bg-nevoa/60">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-grafite">{l.title}</p>
                      <p className="text-xs text-grafite-500">
                        {l.category_name} · {l.municipality_name} · {listingStatus(l)}
                      </p>
                    </div>
                    <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", l.proposals > 0 ? "bg-agua-50 text-petroleo" : "bg-nevoa text-grafite-500")}>
                      {l.proposals} {l.proposals === 1 ? "proposta" : "propostas"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <NotificationSettings />
      </div>

      {newListing && (
        <ListingModal
          addresses={addresses}
          onClose={() => setNewListing(false)}
          onSaved={async () => {
            setNewListing(false);
            setMsg({ kind: "success", text: "Anúncio publicado! Os prestadores da sua região já podem mandar propostas." });
            await load();
          }}
        />
      )}

      {editing && (
        <AddressModal
          address={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async (text) => {
            setEditing(null);
            setMsg({ kind: "success", text });
            await load();
          }}
        />
      )}
    </ClientShell>
  );
}
