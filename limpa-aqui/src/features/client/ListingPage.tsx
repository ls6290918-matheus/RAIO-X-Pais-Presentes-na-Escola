import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Bike, Clock, Store } from "lucide-react";
import { Alert, Button, Card, EmptyState, InlineLoader, Modal, PageHeader, cn } from "@/components/shared/ui";
import { ClientShell } from "./ClientShell";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { formatBRL, formatDate } from "@/lib/format";
import { logoUrl } from "@/lib/logo";
import type { LogisticsMode, PaymentMode } from "@/lib/types";
import { HireOptions, type CourierQuote } from "./HireOptions";
import { loadListingExtras } from "@/lib/listingPhotos";
import { ListingExtrasView } from "./ListingExtrasView";
import { ChatButton } from "@/features/chat/Chat";
import { loadRatings } from "@/lib/ratings";
import { RatingBadge } from "@/components/shared/Stars";

export type MyListing = {
  id: string;
  category_name: string;
  title: string;
  description: string | null;
  neighborhood: string | null;
  municipality_name: string;
  wants_pickup: boolean;
  status: "aberto" | "contratado" | "cancelado";
  expired: boolean;
  created_at: string;
  expires_at: string;
  proposals: number;
  order_id: string | null;
};
type Proposal = {
  id: string;
  business_name: string;
  business_slug: string;
  provider_type: "autonomo" | "empresa" | null;
  logo_path: string | null;
  price: number;
  due_days: number;
  message: string | null;
  offers_pickup: boolean;
  status: "enviada" | "aceita" | "recusada" | "retirada";
  created_at: string;
};

export const listingStatus = (l: MyListing) =>
  l.status === "contratado" ? "Contratado" : l.status === "cancelado" ? "Encerrado" : l.expired ? "Expirado" : "Recebendo propostas";

