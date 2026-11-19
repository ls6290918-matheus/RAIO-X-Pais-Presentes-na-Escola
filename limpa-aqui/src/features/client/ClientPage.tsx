import { useCallback, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { CheckCircle2, Circle, MapPin, MessageCircle, Package, Pencil, Plus, Search, Star, Trash2 } from "lucide-react";
import { Alert, Button, Card, EmptyState, Field, InlineLoader, Input, Modal, PageHeader, Select, buttonClass, cn } from "@/components/shared/ui";
import { SimpleLayout } from "@/components/layout/SimpleLayout";
import { AddressFields, type AddressForm, fromAddressForm, toAddressForm, validateAddress } from "@/components/shared/AddressFields";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { formatBRL, formatDate, maskPhone, onlyDigits, whatsappLink } from "@/lib/format";
import { ADDRESS_COLUMNS, formatAddress, type Address } from "@/lib/maps";
import { STATUS_LABEL, STATUS_STYLE } from "@/features/orders/status";
import { LOGISTICS_LABEL, PAYMENT_LABEL } from "@/lib/marketplace";
import { ListingModal } from "./ListingModal";
import { OrderDeliveriesCard } from "@/features/orders/OrderDeliveriesCard";
import { listingStatus, type MyListing } from "./ListingPage";
import type { LogisticsMode, OrderStatus, PaymentMode } from "@/lib/types";

type UserAddress = Address & {
  id: string;
  label: string;
  is_default: boolean;
  municipality_id: number | null;
  municipality: { name: string } | null;
};
type MyOrder = {
  id: string;
  number: number;
  status: OrderStatus;
  created_at: string;
  due_date: string;
  total: number;
  paid: boolean;
  business_name: string;
  business_whatsapp: string | null;
  items: Array<{ name: string; quantity: number; unit_price: number }>;
  payment_mode: PaymentMode | null;
  logistics_mode: LogisticsMode | null;
  delivery_fee_total: number;
};

const LABELS = ["Casa", "Trabalho", "Outro"];

/** /cliente — área de quem contrata: dados, endereços e pedidos. */
export default function ClientPage() {
  const { user } = useAuth();
  const location = useLocation();
  const [listings, setListings] = useState<MyListing[]>([]);
  const [newListing, setNewListing] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [savedPhone, setSavedPhone] = useState<string | null>(null);
  const [addresses, setAddresses] = useState<UserAddress[] | null>(null);
  const [orders, setOrders] = useState<MyOrder[]>([]);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(
    (location.state as { success?: string } | null)?.success ? { kind: "success", text: (location.state as { success: string }).success } : null,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<UserAddress | "new" | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    const [p, a, o, l] = await Promise.all([
      supabase.from("profiles").select("full_name, phone").eq("id", user.id).maybeSingle(),
      supabase
        .from("user_addresses")
        .select(`id, label, is_default, municipality_id, ${ADDRESS_COLUMNS}, municipality:municipalities(name)`)
        .order("created_at"),
      supabase.rpc("my_orders"),
      supabase.rpc("my_listings"),
    ]);
    const err = p.error ?? a.error ?? o.error;
    if (err) setMsg({ kind: "error", text: friendlyError(err) });
    setName(p.data?.full_name ?? String(user.user_metadata?.full_name ?? ""));
    setPhone(maskPhone(p.data?.phone ?? ""));
    setSavedPhone(p.data?.phone ?? null);
    setAddresses((a.data as unknown as UserAddress[]) ?? []);
    setOrders((o.data as MyOrder[]) ?? []);
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
      <SimpleLayout>
        <InlineLoader />
      </SimpleLayout>
    );

  const steps = [
    { done: !!savedPhone, label: "Informe seu WhatsApp, para os prestadores falarem com você" },
    { done: addresses.length > 0, label: "Cadastre o endereço onde os itens serão coletados ou entregues" },
  ];
  const firstName = name.split(" ")[0];

  return (
    <SimpleLayout>
      <div className="space-y-6">
        <PageHeader title={firstName ? `Olá, ${firstName}` : "Contratar serviços"} description="Seus dados, endereços e pedidos." />
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

        <Card className="flex flex-wrap items-center gap-3 p-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-agua-50 text-petroleo">
            <Search className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-petroleo">Encontrar quem lava</h2>
            <p className="mt-1 text-sm text-grafite-500">Veja lavanderias e autônomos que atendem a sua cidade, com preços e distância.</p>
          </div>
          <Link to="/buscar" className={buttonClass()}>
            Buscar prestadores
          </Link>
        </Card>

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
              <h2 className="text-base font-semibold text-petroleo">Meus anúncios</h2>
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

        {/* Pedidos */}
        <Card className="overflow-hidden">
          <h2 className="px-5 pt-5 text-base font-semibold text-petroleo">Meus pedidos</h2>
          {orders.length === 0 ? (
            <EmptyState
              icon={<Package className="h-6 w-6" />}
              title="Nenhum pedido ainda"
              description="Quando você contratar um serviço pelo Limpa Aqui, ele aparece aqui com a situação atualizada pela lavanderia."
            />
          ) : (
            <ul className="mt-3 divide-y divide-grafite/5" data-testid="order-list">
              {orders.map((o) => (
                <li key={o.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="flex-1 text-sm font-semibold text-grafite">
                      {o.business_name} · Pedido nº {o.number}
                    </p>
                    <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", STATUS_STYLE[o.status])}>{STATUS_LABEL[o.status]}</span>
                  </div>
                  <p className="mt-1 text-sm text-grafite-500">{o.items.map((i) => `${i.quantity}× ${i.name}`).join(", ") || "Sem itens"}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-grafite-500">
                    <span>Feito em {formatDate(o.created_at)}</span>
                    <span>Previsão {formatDate(`${o.due_date}T12:00:00`)}</span>
                    {o.payment_mode && <span>{PAYMENT_LABEL[o.payment_mode]}</span>}
                    {o.logistics_mode && <span>{LOGISTICS_LABEL[o.logistics_mode]}</span>}
                    {o.paid && <span className="font-semibold text-agua-600">Pagamento confirmado</span>}
                    {Number(o.delivery_fee_total) > 0 && (
                      <span>
                        Entregas: {formatBRL(Number(o.delivery_fee_total))} ({o.payment_mode === "app" ? "pagas pelo app" : "pagas ao entregador"})
                      </span>
                    )}
                    <span className="font-semibold text-grafite">{formatBRL(o.total)}</span>
                    {o.business_whatsapp && (
                      <a
                        href={whatsappLink(o.business_whatsapp, `Olá! Sobre o meu pedido nº ${o.number}.`)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-semibold text-petroleo hover:underline"
                      >
                        <MessageCircle className="h-3.5 w-3.5" aria-hidden /> Falar com a lavanderia
                      </a>
                    )}
                  </div>
                  {o.payment_mode === "app" && !o.paid && o.status !== "cancelado" && (
                    <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-amber-50 p-3">
                      <span className="flex-1 text-sm font-semibold text-amber-800">Aguardando pagamento: o pedido começa depois do Pix.</span>
                      <Link to={`/cliente/pagar/${o.id}`} className={buttonClass("primary")}>
                        Pagar {formatBRL(Number(o.total) + Number(o.delivery_fee_total ?? 0))} com Pix
                      </Link>
                    </div>
                  )}
                  {o.logistics_mode === "entregador" && (
                    <div className="mt-2 rounded-lg bg-nevoa p-2">
                      <OrderDeliveriesCard orderId={o.id} compact />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
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
    </SimpleLayout>
  );
}

function AddressModal({ address, onClose, onSaved }: { address: UserAddress | null; onClose: () => void; onSaved: (msg: string) => Promise<void> }) {
  const initialLabel = address?.label ?? "Casa";
  const [labelKind, setLabelKind] = useState(LABELS.includes(initialLabel) && initialLabel !== "Outro" ? initialLabel : "Outro");
  const [customLabel, setCustomLabel] = useState(LABELS.includes(initialLabel) ? "" : initialLabel);
  const [form, setForm] = useState<AddressForm>(toAddressForm(address));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const e = validateAddress(form, { requireCity: true });
    const label = labelKind === "Outro" ? customLabel.trim() : labelKind;
    if (!label || label.length > 30) e.label = "Dê um nome de até 30 letras (ex.: Casa da mãe).";
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    setError(null);
    const row = { label, ...fromAddressForm(form) };
    const { error: err } = address
      ? await supabase.from("user_addresses").update(row).eq("id", address.id)
      : await supabase.from("user_addresses").insert(row);
    setSaving(false);
    if (err) return setError(friendlyError(err));
    await onSaved(address ? "Endereço atualizado." : "Endereço cadastrado.");
  }

  return (
    <Modal open title={address ? "Editar endereço" : "Novo endereço"} onClose={onClose}>
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome do endereço" htmlFor="ad-label" error={labelKind !== "Outro" ? errors.label : undefined}>
            <Select id="ad-label" value={labelKind} onChange={(e) => setLabelKind(e.target.value)}>
              {LABELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          {labelKind === "Outro" && (
            <Field label="Qual?" htmlFor="ad-custom" error={errors.label}>
              <Input id="ad-custom" placeholder="Ex.: Casa da mãe" maxLength={30} value={customLabel} onChange={(e) => setCustomLabel(e.target.value)} />
            </Field>
          )}
        </div>
        <AddressFields value={form} onChange={setForm} errors={errors} idPrefix="ad" />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={saving} onClick={() => void save()}>
            Salvar endereço
          </Button>
        </div>
      </div>
    </Modal>
  );
}
