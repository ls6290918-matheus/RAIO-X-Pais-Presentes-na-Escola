import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Minus, Plus } from "lucide-react";
import { Alert, Button, Field, InlineLoader, Modal, Select, buttonClass, cn } from "@/components/shared/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useRoles } from "@/contexts/RolesContext";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { formatBRL } from "@/lib/format";
import { priceLabel } from "@/lib/pricing";
import type { LogisticsMode, PaymentMode } from "@/lib/types";
import { HireOptions, type CourierQuote } from "@/features/client/HireOptions";
import type { PublicProvider } from "./types";

type Addr = { id: string; label: string; is_default: boolean; municipality: { name: string } | null };

/** Contratar direto pelo perfil: escolhe serviços do catálogo (preço do catálogo), endereço, logística e pagamento. */
export function HireModal({ provider, onClose }: { provider: PublicProvider; onClose: () => void }) {
  const { user } = useAuth();
  const { hasRole, addRole } = useRoles();
  const navigate = useNavigate();
  const [addresses, setAddresses] = useState<Addr[] | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [addressId, setAddressId] = useState("");
  const [qty, setQty] = useState<Record<string, number>>({});
  const [logistics, setLogistics] = useState<LogisticsMode>("sem_logistica");
  const [payment, setPayment] = useState<PaymentMode>(provider.accepts_direct_payment ? "direto" : "app");
  const [notes, setNotes] = useState("");
  const [quote, setQuote] = useState<CourierQuote | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      if (!hasRole("anunciante")) await addRole("anunciante");
      const [a, p] = await Promise.all([
        supabase.from("user_addresses").select("id, label, is_default, municipality:municipalities(name)").order("created_at"),
        supabase.from("profiles").select("phone").eq("id", user!.id).maybeSingle(),
      ]);
      const list = ((a.data as unknown as Addr[]) ?? []).filter((x) => x.municipality);
      setAddresses(list);
      setAddressId(list.find((x) => x.is_default)?.id ?? list[0]?.id ?? "");
      setPhone(p.data?.phone ?? null);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!addressId) return;
    setQuote(undefined);
    void supabase.rpc("quote_delivery", { p_business_id: provider.id, p_address_id: addressId }).then(({ data }) => {
      const q = ((data as CourierQuote[]) ?? [])[0] ?? null;
      setQuote(q);
      if (!q?.available && logistics === "entregador") setLogistics("sem_logistica");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressId, provider.id]);

  const hireable = provider.services.filter((s) => s.pricing_unit !== "orcamento");
  const quoteOnly = provider.services.filter((s) => s.pricing_unit === "orcamento");
  const total = useMemo(
    () => hireable.reduce((sum, s) => sum + (qty[s.id] ?? 0) * Number(s.price), 0),
    [qty, hireable],
  );
  const items = Object.entries(qty).filter(([, q]) => q > 0);
  const step = (id: string, d: number) => setQty((q) => ({ ...q, [id]: Math.max(0, Math.min(50, (q[id] ?? 0) + d)) }));

  async function confirm() {
    setError(null);
    if (!items.length) return setError("Escolha pelo menos um serviço.");
    setBusy(true);
    const { data: orderId, error: err } = await supabase.rpc("hire_services", {
      p_business_id: provider.id,
      p_items: items.map(([service_id, quantity]) => ({ service_id, quantity })),
      p_address_id: addressId,
      p_logistics: logistics,
      p_payment: payment,
      p_notes: notes.trim() || null,
    });
    setBusy(false);
    if (err) return setError(friendlyError(err));
    if (payment === "app") return navigate(`/cliente/pagar/${orderId as string}`);
    navigate("/cliente", { state: { success: `Pronto! Seu pedido foi enviado para ${provider.name}. Acompanhe em "Meus pedidos".` } });
  }

  const ready = addresses && addresses.length > 0 && phone;

  return (
    <Modal open title={`Contratar ${provider.name}`} onClose={onClose}>
      {addresses === null ? (
        <InlineLoader />
      ) : !ready ? (
        <div className="space-y-4">
          <Alert>
            {!phone && addresses.length === 0
              ? "Antes de contratar, informe seu WhatsApp e cadastre seu endereço."
              : !phone
                ? "Antes de contratar, informe seu WhatsApp para o prestador falar com você."
                : "Antes de contratar, cadastre um endereço no estado do RJ."}
          </Alert>
          <Link to="/cliente" className={buttonClass()}>
            Completar meu cadastro
          </Link>
        </div>
      ) : (
        <div className="space-y-5">
          {error && <Alert>{error}</Alert>}
          <div>
            <p className="mb-2 text-sm font-semibold text-grafite">Serviços</p>
            <ul className="divide-y divide-grafite/5 rounded-xl border border-grafite/10" data-testid="hire-services">
              {hireable.map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-grafite">{s.name}</p>
                    <p className="text-xs text-grafite-500">{priceLabel(Number(s.price), s.pricing_unit)}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => step(s.id, -1)} className="rounded-lg border border-grafite/15 p-1.5" aria-label={`Menos ${s.name}`}>
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <span className={cn("w-7 text-center text-sm font-semibold", (qty[s.id] ?? 0) > 0 ? "text-petroleo" : "text-grafite-500")}>{qty[s.id] ?? 0}</span>
                    <button type="button" onClick={() => step(s.id, 1)} className="rounded-lg border border-grafite/15 p-1.5" aria-label={`Mais ${s.name}`}>
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            {quoteOnly.length > 0 && (
              <p className="mt-2 text-xs text-grafite-500">
                {quoteOnly.map((s) => s.name).join(", ")}: sob orçamento. Para esses, publique um anúncio na sua área de cliente e receba a proposta.
              </p>
            )}
          </div>
          <Field label="Endereço" htmlFor="hire-addr">
            <Select id="hire-addr" value={addressId} onChange={(e) => setAddressId(e.target.value)}>
              {addresses.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label} · {a.municipality?.name}
                </option>
              ))}
            </Select>
          </Field>
          <HireOptions
            courier={quote}
            pickupAvailable={provider.offers_pickup}
            logistics={logistics}
            onLogistics={setLogistics}
            notes={notes}
            onNotes={setNotes}
            payment={payment}
            onPayment={setPayment}
            acceptsDirect={provider.accepts_direct_payment}
            acceptsApp={provider.accepts_app_payment}
          />
          <div className="flex items-center justify-between rounded-xl bg-petroleo px-4 py-3 text-white">
            <span className="text-sm">Total estimado{logistics === "entregador" && quote?.available ? " (com entregas)" : ""}</span>
            <span className="text-lg font-semibold" data-testid="hire-total">
              {formatBRL(total + (logistics === "entregador" && quote?.available ? Number(quote.total) : 0))}
            </span>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Voltar
            </Button>
            <Button loading={busy} disabled={!items.length} onClick={() => void confirm()}>
              {payment === "app" ? "Contratar e pagar com Pix" : "Confirmar contratação"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
