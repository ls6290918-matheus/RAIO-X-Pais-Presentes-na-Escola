import { useEffect, useRef, useState } from "react";
import { Check, ImagePlus, Loader2, Trash2, X } from "lucide-react";
import { Field, Input, cn } from "@/components/shared/ui";
import { AddressFields, type AddressForm, fromAddressForm, toAddressForm, validateAddress } from "@/components/shared/AddressFields";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { PUBLIC_DOMAIN, maskPhone, onlyDigits, slugify } from "@/lib/format";
import { logoUrl, uploadLogo } from "@/lib/logo";
import type { Draft, OpeningHours } from "./catalog";

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type SlugStatus = "idle" | "checking" | "ok" | "invalid" | "reserved" | "taken" | "error";

const slugMessages: Partial<Record<SlugStatus, string>> = {
  invalid: "Use de 3 a 40 letras minúsculas, números e hífens.",
  reserved: "Este endereço é reservado pelo sistema.",
  taken: "Este endereço já está em uso.",
  error: "Não foi possível verificar agora.",
};

const DEFAULT_HOURS: OpeningHours = { seg_sex: "08:00-18:00", sab: "08:00-12:00", dom: "fechado" };
const HOUR_ROWS: Array<{ key: keyof OpeningHours; label: string }> = [
  { key: "seg_sex", label: "Segunda a sexta" },
  { key: "sab", label: "Sábado" },
  { key: "dom", label: "Domingo" },
];

/** Validação da etapa de identidade. Devolve { campo: mensagem }. */
export function validateIdentity(d: Draft, address: AddressForm, opts: { needsSlug: boolean; slugStatus: SlugStatus }) {
  const e: Record<string, string> = {};
  const name = (d.name ?? "").trim();
  if (name.length < 2) e.name = "Informe o nome do negócio.";
  else if (name.length > 80) e.name = "Nome muito longo.";
  if (opts.needsSlug) {
    if (!d.slug || !SLUG_RE.test(d.slug) || d.slug.includes("--")) e.slug = slugMessages.invalid!;
    else if (opts.slugStatus === "checking") e.slug = "Aguarde a verificação do endereço.";
    else if (opts.slugStatus !== "ok") e.slug = slugMessages[opts.slugStatus] ?? "Endereço indisponível.";
  }
  const wa = onlyDigits(d.whatsapp ?? "");
  if (wa.length !== 10 && wa.length !== 11) e.whatsapp = "Informe o WhatsApp com DDD.";
  const email = (d.email ?? "").trim();
  if (email && (!EMAIL_RE.test(email) || email.length > 160)) e.email = "E-mail inválido.";
  if ((d.service_region ?? "").length > 160) e.service_region = "Muito longo (máximo de 160 caracteres).";
  return { ...e, ...validateAddress(address, { requireCity: true }) };
}

function HoursRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const closed = value === "fechado";
  const [open, close] = closed ? ["08:00", "18:00"] : value.split("-");
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
      <span className="w-32 text-sm font-medium text-grafite">{label}</span>
      <label className="flex items-center gap-2 text-sm text-grafite-500">
        <input
          type="checkbox"
          className="h-4 w-4 accent-petroleo"
          checked={!closed}
          onChange={(e) => onChange(e.target.checked ? `${open}-${close}` : "fechado")}
        />
        Aberto
      </label>
      {!closed && (
        <div className="flex items-center gap-2">
          <Input type="time" aria-label={`${label}: abre`} className="h-10 w-[110px]" value={open} onChange={(e) => onChange(`${e.target.value}-${close}`)} />
          <span className="text-sm text-grafite-500">às</span>
          <Input type="time" aria-label={`${label}: fecha`} className="h-10 w-[110px]" value={close} onChange={(e) => onChange(`${open}-${e.target.value}`)} />
        </div>
      )}
    </div>
  );
}

