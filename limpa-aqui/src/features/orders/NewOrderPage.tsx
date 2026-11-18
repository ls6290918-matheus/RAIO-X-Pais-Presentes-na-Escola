import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, MapPin, Plus, Search, Sparkles, Store, Trash2, Truck, UserPlus, X } from "lucide-react";
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
  Select,
  Textarea,
  buttonClass,
  cn,
} from "@/components/shared/ui";
import { useBusiness } from "@/contexts/BusinessContext";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { addDaysISO, formatBRL, maskPhone, moneyInput, parseMoney, searchTerm, todayISO } from "@/lib/format";
import type { Customer, DeliveryType, Service } from "@/lib/types";
import { formatAddress, hasAddress } from "@/lib/maps";
import { CUSTOMER_COLUMNS, CustomerForm } from "@/features/customers/CustomerForm";
import { SERVICE_COLUMNS } from "@/features/services/ServicesPage";

type ItemDraft = { key: number; serviceId: string; description: string; quantity: string; price: string };

let nextKey = 1;
const emptyItem = (): ItemDraft => ({ key: nextKey++, serviceId: "", description: "", quantity: "1", price: "" });

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
  const { business, settings, role } = useBusiness();
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

  const total = items.reduce((sum, it) => {
    const p = parseMoney(it.price);
    const q = Number(it.quantity);
    return sum + (Number.isNaN(p) || !Number.isInteger(q) ? 0 : p * q);
  }, 0);

  const updateItem = (key: number, patch: Partial<ItemDraft>) =>
    setItems((list) => list.map((it) => (it.key === key ? { ...it, ...patch } : it)));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!customer) errs.customer = "Escolha ou cadastre o cliente.";
    items.forEach((it) => {
      if (!it.serviceId) errs[`service-${it.key}`] = "Escolha o serviço.";
      const q = Number(it.quantity);
      if (!Number.isInteger(q) || q < 1 || q > 50) errs[`qty-${it.key}`] = "De 1 a 50.";
      const p = parseMoney(it.price);
      if (Number.isNaN(p) || p > 99999) errs[`price-${it.key}`] = "Valor inválido.";
      if (it.description.length > 160) errs[`desc-${it.key}`] = "Máximo de 160 caracteres.";
    });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) errs.dueDate = "Informe a data de entrega.";
    else if (dueDate < today) errs.dueDate = "A entrega não pode ser antes de hoje.";
    if (notes.length > 1000) errs.notes = "Máximo de 1000 caracteres.";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setError(null);
    setSaving(true);
    const { data, error: err } = await supabase.rpc("create_order", {
      p_customer_id: customer!.id,
      p_items: items.map((it) => ({
        service_id: it.serviceId,
        description: it.description.trim() || null,
        quantity: Number(it.quantity),
        unit_price: parseMoney(it.price),
      })),
      p_due_date: dueDate,
      p_notes: notes.trim() || null,
      p_delivery_type: deliveryType,
    });
    setSaving(false);
    if (err) return setError(friendlyError(err));
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
          <PageHeader title="Novo pedido" description="Registre os calçados que o cliente deixou." />
        </div>
      </div>

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
            <ul className="space-y-4">
              {items.map((it, i) => (
                <li key={it.key} className="rounded-xl border border-grafite/10 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wide text-grafite-500">Item {i + 1}</span>
                    {items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setItems((list) => list.filter((x) => x.key !== it.key))}
                        className="rounded-lg p-1.5 text-grafite-500 hover:bg-red-50 hover:text-red-600"
                        aria-label={`Remover item ${i + 1}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Serviço" htmlFor={`service-${it.key}`} error={errors[`service-${it.key}`]}>
                      <Select
                        id={`service-${it.key}`}
                        value={it.serviceId}
                        invalid={!!errors[`service-${it.key}`]}
                        onChange={(e) => {
                          const s = serviceById.get(e.target.value);
                          updateItem(it.key, { serviceId: e.target.value, price: s ? moneyInput(s.price) : "" });
                        }}
                      >
                        <option value="">Escolha</option>
                        {services.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name} — {formatBRL(s.price)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Calçado (opcional)" htmlFor={`desc-${it.key}`} error={errors[`desc-${it.key}`]}>
                      <Input
                        id={`desc-${it.key}`}
                        placeholder="Ex.: Nike Air Force branco"
                        value={it.description}
                        onChange={(e) => updateItem(it.key, { description: e.target.value })}
                        invalid={!!errors[`desc-${it.key}`]}
                      />
                    </Field>
                    <Field label="Quantidade (pares)" htmlFor={`qty-${it.key}`} error={errors[`qty-${it.key}`]}>
                      <Input
                        id={`qty-${it.key}`}
                        type="number"
                        min={1}
                        max={50}
                        value={it.quantity}
                        onChange={(e) => updateItem(it.key, { quantity: e.target.value })}
                        invalid={!!errors[`qty-${it.key}`]}
                      />
                    </Field>
                    <Field label="Valor unitário (R$)" htmlFor={`price-${it.key}`} error={errors[`price-${it.key}`]}>
                      <Input
                        id={`price-${it.key}`}
                        inputMode="decimal"
                        value={it.price}
                        onChange={(e) => updateItem(it.key, { price: e.target.value })}
                        invalid={!!errors[`price-${it.key}`]}
                      />
                    </Field>
                  </div>
                </li>
              ))}
            </ul>
            {items.length < 30 && (
              <Button type="button" variant="outline" className="mt-4" onClick={() => setItems((list) => [...list, emptyItem()])}>
                <Plus className="h-4 w-4" aria-hidden /> Adicionar item
              </Button>
            )}
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
            Criar pedido
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
