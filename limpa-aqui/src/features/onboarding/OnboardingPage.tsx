import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { Check, Loader2, Store, X } from "lucide-react";
import { Alert, Button, Card, Field, Input, Logo } from "@/components/shared/ui";
import { AddressFields, fromAddressForm, toAddressForm, validateAddress } from "@/components/shared/AddressFields";
import { useAuth } from "@/contexts/AuthContext";
import { useBusiness } from "@/contexts/BusinessContext";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { PUBLIC_DOMAIN, maskPhone, onlyDigits, slugify } from "@/lib/format";
import { fieldErrors } from "@/features/auth/schemas";

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/;

const schema = z.object({
  name: z.string().trim().min(2, "Informe o nome da lavanderia.").max(80, "Nome muito longo."),
  slug: z
    .string()
    .regex(SLUG_RE, "Use de 3 a 40 letras minúsculas, números e hífens.")
    .refine((s) => !s.includes("--"), "Não use dois hífens seguidos."),
  whatsapp: z
    .string()
    .transform(onlyDigits)
    .refine((d) => d.length === 10 || d.length === 11, "Informe o WhatsApp com DDD."),
});

type SlugStatus = "idle" | "checking" | "ok" | "invalid" | "reserved" | "taken" | "error";

const slugMessages: Record<Exclude<SlugStatus, "idle" | "checking" | "ok">, string> = {
  invalid: "Use de 3 a 40 letras minúsculas, números e hífens.",
  reserved: "Este endereço é reservado pelo sistema.",
  taken: "Este endereço já está em uso.",
  error: "Não foi possível verificar agora.",
};