export function IdentityStep({
  draft,
  setDraft,
  address,
  setAddress,
  needsSlug,
  slugStatus,
  setSlugStatus,
  errors,
}: {
  draft: Draft;
  setDraft: (p: Partial<Draft>) => void;
  address: AddressForm;
  setAddress: (a: AddressForm) => void;
  needsSlug: boolean;
  slugStatus: SlugStatus;
  setSlugStatus: (s: SlugStatus) => void;
  errors: Record<string, string>;
}) {
  const { user } = useAuth();
  const [slugTouched, setSlugTouched] = useState(Boolean(draft.slug));
  const [uploading, setUploading] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const hours = draft.opening_hours ?? DEFAULT_HOURS;

  // Endereço público sugerido a partir do nome, até a pessoa editar
  useEffect(() => {
    if (needsSlug && !slugTouched) {
      const s = slugify(draft.name ?? "");
      if (s !== (draft.slug ?? "")) setDraft({ slug: s });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.name, slugTouched, needsSlug]);

  // Disponibilidade do endereço público no servidor
  useEffect(() => {
    if (!needsSlug) return;
    const slug = draft.slug ?? "";
    if (!slug) return setSlugStatus("idle");
    if (!SLUG_RE.test(slug) || slug.includes("--")) return setSlugStatus("invalid");
    setSlugStatus("checking");
    let cancelled = false;
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc("check_slug_available", { p_slug: slug });
      if (!cancelled) setSlugStatus(error ? "error" : ((data as SlugStatus) ?? "error"));
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [draft.slug, needsSlug, setSlugStatus]);

  async function onLogo(file: File | undefined) {
    if (!file || !user) return;
    setLogoError(null);
    setUploading(true);
    try {
      const path = await uploadLogo(file, user.id);
      setDraft({ logo_path: path });
    } catch (e) {
      setLogoError((e as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const slugIcon =
    slugStatus === "checking" ? (
      <Loader2 className="h-4 w-4 animate-spin text-grafite-500" aria-hidden />
    ) : slugStatus === "ok" ? (
      <Check className="h-4 w-4 text-emerald-600" aria-hidden />
    ) : slugStatus !== "idle" ? (
      <X className="h-4 w-4 text-red-600" aria-hidden />
    ) : null;

  const logo = logoUrl(draft.logo_path);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-grafite/15 bg-nevoa text-grafite-500 transition hover:border-agua"
          aria-label={logo ? "Trocar logotipo" : "Enviar logotipo"}
        >
          {uploading ? (
            <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
          ) : logo ? (
            <img src={logo} alt="Logotipo" className="h-full w-full object-cover" />
          ) : (
            <ImagePlus className="h-6 w-6" aria-hidden />
          )}
        </button>
        <div className="min-w-0 text-sm">
          <p className="font-medium text-grafite">Logotipo (opcional)</p>
          <p className="text-xs text-grafite-500">PNG, JPG ou WebP. Pode enviar depois.</p>
          {logo && (
            <button type="button" onClick={() => setDraft({ logo_path: null })} className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-red-600">
              <Trash2 className="h-3.5 w-3.5" aria-hidden /> Remover
            </button>
          )}
          {logoError && <p className="mt-1 text-xs font-medium text-red-600">{logoError}</p>}
        </div>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => void onLogo(e.target.files?.[0])} />
      </div>

      <Field label="Nome do negócio" htmlFor="name" error={errors.name}>
        <Input id="name" placeholder="Ex.: Lavanderia da Ana" value={draft.name ?? ""} onChange={(e) => setDraft({ name: e.target.value })} invalid={!!errors.name} />
      </Field>

      {needsSlug && (
        <Field
          label="Endereço da sua página"
          htmlFor="slug"
          error={errors.slug}
          hint={
            slugStatus === "ok" ? (
              <span className="font-medium text-emerald-700">Endereço disponível</span>
            ) : slugMessages[slugStatus] ? (
              <span className="font-medium text-red-600">{slugMessages[slugStatus]}</span>
            ) : (
              "Vai ser o link da página do seu negócio."
            )
          }
        >
          <div
            className={cn(
              "flex h-11 items-center overflow-hidden rounded-xl border bg-white focus-within:ring-4",
              errors.slug ? "border-red-400 focus-within:ring-red-100" : "border-grafite/15 focus-within:border-agua focus-within:ring-agua/20",
            )}
          >
            <span className="hidden h-full items-center border-r border-grafite/10 bg-nevoa px-3 text-sm text-grafite-500 sm:flex">{PUBLIC_DOMAIN}/</span>
            <input
              id="slug"
              className="h-full min-w-0 flex-1 bg-transparent px-3 text-sm text-grafite focus:outline-none"
              value={draft.slug ?? ""}
              onChange={(e) => {
                setSlugTouched(true);
                setDraft({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40) });
              }}
              aria-invalid={!!errors.slug || undefined}
            />
            <span className="pr-3">{slugIcon}</span>
          </div>
        </Field>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="WhatsApp" htmlFor="whatsapp" error={errors.whatsapp}>
          <Input
            id="whatsapp"
            inputMode="tel"
            placeholder="(11) 98888-7777"
            value={draft.whatsapp ?? ""}
            onChange={(e) => setDraft({ whatsapp: maskPhone(e.target.value) })}
            invalid={!!errors.whatsapp}
          />
        </Field>
        <Field label="E-mail (opcional)" htmlFor="email" error={errors.email}>
          <Input id="email" type="email" inputMode="email" value={draft.email ?? ""} onChange={(e) => setDraft({ email: e.target.value })} invalid={!!errors.email} />
        </Field>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-grafite">Endereço</legend>
        <p className="text-xs text-grafite-500">Cidade e estado são obrigatórios. Rua e número são opcionais e ajudam nas entregas.</p>
        <AddressFields
          value={address}
          errors={errors}
          onChange={(a) => {
            setAddress(a);
            const v = fromAddressForm(a);
            setDraft({
              street: v.street ?? "",
              street_number: v.street_number ?? "",
              complement: v.complement ?? "",
              neighborhood: v.neighborhood ?? "",
              city: v.city ?? "",
              state: v.state ?? "",
              postal_code: v.postal_code ?? "",
              lat: v.lat,
              lng: v.lng,
              place_id: v.place_id,
            });
          }}
        />
      </fieldset>

      <Field label="Região atendida (opcional)" htmlFor="service_region" error={errors.service_region} hint="Ex.: Zona Leste de São Paulo, ou bairros que você atende.">
        <Input id="service_region" value={draft.service_region ?? ""} onChange={(e) => setDraft({ service_region: e.target.value })} invalid={!!errors.service_region} />
      </Field>

      <fieldset>
        <legend className="text-sm font-medium text-grafite">Horário de funcionamento (opcional)</legend>
        <div className="mt-1 divide-y divide-grafite/5">
          {HOUR_ROWS.map((r) => (
            <HoursRow key={r.key} label={r.label} value={hours[r.key]} onChange={(v) => setDraft({ opening_hours: { ...hours, [r.key]: v } })} />
          ))}
        </div>
      </fieldset>
    </div>
  );
}

/** Estado inicial do endereço a partir do rascunho. */
export const addressFromDraft = (d: Draft) =>
  toAddressForm({
    street: d.street || null,
    street_number: d.street_number || null,
    complement: d.complement || null,
    neighborhood: d.neighborhood || null,
    city: d.city || null,
    state: d.state || null,
    postal_code: d.postal_code || null,
    lat: d.lat ?? null,
    lng: d.lng ?? null,
    place_id: d.place_id ?? null,
  });
