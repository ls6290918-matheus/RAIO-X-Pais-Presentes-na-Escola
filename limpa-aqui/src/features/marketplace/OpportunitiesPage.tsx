import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bike, Inbox, MapPin } from "lucide-react";
import { Alert, Button, Card, EmptyState, Field, InlineLoader, Input, Modal, PageHeader, Textarea, buttonClass, cn } from "@/components/shared/ui";
import { useBusiness } from "@/contexts/BusinessContext";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { formatBRL, formatDate, moneyInput, parseMoney } from "@/lib/format";
import { loadListingExtras } from "@/lib/listingPhotos";
import { ListingExtrasView } from "@/features/client/ListingExtrasView";
import { ChatButton } from "@/features/chat/Chat";

type Opportunity = {
  id: string;
  category_code: string;
  category_name: string;
  title: string;
  description: string | null;
  neighborhood: string | null;
  municipality_name: string;
  wants_pickup: boolean;
  created_at: string;
  expires_at: string;
  proposals: number;
  my_proposal_id: string | null;
  my_status: "enviada" | "aceita" | "recusada" | "retirada" | null;
  my_price: number | null;
  my_due_days: number | null;
};

const MY_STATUS: Record<string, string> = { enviada: "Proposta enviada", aceita: "Aceita", recusada: "Não escolhida", retirada: "Retirada" };

