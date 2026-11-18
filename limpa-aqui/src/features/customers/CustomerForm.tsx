import { useState, type FormEvent } from "react";
import { ChevronDown, MapPin } from "lucide-react";
import { z } from "zod";
import { Alert, Button, Field, Input, Textarea } from "@/components/shared/ui";
import { useBusiness } from "@/contexts/BusinessContext";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { maskPhone, onlyDigits } from "@/lib/format";
import type { Customer } from "@/lib/types";
import { ADDRESS_COLUMNS, formatAddress } from "@/lib/maps";
import { AddressFields, fromAddressForm, toAddressForm, validateAddress } from "@/components/shared/AddressFields";
import { fieldErrors } from "@/features/auth/schemas";

const schema = z.object({
  name: z.string().trim().min(2, "Informe o nome do cliente.").max(120, "Nome muito longo."),
  whatsapp: z
    .string()
    .transform(onlyDigits)
    .refine((d) => d.length === 0 || d.length === 10 || d.length === 11, "Informe o WhatsApp com DDD."),
  email: z
    .string()
    .trim()
    .max(160, "E-mail muito longo.")
    .refine((v) => v === "" || z.string().email().safeParse(v).success, "E-mail inválido."),
  notes: z.string().trim().max(1000, "Máximo de 1000 caracteres."),
});

export const CUSTOMER_COLUMNS = `id, business_id, name, whatsapp, email, notes, created_at, ${ADDRESS_COLUMNS}`;

/** Formulário de cliente (novo ou edição). Usado na tela de clientes e no novo pedido. */
export function CustomerForm({
  customer,
  initialName = "",
  openAddress = false,
  onSaved,
  onCancel,
}: {
  customer?: Customer | null;
  initialName?: string;
  /** Abre a seção de endereço já expandida (ex.: pedido com entrega). */
  openAddress?: boolean;
  onSaved: (c: Customer) => void;
  onCancel: () => void;
}) {
  const { business } = useBusiness();
  const [form, setForm] = useState({
    name: customer?.name ?? initialName,
    whatsapp: maskPhone(customer?.whatsapp ?? ""),
    email: customer?.email ?? "",
    notes: customer?.notes ?? "",
  });
  const [address, setAddress] = useState(() => toAddressForm(customer));
  const [showAddress, setShowAddress] = useState(openAddress || Boolean(customer?.street));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!business) return;
    const parsed = schema.safeParse(form);
    const addrErrors = validateAddress(address);
    if (!parsed.success || Object.keys(addrErrors).length) {
      if (Object.keys(addrErrors).length) setShowAddress(true);
      return setErrors({ ...(parsed.success ? {} : fieldErrors(parsed.error)), ...addrErrors });
    }
    setErrors({});
    setError(null);
    setSaving(true);
    const d = parsed.data;
    const values = {
      name: d.name,
      whatsapp: d.whatsapp || null,
      email: d.email || null,
      notes: d.notes || null,
      ...fromAddressForm(address),
    };

    const { data, error: err } = customer
      ? await supabase.from("customers").update(values).eq("id", customer.id).select(CUSTOMER_COLUMNS).single()
      : await supabase
          .from("customers")
          .insert({ ...values, business_id: business.id })
          .select(CUSTOMER_COLUMNS)
          .single();

    setSaving(false);
    if (err) return setError(friendlyError(err));
    onSaved(data as Customer);
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {error && <Alert>{error}</Alert>}
      <Field label="Nome" htmlFor="c-name" error={errors.name}>
        <Input
          id="c-name"
          autoFocus
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          invalid={!!errors.name}
        />
      </Field>
      <Field label="WhatsApp" htmlFor="c-whatsapp" error={errors.whatsapp} hint="Usado para avisar o cliente sobre o pedido.">
        <Input
          id="c-whatsapp"
          inputMode="tel"
          placeholder="(11) 98888-7777"
          value={form.whatsapp}
          onChange={(e) => setForm((f) => ({ ...f, whatsapp: maskPhone(e.target.value) }))}
          invalid={!!errors.whatsapp}
        />
      </Field>
      <Field label="E-mail (opcional)" htmlFor="c-email" error={errors.email}>
        <Input
          id="c-email"
          type="email"
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          invalid={!!errors.email}
        />
      </Field>
      <div className="rounded-xl border border-grafite/10">
        <button
          type="button"
          onClick={() => setShowAddress((v) => !v)}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
          aria-expanded={showAddress}
        >
          <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-grafite">
            <MapPin className="h-4 w-4 shrink-0 text-agua-600" aria-hidden />
            <span className="truncate">
              Endereço para coleta e entrega
              {!showAddress && address.street && (
                <span className="ml-1 font-normal text-grafite-500">· {formatAddress(fromAddressForm(address))}</span>
              )}
            </span>
          </span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-grafite-500 transition ${showAddress ? "rotate-180" : ""}`} aria-hidden />
        </button>
        {showAddress && (
          <div className="border-t border-grafite/10 p-4">
            <AddressFields value={address} onChange={setAddress} errors={errors} idPrefix="c-addr" />
          </div>
        )}
      </div>
      <Field label="Observações (opcional)" htmlFor="c-notes" error={errors.notes}>
        <Textarea
          id="c-notes"
          placeholder="Ex.: prefere retirada à tarde"
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          invalid={!!errors.notes}
        />
      </Field>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" loading={saving}>
          {customer ? "Salvar" : "Cadastrar cliente"}
        </Button>
      </div>
    </form>
  );
}
