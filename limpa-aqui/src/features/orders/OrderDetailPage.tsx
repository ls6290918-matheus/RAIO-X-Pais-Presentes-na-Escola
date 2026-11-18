import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Circle, MapPin, MessageCircle, Navigation, PackageX, Store, Truck } from "lucide-react";
import { Alert, Button, Card, EmptyState, Field, InlineLoader, Input, Textarea, buttonClass, cn } from "@/components/shared/ui";
import { useBusiness } from "@/contexts/BusinessContext";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { formatBRL, formatDateTime, formatDay, maskPhone, todayISO, whatsappLink } from "@/lib/format";
import type { DeliveryType, Order, OrderItem, OrderStatus } from "@/lib/types";
import { type Address, ADDRESS_COLUMNS, formatAddress, hasAddress, mapsLink } from "@/lib/maps";
import { NEXT_STEPS, OPEN_STATUSES, canCancel, whatsappMessage } from "./status";
import { StatusBadge } from "./StatusBadge";

type Detail = Order & {
  customers: ({ id: string; name: string; whatsapp: string | null } & Address) | null;
  order_items: OrderItem[];
};

const DETAIL_COLUMNS =
  "id, business_id, number, customer_id, status, due_date, total, paid, notes, delivery_type, received_at, ready_at, delivered_at, canceled_at, created_at, " +
  `customers(id, name, whatsapp, ${ADDRESS_COLUMNS}), order_items(id, service_id, service_name, description, quantity, unit_price, position)`;