/** /app/oportunidades — anúncios de clientes nos municípios que a lavanderia atende. Só o dono propõe. */
export default function OpportunitiesPage() {
  const { business } = useBusiness();
  const [items, setItems] = useState<Opportunity[] | null>(null);
  const [extras, setExtras] = useState<Awaited<ReturnType<typeof loadListingExtras>>>(new Map());
  const [market, setMarket] = useState<{ visible: boolean; pickup: boolean } | null>(null);
  const [editing, setEditing] = useState<Opportunity | null>(null);
  const [price, setPrice] = useState("");
  const [days, setDays] = useState("3");
  const [message, setMessage] = useState("");
  const [pickup, setPickup] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!business) return;
    const [o, b] = await Promise.all([
      supabase.rpc("provider_open_listings", { p_business_id: business.id }),
      supabase.from("businesses").select("marketplace_visible, offers_pickup").eq("id", business.id).single(),
    ]);
    if (o.error) setMsg({ kind: "error", text: friendlyError(o.error) });
    const list = ((o.data as Opportunity[]) ?? []).map((x) => ({ ...x, my_price: x.my_price == null ? null : Number(x.my_price), proposals: Number(x.proposals) }));
    setItems(list);
    setExtras(await loadListingExtras(list.map((x) => x.id)));
    setMarket(b.data ? { visible: b.data.marketplace_visible, pickup: b.data.offers_pickup } : null);
  }, [business]);

  useEffect(() => {
    void load();
  }, [load]);

  function openForm(o: Opportunity) {
    setEditing(o);
    setPrice(o.my_price ? moneyInput(o.my_price) : "");
    setDays(String(o.my_due_days ?? 3));
    setMessage("");
    setPickup(Boolean(market?.pickup && o.wants_pickup));
    setFormError(null);
  }

  async function send() {
    if (!editing || !business) return;
    const value = parseMoney(price);
    const d = Number(days);
    if (!value || value <= 0) return setFormError("Informe o valor da proposta.");
    if (!Number.isInteger(d) || d < 1 || d > 60) return setFormError("Prazo entre 1 e 60 dias.");
    setBusy("send");
    const { error } = await supabase.rpc("send_proposal", {
      p_listing_id: editing.id,
      p_business_id: business.id,
      p_price: value,
      p_due_days: d,
      p_message: message.trim() || null,
      p_offers_pickup: pickup,
    });
    setBusy(null);
    if (error) return setFormError(friendlyError(error));
    setEditing(null);
    setMsg({ kind: "success", text: "Proposta enviada. O cliente é avisado na área dele." });
    await load();
  }

  async function withdraw(o: Opportunity) {
    if (!o.my_proposal_id || !window.confirm("Retirar sua proposta?")) return;
    setBusy(o.id);
    const { error } = await supabase.rpc("withdraw_proposal", { p_proposal_id: o.my_proposal_id });
    setBusy(null);
    if (error) return setMsg({ kind: "error", text: friendlyError(error) });
    await load();
  }

  if (items === null) return <InlineLoader />;

  return (
    <div className="space-y-6">
      <PageHeader title="Oportunidades" description="Clientes da sua região pedindo serviço. Mande sua proposta com preço e prazo." />
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {market && !market.visible && (
        <Alert>
          Sua lavanderia não está aparecendo na busca, então não pode enviar propostas.{" "}
          <Link to="/app/configuracoes" className="font-semibold underline">
            Ligue "Aparecer na busca" em Configurações
          </Link>
          .
        </Alert>
      )}

      {items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Inbox className="h-6 w-6" />}
            title="Nenhum anúncio aberto na sua região"
            description="Quando um cliente dos municípios que você atende publicar um anúncio, ele aparece aqui."
          />
        </Card>
      ) : (
        <ul className="space-y-3" data-testid="opportunity-list">
          {items.map((o) => (
            <li key={o.id}>
              <Card className="p-5">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-base font-semibold text-petroleo">{o.title}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-grafite-500">
                      <span>{o.category_name}</span>
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3 w-3" aria-hidden /> {[o.neighborhood, o.municipality_name].filter(Boolean).join(", ")}
                      </span>
                      {o.wants_pickup && (
                        <span className="inline-flex items-center gap-1 font-semibold text-petroleo">
                          <Bike className="h-3 w-3" aria-hidden /> quer coleta
                        </span>
                      )}
                      <span>Publicado em {formatDate(o.created_at)}</span>
                      <span>{o.proposals} {o.proposals === 1 ? "proposta" : "propostas"}</span>
                    </p>
                  </div>
                  {o.my_status && (
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-1 text-xs font-semibold",
                        o.my_status === "enviada" ? "bg-amber-50 text-amber-700" : o.my_status === "aceita" ? "bg-agua-50 text-petroleo" : "bg-nevoa text-grafite-500",
                      )}
                    >
                      {MY_STATUS[o.my_status]}
                      {o.my_status === "enviada" && o.my_price != null && ` · ${formatBRL(o.my_price)}`}
                    </span>
                  )}
                </div>
                {o.description && <p className="mt-3 text-sm text-grafite">{o.description}</p>}
                <ListingExtrasView extras={extras.get(o.id)} />
                {market?.visible && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(!o.my_status || o.my_status === "enviada" || o.my_status === "retirada") && (
                      <Button className="h-9" onClick={() => openForm(o)}>
                        {o.my_status === "enviada" ? "Alterar proposta" : "Enviar proposta"}
                      </Button>
                    )}
                    {o.my_status === "enviada" && (
                      <Button variant="outline" className="h-9" loading={busy === o.id} onClick={() => void withdraw(o)}>
                        Retirar
                      </Button>
                    )}
                    {business && <ChatButton kind="anuncio" args={{ listingId: o.id, businessId: business.id }} basePath="/app/mensagens" label="Perguntar ao cliente" />}
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <Modal open title="Sua proposta" onClose={() => setEditing(null)}>
          <div className="space-y-4">
            <p className="text-sm text-grafite">{editing.title}</p>
            {formError && <Alert>{formError}</Alert>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Valor total (R$)" htmlFor="pr-price">
                <Input id="pr-price" inputMode="decimal" placeholder="0,00" value={price} onChange={(e) => setPrice(e.target.value)} />
              </Field>
              <Field label="Prazo (dias)" htmlFor="pr-days">
                <Input id="pr-days" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, "").slice(0, 2))} />
              </Field>
            </div>
            <Field label="Mensagem (opcional)" htmlFor="pr-msg" hint="Como você faz o serviço, o que está incluso...">
              <Textarea id="pr-msg" rows={3} maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} />
            </Field>
            <label className={cn("flex items-center gap-2 text-sm", market?.pickup ? "text-grafite" : "text-grafite-500")}>
              <input type="checkbox" className="h-4 w-4 accent-agua" checked={pickup} disabled={!market?.pickup} onChange={(e) => setPickup(e.target.checked)} />
              Busco e entrego no endereço do cliente {!market?.pickup && "(ative a coleta em Configurações)"}
            </label>
            <p className="text-xs text-grafite-500">Pagamento direto a você. O endereço completo e o WhatsApp do cliente aparecem no pedido quando ele aceitar.</p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditing(null)}>
                Cancelar
              </Button>
              <Button loading={busy === "send"} onClick={() => void send()}>
                Enviar proposta
              </Button>
            </div>
          </div>
        </Modal>
      )}
      <p className="text-center text-xs text-grafite-500">
        <Link to="/app/pedidos" className={buttonClass("ghost")}>
          Ver pedidos recebidos pelo Limpa Aqui
        </Link>
      </p>
    </div>
  );
}