/** /cliente/anuncios/:id — propostas recebidas num anúncio; aceitar vira pedido. */
export default function ListingPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [listing, setListing] = useState<MyListing | null | undefined>(undefined);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [extras, setExtras] = useState<Awaited<ReturnType<typeof loadListingExtras>>>(new Map());
  const [ratings, setRatings] = useState<Map<string, { rating: number; reviews: number }>>(new Map());
  const [choosing, setChoosing] = useState<Proposal | null>(null);
  const [logistics, setLogistics] = useState<LogisticsMode>("sem_logistica");
  const [payment, setPayment] = useState<PaymentMode>("direto");
  const [accepts, setAccepts] = useState<{ direct: boolean; app: boolean } | null>(null);
  const [notes, setNotes] = useState("");
  const [quote, setQuote] = useState<CourierQuote | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [l, p] = await Promise.all([supabase.rpc("my_listings"), supabase.rpc("listing_proposals", { p_listing_id: id })]);
    setListing(((l.data as MyListing[]) ?? []).find((x) => x.id === id) ?? null);
    const props = ((p.data as Proposal[]) ?? []).map((x) => ({ ...x, price: Number(x.price) }));
    setProposals(props);
    setExtras(await loadListingExtras([id]));
    setRatings(await loadRatings(props.map((x) => x.business_slug)));
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function accept() {
    if (!choosing) return;
    setBusy(true);
    setMsg(null);
    const { data: orderId, error } = await supabase.rpc("accept_proposal", { p_proposal_id: choosing.id, p_logistics: logistics, p_payment: payment, p_notes: notes.trim() || null });
    setBusy(false);
    if (error) return setMsg(friendlyError(error));
    if (payment === "app") return navigate(`/cliente/pagar/${orderId as string}`);
    navigate("/cliente", { state: { success: `Pronto! Você contratou ${choosing.business_name}. Acompanhe em "Pedidos".` } });
  }

  async function cancel() {
    if (!window.confirm("Encerrar este anúncio? As propostas recebidas serão recusadas.")) return;
    const { error } = await supabase.rpc("cancel_listing", { p_listing_id: id });
    if (error) return setMsg(friendlyError(error));
    await load();
  }

  if (listing === undefined)
    return (
      <ClientShell>
        <InlineLoader />
      </ClientShell>
    );
  if (listing === null)
    return (
      <ClientShell>
        <Card>
          <EmptyState icon={<Store className="h-6 w-6" />} title="Anúncio não encontrado" description="Volte para a sua área de cliente." />
        </Card>
      </ClientShell>
    );

  const open = listing.status === "aberto" && !listing.expired;

  return (
    <ClientShell>
      <div className="space-y-6">
        <Link to="/cliente/conta" className="inline-flex items-center gap-1 text-sm font-semibold text-petroleo hover:underline">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Minha área
        </Link>
        <PageHeader
          title={listing.title}
          description={`${listing.category_name} · ${[listing.neighborhood, listing.municipality_name].filter(Boolean).join(", ")} · ${listingStatus(listing)}`}
          action={
            open && (
              <Button variant="outline" onClick={() => void cancel()}>
                Encerrar anúncio
              </Button>
            )
          }
        />
        {msg && <Alert>{msg}</Alert>}
        {(listing.description || (() => { const e = extras.get(id); return !!e && (!!e.quantity || !!e.desired_date || e.urls.length > 0); })()) && (
          <Card className="p-5 text-sm text-grafite">
            {listing.description}
            <ListingExtrasView extras={extras.get(id)} />
          </Card>
        )}
        {open && (
          <p className="text-xs text-grafite-500">Recebendo propostas até {formatDate(listing.expires_at)}. Escolha uma para contratar.</p>
        )}

        {proposals.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Clock className="h-6 w-6" />}
              title="Nenhuma proposta ainda"
              description="Os prestadores da sua região estão sendo avisados pelo painel deles. Volte daqui a pouco."
            />
          </Card>
        ) : (
          <ul className="space-y-3" data-testid="proposal-list">
            {proposals.map((p) => (
              <li key={p.id}>
                <Card className={cn("p-5", p.status === "aceita" && "border-agua")}>
                  <div className="flex flex-wrap items-start gap-3">
                    {p.logo_path ? (
                      <img src={logoUrl(p.logo_path) ?? undefined} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover" />
                    ) : (
                      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-petroleo text-agua">
                        <Store className="h-5 w-5" aria-hidden />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <Link to={`/p/${p.business_slug}`} className="text-base font-semibold text-petroleo hover:underline">
                        {p.business_name}
                      </Link>
                      <RatingBadge className="ml-2" rating={ratings.get(p.business_slug)?.rating} count={ratings.get(p.business_slug)?.reviews} />
                      <p className="text-xs text-grafite-500">
                        Prazo: {p.due_days} {p.due_days === 1 ? "dia" : "dias"}
                        {p.offers_pickup && (
                          <span className="ml-2 inline-flex items-center gap-1 font-semibold text-petroleo">
                            <Bike className="h-3 w-3" aria-hidden /> busca e entrega
                          </span>
                        )}
                      </p>
                    </div>
                    <p className="text-lg font-semibold text-petroleo">{formatBRL(p.price)}</p>
                  </div>
                  {p.message && <p className="mt-3 text-sm text-grafite">“{p.message}”</p>}
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <span className="text-xs text-grafite-500">
                      {p.status === "aceita" ? "Proposta aceita" : p.status === "recusada" ? "Não escolhida" : `Recebida em ${formatDate(p.created_at)}`}
                    </span>
                    <div className="flex flex-wrap gap-2">
                    {(p.status === "enviada" || p.status === "aceita") && (
                      <ChatButton kind="proposta" args={{ proposalId: p.id }} basePath="/cliente/mensagens" />
                    )}
                    {open && p.status === "enviada" && (
                      <Button
                        onClick={() => {
                          setChoosing(p);
                          setQuote(undefined);
                          void supabase.rpc("quote_proposal_delivery", { p_proposal_id: p.id }).then(({ data }) => setQuote(((data as CourierQuote[]) ?? [])[0] ?? null));
                          setLogistics(p.offers_pickup && listing.wants_pickup ? "prestador" : "sem_logistica");
                          setAccepts(null);
                          void supabase.rpc("get_public_provider", { p_slug: p.business_slug }).then(({ data }) => {
                            const d = data as { accepts_direct_payment?: boolean; accepts_app_payment?: boolean } | null;
                            const a = { direct: d?.accepts_direct_payment ?? true, app: d?.accepts_app_payment ?? false };
                            setAccepts(a);
                            setPayment(a.direct ? "direto" : "app");
                          });
                        }}
                      >
                        Aceitar proposta
                      </Button>
                    )}
                    </div>
                    {listing.order_id && p.status === "aceita" && (
                      <Link to="/cliente/pedidos" className="text-sm font-semibold text-petroleo hover:underline">
                        Ver em Meus pedidos
                      </Link>
                    )}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>

      {choosing && (
        <Modal open title={`Contratar ${choosing.business_name}`} onClose={() => setChoosing(null)}>
          <div className="space-y-4">
            {msg && <Alert>{msg}</Alert>}
            <div className="flex items-center justify-between rounded-xl border border-grafite/10 p-3 text-sm">
              <span className="text-grafite">{listing.title}</span>
              <span className="font-semibold text-petroleo">{formatBRL(choosing.price)}</span>
            </div>
            {accepts === null ? (
              <InlineLoader />
            ) : (
              <HireOptions
                courier={quote}
                pickupAvailable={choosing.offers_pickup}
                logistics={logistics}
                onLogistics={setLogistics}
                notes={notes}
                onNotes={setNotes}
                payment={payment}
                onPayment={setPayment}
                acceptsDirect={accepts.direct}
                acceptsApp={accepts.app}
              />
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setChoosing(null)}>
                Voltar
              </Button>
              <Button loading={busy} disabled={accepts === null} onClick={() => void accept()}>
                {payment === "app" ? "Contratar e pagar com Pix" : "Confirmar contratação"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </ClientShell>
  );
}
