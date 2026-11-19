import { useEffect, useRef, useState } from "react";
import { Loader2, MapPin, Search } from "lucide-react";
import { Field, Input, Select, cn } from "@/components/shared/ui";
import { MapView } from "@/components/shared/MapView";
import { UFS, onlyDigits } from "@/lib/format";
import { type Address, emptyAddress, loadPlaces, mapsEnabled } from "@/lib/maps";
import { lookupCep } from "@/lib/cep";

/** Estado do formulário de endereço (campos de texto + localização). */
export type AddressForm = {
  street: string;
  street_number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
  postal_code: string;
  lat: number | null;
  lng: number | null;
  place_id: string | null;
};

export function toAddressForm(a: Partial<Address> | null | undefined): AddressForm {
  const v = { ...emptyAddress(), ...(a ?? {}) };
  return {
    street: v.street ?? "",
    street_number: v.street_number ?? "",
    complement: v.complement ?? "",
    neighborhood: v.neighborhood ?? "",
    city: v.city ?? "",
    state: v.state ?? "",
    postal_code: maskCep(v.postal_code ?? ""),
    lat: v.lat,
    lng: v.lng,
    place_id: v.place_id,
  };
}

/** Converte o formulário para as colunas do banco (vazio vira null). */
export function fromAddressForm(f: AddressForm): Address {
  const t = (s: string) => s.trim() || null;
  return {
    street: t(f.street),
    street_number: t(f.street_number),
    complement: t(f.complement),
    neighborhood: t(f.neighborhood),
    city: t(f.city),
    state: t(f.state),
    postal_code: onlyDigits(f.postal_code) || null,
    lat: f.lat,
    lng: f.lng,
    place_id: f.place_id,
  };
}

/** Validação simples; devolve { campo: mensagem }. */
export function validateAddress(f: AddressForm, opts: { requireCity?: boolean } = {}) {
  const e: Record<string, string> = {};
  const cep = onlyDigits(f.postal_code);
  if (cep && cep.length !== 8) e.postal_code = "CEP com 8 números.";
  if (f.street.length > 120) e.street = "Muito longo.";
  if (f.street_number.length > 20) e.street_number = "Muito longo.";
  if (f.complement.length > 80) e.complement = "Muito longo.";
  if (f.neighborhood.length > 80) e.neighborhood = "Muito longo.";
  if (opts.requireCity && f.city.trim().length < 2) e.city = "Informe a cidade.";
  else if (f.city.length > 80) e.city = "Muito longo.";
  if (opts.requireCity && !f.state) e.state = "Selecione o estado.";
  return e;
}

function maskCep(v: string) {
  const d = onlyDigits(v).slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

/* ------------------------------------------------------------ Busca do Google */

type Suggestion = { id: string; main: string; secondary: string; prediction: google.maps.places.PlacePrediction };

function componentsToForm(place: google.maps.places.Place): Partial<AddressForm> {
  const get = (type: string, short = false) => {
    const c = place.addressComponents?.find((x) => x.types.includes(type));
    return (short ? c?.shortText : c?.longText) ?? "";
  };
  const state = get("administrative_area_level_1", true).toUpperCase();
  return {
    street: get("route"),
    street_number: get("street_number"),
    neighborhood: get("sublocality_level_1") || get("sublocality") || get("neighborhood"),
    city: get("administrative_area_level_2") || get("locality"),
    state: (UFS as readonly string[]).includes(state) ? state : "",
    postal_code: maskCep(get("postal_code")),
    lat: place.location?.lat() ?? null,
    lng: place.location?.lng() ?? null,
    place_id: place.id ?? null,
  };
}

function AddressSearch({ onPick, disabled }: { onPick: (f: Partial<AddressForm>) => void; disabled?: boolean }) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 4) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const { AutocompleteSuggestion, AutocompleteSessionToken } = await loadPlaces();
        tokenRef.current ??= new AutocompleteSessionToken();
        const { suggestions: list } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: q,
          sessionToken: tokenRef.current,
          includedRegionCodes: ["br"],
          language: "pt-BR",
        });
        if (cancelled) return;
        setError(null);
        setSuggestions(
          list
            .filter((s) => s.placePrediction)
            .slice(0, 5)
            .map((s) => ({
              id: s.placePrediction!.placeId,
              main: s.placePrediction!.mainText?.toString() ?? s.placePrediction!.text.toString(),
              secondary: s.placePrediction!.secondaryText?.toString() ?? "",
              prediction: s.placePrediction!,
            })),
        );
        setOpen(true);
      } catch {
        if (!cancelled) setError("A busca de endereço do Google não respondeu. Preencha os campos abaixo.");
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  async function pick(s: Suggestion) {
    setBusy(true);
    setOpen(false);
    try {
      const place = s.prediction.toPlace();
      await place.fetchFields({ fields: ["addressComponents", "location", "id"] });
      tokenRef.current = null; // a sessão de busca termina ao escolher um endereço
      onPick(componentsToForm(place));
      setQuery("");
      setSuggestions([]);
    } catch {
      setError("Não foi possível buscar os detalhes deste endereço. Preencha os campos abaixo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative" ref={boxRef}>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-grafite-300" aria-hidden />
      <Input
        aria-label="Buscar endereço no Google"
        placeholder="Buscar endereço (rua, número, bairro...)"
        className="pl-10"
        value={query}
        disabled={disabled}
        autoComplete="off"
        onFocus={() => suggestions.length && setOpen(true)}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
      />
      {busy && <Loader2 className="absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-grafite-500" aria-hidden />}
      {open && suggestions.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-grafite/10 bg-white shadow-card" role="listbox">
          {suggestions.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                role="option"
                aria-selected="false"
                onClick={() => void pick(s)}
                className="flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left hover:bg-nevoa"
              >
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-agua-600" aria-hidden />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-grafite">{s.main}</span>
                  <span className="block truncate text-xs text-grafite-500">{s.secondary}</span>
                </span>
              </button>
            </li>
          ))}
          <li className="px-3.5 py-1.5 text-right text-[10px] text-grafite-300">Google</li>
        </ul>
      )}
      {error && <p className="mt-1.5 text-xs text-grafite-500">{error}</p>}
    </div>
  );
}

