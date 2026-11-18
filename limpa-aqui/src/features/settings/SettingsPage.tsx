import { useEffect, useState, type FormEvent } from "react";
import { z } from "zod";
import { Alert, Button, Card, Field, Input, Select } from "@/components/shared/ui";
import { useBusiness } from "@/contexts/BusinessContext";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { PUBLIC_DOMAIN, UFS, maskPhone, onlyDigits } from "@/lib/format";
import { fieldErrors } from "@/features/auth/schemas";

const schema = z.object({
  name: z.string().trim().min(2, "Informe o nome da lavanderia.").max(80, "Nome muito longo."),
  whatsapp: z
    .string()
    .transform(onlyDigits)
    .refine((d) => d.length === 10 || d.length === 11, "Informe o WhatsApp com DDD."),
  phone: z
    .string()
    .transform(onlyDigits)
    .refine((d) => d.length === 0 || d.length === 10 || d.length === 11, "Telefone inválido."),
  city: z.string().trim().min(2, "Informe a cidade.").max(80),
  state: z.enum(UFS, { errorMap: () => ({ message: "Selecione o estado." }) }),
  neighborhood: z.string().trim().max(80),
  defaultDueDays: z.coerce
    .number({ invalid_type_error: "Informe um número." })
    .int("Use um número inteiro.")
    .min(1, "Mínimo de 1 dia.")
    .max(60, "Máximo de 60 dias."),
});

export default function SettingsPage() {
  const { business, settings, role, refresh } = useBusiness();
  const isOwner = role === "owner";
  const [form, setForm] = useState({
    name: "",
    whatsapp: "",
    phone: "",
    city: "",
    state: "",
    neighborhood: "",
    defaultDueDays: "3",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!business) return;
    setForm({
      name: business.name,
      whatsapp: maskPhone(business.whatsapp ?? ""),
      phone: maskPhone(business.phone ?? ""),
      city: business.city ?? "",
      state: business.state ?? "",
      neighborhood: business.neighborhood ?? "",
      defaultDueDays: String(settings?.default_due_days ?? 3),
    });
  }, [business, settings]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!business) return;
    setMessage(null);
    const parsed = schema.safeParse(form);
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    setSaving(true);
    const d = parsed.data;

    const { error: bErr } = await supabase
      .from("businesses")
      .update({
        name: d.name,
        whatsapp: d.whatsapp,
        phone: d.phone || null,
        city: d.city,
        state: d.state,
        neighborhood: d.neighborhood || null,
      })
      .eq("id", business.id);

    const { error: sErr } = bErr
      ? { error: null }
      : await supabase.from("business_settings").update({ default_due_days: d.defaultDueDays }).eq("business_id", business.id);

    setSaving(false);
    const err = bErr ?? sErr;
    if (err) return setMessage({ kind: "error", text: friendlyError(err) });
    await refresh();
    setMessage({ kind: "success", text: "Alterações salvas." });
  }

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-petroleo">Configurações</h1>
        <p className="mt-1 text-sm text-grafite-500">Dados da sua lavanderia e preferências de atendimento.</p>
      </div>

      <form onSubmit={onSubmit} noValidate>
        <Card className="space-y-6 p-6">
          {message && <Alert kind={message.kind}>{message.text}</Alert>}
          {!isOwner && <Alert>Somente o dono da lavanderia pode alterar estas informações.</Alert>}

          <fieldset disabled={!isOwner || saving} className="space-y-5">
            <legend className="text-base font-semibold text-petroleo">Dados da lavanderia</legend>
            <Field label="Nome da lavanderia" htmlFor="name" error={errors.name}>
              <Input id="name" value={form.name} onChange={set("name")} invalid={!!errors.name} />
            </Field>

            <Field label="Endereço público" htmlFor="slug" hint="O endereço não pode ser alterado nesta versão.">
              <Input id="slug" value={`${PUBLIC_DOMAIN}/${business?.slug ?? ""}`} disabled readOnly />
            </Field>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="WhatsApp" htmlFor="whatsapp" error={errors.whatsapp}>
                <Input
                  id="whatsapp"
                  inputMode="tel"
                  value={form.whatsapp}
                  onChange={(e) => setForm((f) => ({ ...f, whatsapp: maskPhone(e.target.value) }))}
                  invalid={!!errors.whatsapp}
                />
              </Field>
              <Field label="Telefone fixo (opcional)" htmlFor="phone" error={errors.phone}>
                <Input
                  id="phone"
                  inputMode="tel"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: maskPhone(e.target.value) }))}
                  invalid={!!errors.phone}
                />
              </Field>
            </div>

            <div className="grid gap-5 sm:grid-cols-[1fr_120px_1fr]">
              <Field label="Cidade" htmlFor="city" error={errors.city}>
                <Input id="city" value={form.city} onChange={set("city")} invalid={!!errors.city} />
              </Field>
              <Field label="Estado" htmlFor="state" error={errors.state}>
                <Select id="state" value={form.state} onChange={set("state")} invalid={!!errors.state}>
                  <option value="">UF</option>
                  {UFS.map((uf) => (
                    <option key={uf} value={uf}>
                      {uf}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Bairro" htmlFor="neighborhood" error={errors.neighborhood}>
                <Input id="neighborhood" value={form.neighborhood} onChange={set("neighborhood")} />
              </Field>
            </div>
          </fieldset>

          <hr className="border-grafite/10" />

          <fieldset disabled={!isOwner || saving} className="space-y-5">
            <legend className="text-base font-semibold text-petroleo">Atendimento</legend>
            <Field
              label="Prazo padrão de entrega (dias)"
              htmlFor="defaultDueDays"
              error={errors.defaultDueDays}
              hint="Usado para sugerir a data de entrega ao criar um pedido."
            >
              <Input
                id="defaultDueDays"
                type="number"
                min={1}
                max={60}
                className="max-w-[140px]"
                value={form.defaultDueDays}
                onChange={set("defaultDueDays")}
                invalid={!!errors.defaultDueDays}
              />
            </Field>
          </fieldset>

          {isOwner && (
            <div className="flex justify-end">
              <Button type="submit" loading={saving}>
                Salvar alterações
              </Button>
            </div>
          )}
        </Card>
      </form>
    </div>
  );
}
