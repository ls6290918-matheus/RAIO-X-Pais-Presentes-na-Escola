import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { Clock, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { z } from "zod";
import { Alert, Button, Card, EmptyState, Field, InlineLoader, Input, Modal, PageHeader, Textarea, cn } from "@/components/shared/ui";
import { useBusiness } from "@/contexts/BusinessContext";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { formatBRL, moneyInput, parseMoney } from "@/lib/format";
import type { Service } from "@/lib/types";
import { fieldErrors } from "@/features/auth/schemas";

export const SERVICE_COLUMNS = "id, business_id, name, description, price, due_days, active";

const schema = z.object({
  name: z.string().trim().min(2, "Informe o nome do serviço.").max(80, "Nome muito longo."),
  description: z.string().trim().max(300, "Máximo de 300 caracteres."),
  price: z
    .string()
    .transform(parseMoney)
    .refine((n) => !Number.isNaN(n), "Informe o preço. Ex.: 49,90")
    .refine((n) => n <= 99999, "Preço muito alto."),
  dueDays: z
    .string()
    .trim()
    .refine((v) => v === "" || (/^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 60), "De 1 a 60 dias, ou deixe em branco."),
  active: z.boolean(),
});

function ServiceForm({ service, onSaved, onCancel }: { service: Service | null; onSaved: () => void; onCancel: () => void }) {
  const { business, settings } = useBusiness();
  const [form, setForm] = useState({
    name: service?.name ?? "",
    description: service?.description ?? "",
    price: service ? moneyInput(service.price) : "",
    dueDays: service?.due_days ? String(service.due_days) : "",
    active: service?.active ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!business) return;
    const parsed = schema.safeParse(form);
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    setError(null);
    setSaving(true);
    const d = parsed.data;
    const values = {
      name: d.name,
      description: d.description || null,
      price: d.price,
      due_days: d.dueDays ? Number(d.dueDays) : null,
      active: d.active,
    };
    const { error: err } = service
      ? await supabase.from("services").update(values).eq("id", service.id)
      : await supabase.from("services").insert({ ...values, business_id: business.id });
    setSaving(false);
    if (err) return setError(friendlyError(err));
    onSaved();
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {error && <Alert>{error}</Alert>}
      <Field label="Nome do serviço" htmlFor="s-name" error={errors.name}>
        <Input
          id="s-name"
          autoFocus
          placeholder="Ex.: Lavagem premium"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          invalid={!!errors.name}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Preço (R$)" htmlFor="s-price" error={errors.price}>
          <Input
            id="s-price"
            inputMode="decimal"
            placeholder="49,90"
            value={form.price}
            onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
            invalid={!!errors.price}
          />
        </Field>
        <Field
          label="Prazo (dias)"
          htmlFor="s-due"
          error={errors.dueDays}
          hint={`Em branco usa o prazo padrão (${settings?.default_due_days ?? 3} dias).`}
        >
          <Input
            id="s-due"
            type="number"
            min={1}
            max={60}
            value={form.dueDays}
            onChange={(e) => setForm((f) => ({ ...f, dueDays: e.target.value }))}
            invalid={!!errors.dueDays}
          />
        </Field>
      </div>
      <Field label="Descrição (opcional)" htmlFor="s-desc" error={errors.description}>
        <Textarea
          id="s-desc"
          placeholder="O que está incluído no serviço"
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          invalid={!!errors.description}
        />
      </Field>
      <label className="flex items-center gap-2.5 text-sm text-grafite">
        <input
          type="checkbox"
          className="h-4 w-4 rounded accent-petroleo"
          checked={form.active}
          onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
        />
        Disponível para novos pedidos
      </label>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" loading={saving}>
          {service ? "Salvar" : "Cadastrar serviço"}
        </Button>
      </div>
    </form>
  );
}

export default function ServicesPage() {
  const { business, settings, role } = useBusiness();
  const isOwner = role === "owner";
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [params] = useSearchParams();
  const [editing, setEditing] = useState<Service | null | undefined>(params.get("novo") && role === "owner" ? null : undefined);

  const load = useCallback(async () => {
    if (!business) return;
    const { data, error: err } = await supabase
      .from("services")
      .select(SERVICE_COLUMNS)
      .eq("business_id", business.id)
      .order("active", { ascending: false })
      .order("name");
    if (err) setError(friendlyError(err));
    setServices((data as Service[]) ?? []);
    setLoading(false);
  }, [business]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(s: Service) {
    if (!window.confirm(`Excluir o serviço ${s.name}? Os pedidos antigos continuam mostrando o nome e o preço.`)) return;
    const { error: err } = await supabase.from("services").delete().eq("id", s.id);
    if (err) return setError(friendlyError(err));
    setServices((list) => list.filter((x) => x.id !== s.id));
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Serviços"
        description="Seu catálogo de serviços e preços."
        action={
          isOwner && (
            <Button onClick={() => setEditing(null)}>
              <Plus className="h-4 w-4" aria-hidden /> Novo serviço
            </Button>
          )
        }
      />

      {!isOwner && <Alert>Somente o dono da lavanderia pode alterar serviços e preços.</Alert>}
      {error && <Alert>{error}</Alert>}

      {loading ? (
        <InlineLoader />
      ) : services.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Sparkles className="h-6 w-6" />}
            title="Nenhum serviço cadastrado"
            description="Cadastre o que você oferece (lavagem, higienização, pintura...) com preço e prazo. Eles aparecem na hora de criar o pedido."
            action={isOwner && <Button onClick={() => setEditing(null)}>Cadastrar serviço</Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {services.map((s) => (
            <Card key={s.id} className={cn("flex flex-col p-5", !s.active && "opacity-60")}>
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-semibold text-petroleo">{s.name}</h3>
                {!s.active && <span className="shrink-0 rounded-full bg-nevoa px-2 py-0.5 text-[11px] font-semibold text-grafite-500">Desativado</span>}
              </div>
              {s.description && <p className="mt-1 line-clamp-2 text-sm text-grafite-500">{s.description}</p>}
              <div className="mt-4 flex items-end justify-between gap-3">
                <div>
                  <p className="text-xl font-semibold tracking-tight text-petroleo">{formatBRL(s.price)}</p>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-grafite-500">
                    <Clock className="h-3.5 w-3.5" aria-hidden />
                    {s.due_days ?? settings?.default_due_days ?? 3} dias{!s.due_days && " (padrão)"}
                  </p>
                </div>
                {isOwner && (
                  <div className="flex gap-1">
                    <button onClick={() => setEditing(s)} className="rounded-lg p-2 text-grafite-500 hover:bg-nevoa" aria-label={`Editar ${s.name}`}>
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button onClick={() => void remove(s)} className="rounded-lg p-2 text-grafite-500 hover:bg-red-50 hover:text-red-600" aria-label={`Excluir ${s.name}`}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={editing !== undefined} title={editing ? "Editar serviço" : "Novo serviço"} onClose={() => setEditing(undefined)}>
        <ServiceForm
          key={editing?.id ?? "novo"}
          service={editing ?? null}
          onCancel={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            void load();
          }}
        />
      </Modal>
    </div>
  );
}
