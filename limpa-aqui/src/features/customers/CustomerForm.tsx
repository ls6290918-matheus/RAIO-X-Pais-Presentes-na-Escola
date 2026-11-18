import { useState, type FormEvent } from "react";
import { z } from "zod";
import { Alert, Button, Field, Input, Textarea } from "@/components/shared/ui";
import { useBusiness } from "@/contexts/BusinessContext";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { maskPhone, onlyDigits } from "@/lib/format";
import type { Customer } from "@/lib/types";
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

export const CUSTOMER_COLUMNS = "id, business_id, name, whatsapp, email, notes, created_at";

/** Formulário de cliente (novo ou edição). Usado na tela de clientes e no novo pedido. */
export function CustomerForm({
  customer,
  initialName = "",
  onSaved,
  onCancel,
}: {
  customer?: Customer | null;
  initialName?: string;
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
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!business) return;
    const parsed = schema.safeParse(form);
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    setError(null);
    setSaving(true);
    const d = parsed.data;
    const values = { name: d.name, whatsapp: d.whatsapp || null, email: d.email || null, notes: d.notes || null };

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