/* ------------------------------------------------------------ Campos */

/**
 * Endereço com busca do Google (quando a chave está configurada) + campos editáveis.
 * Editar rua, número, bairro, cidade, UF ou CEP à mão apaga a localização no mapa,
 * para não guardar um ponto que não corresponde mais ao endereço.
 */
export function AddressFields({
  value,
  onChange,
  errors = {},
  disabled,
  idPrefix = "addr",
}: {
  value: AddressForm;
  onChange: (v: AddressForm) => void;
  errors?: Record<string, string>;
  disabled?: boolean;
  idPrefix?: string;
}) {
  const set = (k: keyof AddressForm, keepLocation = false) => (e: { target: { value: string } }) => {
    const raw = e.target.value;
    const v = k === "postal_code" ? maskCep(raw) : raw;
    onChange({ ...value, [k]: v, ...(keepLocation ? {} : { lat: null, lng: null, place_id: null }) });
  };
  const id = (k: string) => `${idPrefix}-${k}`;
  const located = value.lat != null && value.lng != null;
  const [cepState, setCepState] = useState<"idle" | "loading" | "notfound" | "error" | "ok">("idle");

  // CEP completo: preenche rua, bairro, cidade e estado pelo ViaCEP (número e complemento ficam com a pessoa)
  async function onCep(e: { target: { value: string } }) {
    const masked = maskCep(e.target.value);
    const next = { ...value, postal_code: masked, lat: null, lng: null, place_id: null };
    onChange(next);
    if (onlyDigits(masked).length !== 8 || onlyDigits(masked) === onlyDigits(value.postal_code)) {
      setCepState("idle");
      return;
    }
    setCepState("loading");
    try {
      const r = await lookupCep(masked);
      if (!r) return setCepState("notfound");
      onChange({
        ...next,
        street: r.street || next.street,
        neighborhood: r.neighborhood || next.neighborhood,
        city: r.city || next.city,
        state: r.state || next.state,
      });
      setCepState("ok");
    } catch {
      setCepState("error");
    }
  }

  return (
    <div className="space-y-4">
      {mapsEnabled && <AddressSearch disabled={disabled} onPick={(p) => onChange({ ...value, ...p })} />}

      <div className="sm:w-48">
        <Field label="CEP" htmlFor={id("cep")} error={errors.postal_code}>
          <Input id={id("cep")} inputMode="numeric" placeholder="00000-000" value={value.postal_code} onChange={(e) => void onCep(e)} disabled={disabled} invalid={!!errors.postal_code} />
        </Field>
      </div>
      {cepState !== "idle" && (
        <p className="flex items-center gap-2 text-xs text-grafite-500" role="status" data-testid="cep-status">
          {cepState === "loading" && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          {cepState === "loading" && "Buscando o CEP..."}
          {cepState === "ok" && "Endereço preenchido pelo CEP. Confira e informe o número."}
          {cepState === "notfound" && "CEP não encontrado. Preencha o endereço à mão."}
          {cepState === "error" && "Não foi possível consultar o CEP agora. Preencha o endereço à mão."}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
        <Field label="Rua" htmlFor={id("street")} error={errors.street}>
          <Input id={id("street")} value={value.street} onChange={set("street")} disabled={disabled} invalid={!!errors.street} />
        </Field>
        <Field label="Número" htmlFor={id("number")} error={errors.street_number}>
          <Input id={id("number")} value={value.street_number} onChange={set("street_number")} disabled={disabled} invalid={!!errors.street_number} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Complemento" htmlFor={id("complement")} error={errors.complement}>
          <Input
            id={id("complement")}
            placeholder="Apto, bloco, loja..."
            value={value.complement}
            onChange={set("complement", true)}
            disabled={disabled}
            invalid={!!errors.complement}
          />
        </Field>
        <Field label="Bairro" htmlFor={id("neighborhood")} error={errors.neighborhood}>
          <Input id={id("neighborhood")} value={value.neighborhood} onChange={set("neighborhood")} disabled={disabled} invalid={!!errors.neighborhood} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-[1fr_110px]">
        <Field label="Cidade" htmlFor={id("city")} error={errors.city}>
          <Input id={id("city")} value={value.city} onChange={set("city")} disabled={disabled} invalid={!!errors.city} />
        </Field>
        <Field label="Estado" htmlFor={id("state")} error={errors.state}>
          <Select id={id("state")} value={value.state} onChange={set("state")} disabled={disabled} invalid={!!errors.state}>
            <option value="">UF</option>
            {UFS.map((uf) => (
              <option key={uf} value={uf}>
                {uf}
              </option>
            ))}
          </Select>
        </Field>
      </div>


      {mapsEnabled && (
        <div>
          {located ? (
            <MapView markers={[{ lat: value.lat!, lng: value.lng! }]} className="h-44" />
          ) : (
            <p className={cn("flex items-center gap-2 text-xs text-grafite-500")}>
              <MapPin className="h-3.5 w-3.5" aria-hidden />
              Use a busca acima para marcar o local no mapa (necessário para a rota de entregas).
            </p>
          )}
        </div>
      )}
    </div>
  );
}
