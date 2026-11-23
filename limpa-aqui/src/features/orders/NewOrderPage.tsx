import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, FileText, MapPin, PackageOpen, Search, Sparkles, Store, Truck, UserPlus, X } from "lucide-react";
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Field,
  InlineLoader,
  Input,
  Modal,
  PageHeader,
  Textarea,
  buttonClass,
  cn,
} from "@/components/shared/ui";
import { useBusiness } from "@/contexts/BusinessContext";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { isNetworkError, useIdempotentRequest } from "@/lib/idempotency";
import { addDaysISO, formatBRL, maskPhone, searchTerm, todayISO } from "@/lib/format";
import type { Customer, DeliveryType, Service } from "@/lib/types";
import { formatAddress, hasAddress } from "@/lib/maps";
import { CUSTOMER_COLUMNS, CustomerForm } from "@/features/customers/CustomerForm";
import { SERVICE_COLUMNS } from "@/features/services/ServicesPage";

import { ItemsEditor } from "./ItemsEditor";
import { type ItemDraft, emptyItem, itemsPayload, itemsTotal, validateItems } from "./itemFields";

/* ------------------------------------------------------------ Escolha do cliente */
function CustomerPicker({
  value,
  onChange,
  wantsAddress,
}: {
  value: Customer | null;
  onChange: (c: Customer | null) => void;
  wantsAddress?: boolean;
}) {
  const { business } = useBusiness();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Customer[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!business || value) return;
    const t = setTimeout(async () => {
      const q = searchTerm(query);
      let req = supabase.from("customers").select(CUSTOMER_COLUMNS).eq("business_id", business.id).order("name").limit(8);
      if (q) {
        const digits = q.replace(/\D/g, "");
        req = digits.length >= 4 ? req.or(`name.ilike.%${q}%,whatsapp.ilike.%${digits}%`) : req.ilike("name", `%${q}%`);
      }
      const { data } = await req;
      setResults((data as Customer[]) ?? []);
    }, 200);
    return () => clearTimeout(t);
  }, [business, query, value]);

  if (value) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-agua bg-agua-50/50 px-4 py-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-sm font-semibold text-petroleo">
          {value.name.trim()[0]?.toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-petroleo">{value.name}</p>
          <p className="truncate text-xs text-grafite-500">{value.whatsapp ? maskPhone(value.whatsapp) : "Sem WhatsApp"}</p>
          {value.street && <p className="truncate text-xs text-grafite-500">{formatAddress(value)}</p>}
        </div>
        <button type="button" onClick={() => onChange(null)} className="rounded-lg p-2 text-grafite-500 hover:bg-white" aria-label="Trocar cliente">
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-grafite-300" aria-hidden />
        <Input
          id="customer"
          placeholder="Buscar por nome ou WhatsApp"
          className="pl-10"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
        />
      </div>
      <ul className="max-h-64 overflow-y-auto rounded-xl border border-grafite/10">
        {results.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onChange(c)}
              className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm hover:bg-nevoa"
            >
              <span className="truncate font-medium text-grafite">{c.name}</span>
              <span className="shrink-0 text-xs text-grafite-500">{c.whatsapp ? maskPhone(c.whatsapp) : ""}</span>
            </button>
          </li>
        ))}
        <li>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-semibold text-petroleo hover:bg-nevoa"
          >
            <UserPlus className="h-4 w-4" aria-hidden />
            {query.trim() ? `Cadastrar "${query.trim()}"` : "Cadastrar novo cliente"}
          </button>
        </li>
      </ul>
      <Modal open={creating} title="Novo cliente" onClose={() => setCreating(false)}>
        <CustomerForm
          initialName={/\d/.test(query) ? "" : query.trim()}
          openAddress={wantsAddress}
          onCancel={() => setCreating(false)}
          onSaved={(c) => {
            setCreating(false);
            onChange(c);
          }}
        />
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------ Página */
export default function NewOrderPage() {
  const { business, settings, role, hasFeature } = useBusiness();
  const canQuote = hasFeature("orcamento");
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const today = todayISO(settings?.timezone);

  const [services, setServices] = useState<Service[] | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [items, setItems] = useState<ItemDraft[]>(() => [emptyItem()]);
  const [dueDate, setDueDate] = useState("");
  const [dueTouched, setDueTouched] = useState(false);
  const [notes, setNotes] = useState("");
  const [deliveryType, setDeliveryType] = useState<DeliveryType>("retirada");
  const [editingCustomer, setEditingCustomer] = useState(false);
  const [asQuote, setAsQuote] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!business) return;
    void supabase
      .from("services")
      .select(SERVICE_COLUMNS)
      .eq("business_id", business.id)
      .eq("active", true)
      .order("name")
      .then(({ data, error: err }) => {
        if (err) setError(friendlyError(err));
        setServices((data as Service[]) ?? []);
      });

    const clienteId = params.get("cliente");
    if (clienteId) {
      void supabase
        .from("customers")
        .select(CUSTOMER_COLUMNS)
        .eq("id", clienteId)
        .maybeSingle()
        .then(({ data }) => data && setCustomer(data as Customer));
    }
  }, [business, params]);

  const serviceById = useMemo(() => new Map((services ?? []).map((s) => [s.id, s])), [services]);

  // Prazo sugerido: o maior prazo entre os serviços escolhidos (ou o padrão da lavanderia)
  const suggestedDue = useMemo(() => {
    const fallback = settings?.default_due_days ?? 3;
    const days = items.reduce((max, it) => {
      const s = serviceById.get(it.serviceId);
      return s ? Math.max(max, s.due_days ?? fallback) : max;
    }, 0);
    return addDaysISO(today, days || fallback);
  }, [items, serviceById, settings, today]);

  useEffect(() => {
    if (!dueTouched) setDueDate(suggestedDue);
  }, [suggestedDue, dueTouched]);

  const total = itemsTotal(items);

  // mesmo pedido (mesmo conteúdo) = mesma chave; clique duplo ou nova tentativa não duplicam
  const payload = {
    p_customer_id: customer?.id ?? null,
    p_items: itemsPayload(items),
    p_due_date: dueDate,
    p_notes: notes.trim() || null,
    p_delivery_type: deliveryType,
    p_as_quote: canQuote && asQuote,
  };
  const request = useIdempotentRequest(payload);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!customer) errs.customer = "Escolha ou cadastre o cliente.";
    Object.assign(errs, validateItems(items, serviceById));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) errs.dueDate = "Informe a data de entrega.";
    else if (dueDate < today) errs.dueDate = "A entrega não pode ser antes de hoje.";
    if (notes.length > 1000) errs.notes = "Máximo de 1000 caracteres.";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    if (!request.begin()) return; // segundo clique enquanto o primeiro ainda está sendo enviado
    setError(null);
    setSaving(true);
    const { data, error: err } = await supabase.rpc("create_order", { ...payload, p_request_id: request.key() });
    setSaving(false);
    if (err) {
      request.end();
      return setError(
        isNetworkError(err)
          ? "A conexão falhou antes da confirmação. Envie de novo: o pedido não será duplicado."
          : friendlyError(err),
      );
    }
    request.done();
    navigate(`/app/pedidos/${data as string}`, { replace: true, state: { created: true } });
  }

  if (services === null) return <InlineLoader />;

  if (services.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Novo pedido" />
        <Card>
          <EmptyState
            icon={<Sparkles className="h-6 w-6" />}
            title="Cadastre seus serviços primeiro"
            description={
              role === "owner"
                ? "O pedido é montado a partir dos serviços e preços da sua lavanderia."
                : "O pedido é montado a partir dos serviços. Peça ao dono da lavanderia para cadastrá-los."
            }
            action={
              role === "owner" && (
                <Link to="/app/servicos" className={buttonClass()}>
                  Cadastrar serviços
                </Link>
              )
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      <div>
        <Link to="/app/pedidos" className="inline-flex items-center gap-1.5 text-sm font-medium text-grafite-500 hover:text-petroleo">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Pedidos
        </Link>
        <div className="mt-2">
          <PageHeader
            title={asQuote ? "Novo orçamento" : "Novo pedido"}
            description={asQuote ? "Monte o orçamento; ele vira pedido quando o cliente aprovar." : "Registre os itens que o cliente deixou."}
          />
        </div>
      </div>

      {canQuote && (
        <div className="grid max-w-md grid-cols-2 gap-2" role="radiogroup" aria-label="Tipo">
          {(
            [
              { v: false, label: "Pedido", icon: PackageOpen },
              { v: true, label: "Orçamento", icon: FileText },
            ] as const
          ).map(({ v, label, icon: Icon }) => (
            <button
              key={label}
              type="button"
              role="radio"
              aria-checked={asQuote === v}
              onClick={() => setAsQuote(v)}
              className={cn(
                "flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition",
                asQuote === v ? "border-agua bg-agua-50 text-petroleo" : "border-grafite/15 bg-white text-grafite hover:bg-nevoa",
              )}
            >
              <Icon className="h-4 w-4" aria-hidden /> {label}
            </button>
          ))}
        </div>
      )}

      {error && <Alert>{error}</Alert>}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px] lg:items-start">
        <div className="space-y-6">
          <Card className="p-6">
            <h2 className="mb-4 text-base font-semibold text-petroleo">Cliente</h2>
            <CustomerPicker value={customer} onChange={setCustomer} wantsAddress={deliveryType === "entrega"} />
            {errors.customer && (
              <p className="mt-2 text-xs font-medium text-red-600" role="alert">
                {errors.customer}
              </p>
            )}
          </Card>

          <Card className="p-6">
            <h2 className="mb-4 text-base font-semibold text-petroleo">Itens</h2>
            <ItemsEditor items={items} setItems={setItems} services={services} errors={errors} />
          </Card>
        </div>

        <Card className="space-y-5 p-6 lg:sticky lg:top-24">
          <div>
            <p className="mb-1.5 text-sm font-medium text-grafite">Entrega</p>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Tipo de entrega">
              {(
                [
                  { v: "retirada", label: "Cliente retira", icon: Store },
                  { v: "entrega", label: "Entregar", icon: Truck },
                ] as const
              ).map(({ v, label, icon: Icon }) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={deliveryType === v}
                  onClick={() => setDeliveryType(v)}
                  className={cn(
                    "flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition",
                    deliveryType === v ? "border-agua bg-agua-50 text-petroleo" : "border-grafite/15 text-grafite hover:bg-nevoa",
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden /> {label}
                </button>
              ))}
            </div>
            {deliveryType === "entrega" && customer && !hasAddress(customer) && (
              <div className="mt-2 rounded-xl bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
                {customer.name.split(" ")[0]} não tem endereço cadastrado.{" "}
                <button type="button" className="font-semibold underline" onClick={() => setEditingCustomer(true)}>
                  Adicionar endereço
                </button>
              </div>
            )}
            {deliveryType === "entrega" && customer && hasAddress(customer) && (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-grafite-500">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {formatAddress(customer)}
              </p>
            )}
          </div>
          <Field
            label="Data de entrega"
            htmlFor="dueDate"
            error={errors.dueDate}
            hint={dueTouched ? undefined : "Sugerida pelo prazo dos serviços."}
          >
            <Input
              id="dueDate"
              type="date"
              min={today}
              value={dueDate}
              onChange={(e) => {
                setDueTouched(true);
                setDueDate(e.target.value);
              }}
              invalid={!!errors.dueDate}
            />
          </Field>
          <Field label="Observações (opcional)" htmlFor="notes" error={errors.notes}>
            <Textarea
              id="notes"
              placeholder="Ex.: mancha na lateral, cliente pediu cuidado com o cadarço"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              invalid={!!errors.notes}
            />
          </Field>
          <div className="flex items-baseline justify-between border-t border-grafite/10 pt-4">
            <span className="text-sm font-medium text-grafite-500">Total</span>
            <span className={cn("text-2xl font-semibold tracking-tight text-petroleo")}>{formatBRL(total)}</span>
          </div>
          <Button type="submit" block loading={saving}>
            {asQuote ? "Criar orçamento" : "Criar pedido"}
          </Button>
        </Card>
      </div>

      <Modal open={editingCustomer} title="Endereço do cliente" onClose={() => setEditingCustomer(false)}>
        {customer && (
          <CustomerForm
            customer={customer}
            openAddress
            onCancel={() => setEditingCustomer(false)}
            onSaved={(c) => {
              setCustomer(c);
              setEditingCustomer(false);
            }}
          />
        )}
      </Modal>
    </form>
  );
}