export default function OnboardingPage() {
  const { user, signOut } = useAuth();
  const { refresh } = useBusiness();
  const navigate = useNavigate();

  const [form, setForm] = useState({ name: "", slug: "", whatsapp: "" });
  const [address, setAddress] = useState(() => toAddressForm(null));
  const [slugTouched, setSlugTouched] = useState(false);
  const [slugStatus, setSlugStatus] = useState<SlugStatus>("idle");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Gera o endereço a partir do nome até o usuário editá-lo manualmente
  useEffect(() => {
    if (!slugTouched) setForm((f) => ({ ...f, slug: slugify(f.name) }));
  }, [form.name, slugTouched]);

  // Verifica disponibilidade no servidor (com atraso para não consultar a cada tecla)
  useEffect(() => {
    const slug = form.slug;
    if (!slug) return setSlugStatus("idle");
    if (!SLUG_RE.test(slug) || slug.includes("--")) return setSlugStatus("invalid");
    setSlugStatus("checking");
    let cancelled = false;
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc("check_slug_available", { p_slug: slug });
      if (cancelled) return;
      setSlugStatus(error ? "error" : ((data as SlugStatus) ?? "error"));
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [form.slug]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const parsed = schema.safeParse(form);
    const addrErrors = validateAddress(address, { requireCity: true });
    if (!parsed.success || Object.keys(addrErrors).length) {
      return setErrors({ ...(parsed.success ? {} : fieldErrors(parsed.error)), ...addrErrors });
    }
    if (slugStatus !== "ok") {
      return setErrors({ slug: slugStatus === "checking" ? "Aguarde a verificação do endereço." : slugMessages[slugStatus as keyof typeof slugMessages] ?? "Endereço indisponível." });
    }
    setErrors({});
    setSaving(true);
    const a = fromAddressForm(address);
    const { data: businessId, error } = await supabase.rpc("create_business", {
      p_name: parsed.data.name,
      p_slug: parsed.data.slug,
      p_whatsapp: parsed.data.whatsapp,
      p_city: a.city,
      p_state: a.state,
      p_neighborhood: a.neighborhood,
    });
    if (error) {
      setSaving(false);
      return setFormError(friendlyError(error));
    }
    // Rua, número, CEP e localização no mapa (o dono acabou de ser criado, então pode editar)
    if (a.street || a.lat != null || a.postal_code) {
      await supabase
        .from("businesses")
        .update({
          street: a.street,
          street_number: a.street_number,
          complement: a.complement,
          postal_code: a.postal_code,
          lat: a.lat,
          lng: a.lng,
          place_id: a.place_id,
        })
        .eq("id", businessId as string);
    }
    await refresh();
    setSaving(false);
    navigate("/app", { replace: true });
  }

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const slugIcon =
    slugStatus === "checking" ? (
      <Loader2 className="h-4 w-4 animate-spin text-grafite-500" aria-hidden />
    ) : slugStatus === "ok" ? (
      <Check className="h-4 w-4 text-emerald-600" aria-hidden />
    ) : slugStatus !== "idle" ? (
      <X className="h-4 w-4 text-red-600" aria-hidden />
    ) : null;

  const slugHint =
    slugStatus === "ok" ? (
      <span className="font-medium text-emerald-700">Endereço disponível</span>
    ) : slugStatus in slugMessages ? (
      <span className="font-medium text-red-600">{slugMessages[slugStatus as keyof typeof slugMessages]}</span>
    ) : (
      "É o link da página pública da sua lavanderia."
    );

  return (
    <div className="min-h-screen bg-nevoa px-4 py-8 sm:py-12">
      <div className="mx-auto max-w-xl">
        <div className="mb-8 flex items-center justify-between">
          <Logo />
          <button onClick={() => void signOut()} className="text-sm text-grafite-500 hover:text-petroleo">
            Sair
          </button>
        </div>

        <Card className="p-6 sm:p-8">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-agua-50 text-petroleo">
              <Store className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-petroleo">Cadastre sua lavanderia</h1>
              <p className="text-sm text-grafite-500">
                Olá{user?.user_metadata?.full_name ? `, ${String(user.user_metadata.full_name).split(" ")[0]}` : ""}! Leva
                menos de um minuto.
              </p>
            </div>
          </div>

          <form onSubmit={onSubmit} className="mt-7 space-y-5" noValidate>
            {formError && <Alert>{formError}</Alert>}

            <Field label="Nome da lavanderia" htmlFor="name" error={errors.name}>
              <Input id="name" placeholder="Ex.: Lavanderia do João" value={form.name} onChange={set("name")} invalid={!!errors.name} />
            </Field>

            <Field label="Endereço público" htmlFor="slug" error={errors.slug} hint={slugHint}>
              <div
                className={`flex h-11 items-center overflow-hidden rounded-xl border bg-white focus-within:ring-4 ${
                  errors.slug ? "border-red-400 focus-within:ring-red-100" : "border-grafite/15 focus-within:border-agua focus-within:ring-agua/20"
                }`}
              >
                <span className="hidden h-full items-center border-r border-grafite/10 bg-nevoa px-3 text-sm text-grafite-500 sm:flex">
                  {PUBLIC_DOMAIN}/
                </span>
                <input
                  id="slug"
                  className="h-full min-w-0 flex-1 bg-transparent px-3 text-sm text-grafite focus:outline-none"
                  value={form.slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setForm((f) => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40) }));
                  }}
                  aria-invalid={!!errors.slug || undefined}
                />
                <span className="pr-3">{slugIcon}</span>
              </div>
            </Field>

            <Field label="WhatsApp" htmlFor="whatsapp" error={errors.whatsapp}>
              <Input
                id="whatsapp"
                inputMode="tel"
                placeholder="(11) 98888-7777"
                value={form.whatsapp}
                onChange={(e) => setForm((f) => ({ ...f, whatsapp: maskPhone(e.target.value) }))}
                invalid={!!errors.whatsapp}
              />
            </Field>

            <fieldset className="space-y-3">
              <legend className="text-sm font-medium text-grafite">Endereço da lavanderia</legend>
              <p className="text-xs text-grafite-500">Cidade e estado são obrigatórios. O resto ajuda na rota de entregas e no mapa da sua página.</p>
              <AddressFields value={address} onChange={setAddress} errors={errors} />
            </fieldset>

            <Button type="submit" block loading={saving}>
              Criar minha lavanderia
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