export default function OrderDetailPage() {
  const { id } = useParams();
  const location = useLocation();
  const { business, settings } = useBusiness();
  const [order, setOrder] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(
    (location.state as { created?: boolean } | null)?.created ? { kind: "success", text: "Pedido criado." } : null,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");

  const load = useCallback(async () => {
    if (!id) return;
    const { data, error } = await supabase
      .from("orders")
      .select(DETAIL_COLUMNS)
      .eq("id", id)
      .order("position", { referencedTable: "order_items" })
      .maybeSingle();
    if (error) setMessage({ kind: "error", text: friendlyError(error) });
    const o = data as unknown as Detail | null;
    setOrder(o);
    if (o) {
      setDueDate(o.due_date);
      setNotes(o.notes ?? "");
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function changeStatus(to: OrderStatus) {
    if (!order) return;
    if (to === "cancelado" && !window.confirm(`Cancelar o pedido #${order.number}? Esta ação não pode ser desfeita.`)) return;
    setBusy(to);
    setMessage(null);
    const { error } = await supabase.rpc("set_order_status", { p_order_id: order.id, p_status: to });
    setBusy(null);
    if (error) return setMessage({ kind: "error", text: friendlyError(error) });
    await load();
  }

  async function update(fields: Partial<Pick<Order, "paid" | "due_date" | "notes" | "delivery_type">>, key: string, success: string) {
    if (!order) return;
    setBusy(key);
    setMessage(null);
    const { error } = await supabase.from("orders").update(fields).eq("id", order.id);
    setBusy(null);
    if (error) return setMessage({ kind: "error", text: friendlyError(error) });
    setOrder({ ...order, ...fields });
    setMessage({ kind: "success", text: success });
  }

  if (loading) return <InlineLoader />;
  if (!order) {
    return (
      <Card>
        <EmptyState
          icon={<PackageX className="h-6 w-6" />}
          title="Pedido não encontrado"
          description="O pedido pode ter sido removido ou o endereço está incorreto."
          action={
            <Link to="/app/pedidos" className={buttonClass("outline")}>
              Ver pedidos
            </Link>
          }
        />
      </Card>
    );
  }

  const today = todayISO(settings?.timezone);
  const isOpen = OPEN_STATUSES.includes(order.status);
  const late = isOpen && order.due_date < today;
  const customer = order.customers;
  const waText = whatsappMessage({
    customerName: customer?.name ?? "",
    businessName: business?.name ?? "",
    number: order.number,
    status: order.status,
    total: order.total,
    paid: order.paid,
    dueDate: formatDay(order.due_date),
    delivery: order.delivery_type === "entrega",
  });

  const timeline: Array<{ label: string; at: string | null }> =
    order.status === "cancelado"
      ? [
          { label: "Recebido", at: order.received_at },
          { label: "Cancelado", at: order.canceled_at },
        ]
      : [
          { label: "Recebido", at: order.received_at },
          { label: "Pronto", at: order.ready_at },
          { label: "Entregue", at: order.delivered_at },
        ];

  return (
    <div className="space-y-6">
      <div>
        <Link to="/app/pedidos" className="inline-flex items-center gap-1.5 text-sm font-medium text-grafite-500 hover:text-petroleo">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Pedidos
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-petroleo">Pedido #{order.number}</h1>
          <StatusBadge status={order.status} />
          {late && <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700">Atrasado</span>}
        </div>
        <p className="mt-1 text-sm text-grafite-500">Criado em {formatDateTime(order.created_at)}</p>
      </div>

      {message && <Alert kind={message.kind}>{message.text}</Alert>}

      {(NEXT_STEPS[order.status].length > 0 || canCancel(order.status)) && (
        <Card className="flex flex-wrap items-center gap-2 p-4">
          {NEXT_STEPS[order.status].map((step) => (
            <Button
              key={step.to}
              variant={step.primary ? "primary" : "outline"}
              loading={busy === step.to}
              disabled={!!busy}
              onClick={() => void changeStatus(step.to)}
            >
              {step.label}
            </Button>
          ))}
          {canCancel(order.status) && (
            <Button
              variant="ghost"
              className="text-red-600 hover:bg-red-50 sm:ml-auto"
              loading={busy === "cancelado"}
              disabled={!!busy}
              onClick={() => void changeStatus("cancelado")}
            >
              Cancelar pedido
            </Button>
          )}
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px] lg:items-start">
        <div className="space-y-6">
          <Card className="overflow-hidden">
            <h2 className="px-6 pt-5 text-base font-semibold text-petroleo">Itens</h2>
            <ul className="mt-3 divide-y divide-grafite/5">
              {order.order_items.map((it) => (
                <li key={it.id} className="flex items-start justify-between gap-4 px-6 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-grafite">
                      {it.quantity > 1 && <span className="text-grafite-500">{it.quantity}× </span>}
                      {it.service_name}
                    </p>
                    {it.description && <p className="text-xs text-grafite-500">{it.description}</p>}
                  </div>
                  <span className="shrink-0 text-sm text-grafite">{formatBRL(it.quantity * it.unit_price)}</span>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between border-t border-grafite/10 bg-nevoa/50 px-6 py-4">
              <span className="text-sm font-medium text-grafite-500">Total</span>
              <span className="text-xl font-semibold tracking-tight text-petroleo">{formatBRL(order.total)}</span>
            </div>
          </Card>

          <Card className="space-y-4 p-6">
            <h2 className="text-base font-semibold text-petroleo">Entrega e observações</h2>
            <div className="grid gap-4 sm:grid-cols-[200px_1fr] sm:items-end">
              <Field label="Data de entrega" htmlFor="dueDate">
                <Input id="dueDate" type="date" value={dueDate} disabled={!isOpen} onChange={(e) => setDueDate(e.target.value)} />
              </Field>
              {isOpen && dueDate && dueDate !== order.due_date && (
                <Button
                  variant="outline"
                  className="sm:w-fit"
                  loading={busy === "due"}
                  onClick={() => void update({ due_date: dueDate }, "due", "Data de entrega atualizada.")}
                >
                  Salvar data
                </Button>
              )}
            </div>
            <Field label="Observações" htmlFor="notes">
              <Textarea id="notes" value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            {notes.trim() !== (order.notes ?? "") && (
              <Button
                variant="outline"
                loading={busy === "notes"}
                onClick={() => void update({ notes: notes.trim() || null }, "notes", "Observações salvas.")}
              >
                Salvar observações
              </Button>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-6">
            <h2 className="text-base font-semibold text-petroleo">Cliente</h2>
            <p className="mt-3 font-medium text-grafite">{customer?.name}</p>
            <p className="text-sm text-grafite-500">{customer?.whatsapp ? maskPhone(customer.whatsapp) : "Sem WhatsApp cadastrado"}</p>
            {customer?.whatsapp && (
              <a
                href={whatsappLink(customer.whatsapp, waText)}
                target="_blank"
                rel="noreferrer"
                className={cn(buttonClass("dark", true), "mt-4")}
              >
                <MessageCircle className="h-4 w-4" aria-hidden /> Avisar no WhatsApp
              </a>
            )}
            <div className="mt-5 border-t border-grafite/10 pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-grafite-500">Entrega</p>
              <div className="mt-2 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Tipo de entrega">
                {(
                  [
                    { v: "retirada", label: "Cliente retira", icon: Store },
                    { v: "entrega", label: "Entregar", icon: Truck },
                  ] as Array<{ v: DeliveryType; label: string; icon: typeof Store }>
                ).map(({ v, label, icon: Icon }) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={order.delivery_type === v}
                    disabled={!isOpen || busy === "delivery"}
                    onClick={() =>
                      order.delivery_type !== v &&
                      void update({ delivery_type: v }, "delivery", v === "entrega" ? "Pedido marcado para entrega." : "Pedido marcado para retirada.")
                    }
                    className={cn(
                      "flex items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-xs font-medium transition disabled:cursor-not-allowed",
                      order.delivery_type === v ? "border-agua bg-agua-50 text-petroleo" : "border-grafite/15 text-grafite hover:bg-nevoa",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
                  </button>
                ))}
              </div>
              {customer && hasAddress(customer) ? (
                <div className="mt-3">
                  <p className="flex items-start gap-1.5 text-sm text-grafite">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-agua-600" aria-hidden /> {formatAddress(customer)}
                  </p>
                  <a
                    href={mapsLink(customer)}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-petroleo hover:underline"
                  >
                    <Navigation className="h-4 w-4" aria-hidden /> Abrir no Maps
                  </a>
                </div>
              ) : (
                order.delivery_type === "entrega" && (
                  <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
                    Cliente sem endereço. Cadastre em{" "}
                    <Link to="/app/clientes" className="font-semibold underline">
                      Clientes
                    </Link>
                    .
                  </p>
                )
              )}
            </div>
            <Link to={`/app/pedidos/novo?cliente=${order.customer_id}`} className="mt-3 block text-center text-sm font-medium text-petroleo hover:underline">
              Novo pedido para este cliente
            </Link>
          </Card>

          <Card className="p-6">
            <h2 className="text-base font-semibold text-petroleo">Pagamento</h2>
            <label className="mt-3 flex cursor-pointer items-center justify-between gap-3">
              <span className="text-sm text-grafite">{order.paid ? "Pago" : "A receber"}</span>
              <input
                type="checkbox"
                role="switch"
                className="peer sr-only"
                checked={order.paid}
                disabled={busy === "paid" || order.status === "cancelado"}
                onChange={(e) =>
                  void update({ paid: e.target.checked }, "paid", e.target.checked ? "Pagamento registrado." : "Pagamento desmarcado.")
                }
              />
              <span
                aria-hidden
                className={cn(
                  "relative h-6 w-11 rounded-full transition peer-focus-visible:ring-4 peer-focus-visible:ring-agua/30",
                  order.paid ? "bg-agua" : "bg-grafite/20",
                )}
              >
                <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition", order.paid ? "left-[22px]" : "left-0.5")} />
              </span>
            </label>
          </Card>

          <Card className="p-6">
            <h2 className="text-base font-semibold text-petroleo">Andamento</h2>
            <ol className="mt-4 space-y-3">
              {timeline.map((t) => (
                <li key={t.label} className="flex items-start gap-3 text-sm">
                  {t.at ? (
                    <CheckCircle2 className={cn("mt-0.5 h-5 w-5 shrink-0", t.label === "Cancelado" ? "text-red-500" : "text-agua-600")} aria-hidden />
                  ) : (
                    <Circle className="mt-0.5 h-5 w-5 shrink-0 text-grafite-300" aria-hidden />
                  )}
                  <div>
                    <p className={t.at ? "font-medium text-grafite" : "text-grafite-500"}>{t.label}</p>
                    {t.at && <p className="text-xs text-grafite-500">{formatDateTime(t.at)}</p>}
                  </div>
                </li>
              ))}
              {order.status === "em_lavagem" && (
                <li className="text-xs text-grafite-500">Em lavagem agora · entrega prevista {formatDay(order.due_date)}</li>
              )}
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}
