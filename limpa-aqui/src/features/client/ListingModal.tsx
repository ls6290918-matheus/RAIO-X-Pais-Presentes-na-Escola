import { useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { Alert, Button, Field, Input, Modal, Select, Textarea } from "@/components/shared/ui";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { todayISO } from "@/lib/format";
import { MAX_LISTING_PHOTOS, uploadListingPhoto } from "@/lib/listingPhotos";

export type AddressOption = { id: string; label: string; municipality: { name: string } | null; is_default: boolean };

/** Publicar um anúncio: o que precisa lavar, onde, e se quer que busquem. */
export function ListingModal({ addresses, onClose, onSaved }: { addresses: AddressOption[]; onClose: () => void; onSaved: (id: string) => Promise<void> }) {
  const usable = addresses.filter((a) => a.municipality);
  const [cats, setCats] = useState<Array<{ code: string; name: string }>>([]);
  const [category, setCategory] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [addressId, setAddressId] = useState(usable.find((a) => a.is_default)?.id ?? usable[0]?.id ?? "");
  const [wantsPickup, setWantsPickup] = useState(false);
  const [quantity, setQuantity] = useState("");
  const [desiredDate, setDesiredDate] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void supabase.rpc("public_categories").then(({ data }) => setCats((data as Array<{ code: string; name: string }>) ?? []));
  }, []);

  async function save() {
    const e: Record<string, string> = {};
    if (!category) e.category = "Escolha o tipo de serviço.";
    if (title.trim().length < 5 || title.trim().length > 80) e.title = "Escreva de 5 a 80 letras (ex.: Lavar 2 pares de tênis).";
    if (description.length > 1000) e.description = "Até 1000 letras.";
    if (!addressId) e.address = "Escolha o endereço.";
    if (quantity && (!/^\d+$/.test(quantity) || Number(quantity) < 1 || Number(quantity) > 500)) e.quantity = "De 1 a 500.";
    if (desiredDate && desiredDate < todayISO()) e.date = "O prazo não pode ser no passado.";
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    setError(null);
    const { data, error: err } = await supabase.rpc("create_listing", {
      p_category: category,
      p_title: title.trim(),
      p_description: description.trim() || null,
      p_address_id: addressId,
      p_wants_pickup: wantsPickup,
    });
    if (err) {
      setSaving(false);
      return setError(friendlyError(err));
    }
    const id = data as string;
    // detalhes e fotos: o anúncio já está publicado; se algo falhar, avisa sem perder o anúncio
    const problems: string[] = [];
    if (quantity || desiredDate) {
      const d = await supabase.rpc("set_listing_details", { p_listing_id: id, p_quantity: quantity ? Number(quantity) : null, p_desired_date: desiredDate || null });
      if (d.error) problems.push(friendlyError(d.error));
    }
    for (const f of files) {
      try {
        await uploadListingPhoto(f, id);
      } catch (x) {
        problems.push(x instanceof Error ? x.message : "Uma foto não foi enviada.");
        break;
      }
    }
    setSaving(false);
    if (problems.length) window.alert(`Anúncio publicado, mas: ${problems[0]} Você pode tentar de novo pela página do anúncio.`);
    await onSaved(id);
  }

  return (
    <Modal open title="O que você precisa lavar?" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-grafite-500">
          Prestadores que atendem a sua cidade veem o anúncio (só o bairro, nunca a rua) e mandam propostas com preço e prazo. Você escolhe
          a melhor.
        </p>
        {error && <Alert>{error}</Alert>}
        {usable.length === 0 ? (
          <Alert>Cadastre um endereço no estado do RJ na sua área de cliente antes de anunciar.</Alert>
        ) : (
          <>
            <Field label="Tipo de serviço" htmlFor="ls-cat" error={errors.category}>
              <Select id="ls-cat" value={category} onChange={(e) => setCategory(e.target.value)} invalid={!!errors.category}>
                <option value="">Escolha</option>
                {cats.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="O que você precisa?" htmlFor="ls-title" error={errors.title}>
              <Input id="ls-title" maxLength={80} placeholder="Ex.: Lavar 2 pares de tênis brancos" value={title} onChange={(e) => setTitle(e.target.value)} invalid={!!errors.title} />
            </Field>
            <Field label="Detalhes (opcional)" htmlFor="ls-desc" error={errors.description} hint="Quantidade, tecido, manchas, prazo que você precisa...">
              <Textarea id="ls-desc" rows={3} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <Field label="Endereço" htmlFor="ls-addr" error={errors.address} hint="O prestador só vê o bairro e a cidade até você contratar.">
              <Select id="ls-addr" value={addressId} onChange={(e) => setAddressId(e.target.value)}>
                {usable.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label} · {a.municipality?.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Quantidade (opcional)" htmlFor="ls-qty" error={errors.quantity}>
                <Input id="ls-qty" type="number" inputMode="numeric" min={1} max={500} placeholder="Ex.: 3" value={quantity} onChange={(e) => setQuantity(e.target.value)} invalid={!!errors.quantity} />
              </Field>
              <Field label="Para quando? (opcional)" htmlFor="ls-date" error={errors.date}>
                <Input id="ls-date" type="date" min={todayISO()} value={desiredDate} onChange={(e) => setDesiredDate(e.target.value)} invalid={!!errors.date} />
              </Field>
            </div>
            <div>
              <p className="mb-1.5 text-sm font-medium text-grafite">Fotos (opcional, até {MAX_LISTING_PHOTOS})</p>
              <div className="flex flex-wrap gap-2" data-testid="listing-photos">
                {previews.map((src, i) => (
                  <div key={src} className="relative h-16 w-16 overflow-hidden rounded-xl bg-nevoa">
                    <img src={src} alt={`Foto ${i + 1}`} className="h-full w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => setFiles((fs) => fs.filter((_, j) => j !== i))}
                      className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-petroleo/80 text-white"
                      aria-label={`Remover foto ${i + 1}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                {files.length < MAX_LISTING_PHOTOS && (
                  <button
                    type="button"
                    onClick={() => fileInput.current?.click()}
                    className="flex h-16 w-16 flex-col items-center justify-center gap-0.5 rounded-xl border-2 border-dashed border-grafite/15 text-[10px] font-semibold text-grafite-500 hover:border-agua"
                  >
                    <ImagePlus className="h-5 w-5" aria-hidden /> Foto
                  </button>
                )}
              </div>
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                data-testid="listing-photo-input"
                onChange={(e) => {
                  const picked = Array.from(e.target.files ?? []);
                  setFiles((fs) => [...fs, ...picked].slice(0, MAX_LISTING_PHOTOS));
                  e.target.value = "";
                }}
              />
              <p className="mt-1 text-[11px] text-grafite-500">Só quem atende a sua cidade vê as fotos. Evite mostrar pessoas ou documentos.</p>
            </div>
            <label className="flex items-center gap-2 text-sm text-grafite">
              <input type="checkbox" className="h-4 w-4 accent-agua" checked={wantsPickup} onChange={(e) => setWantsPickup(e.target.checked)} />
              Prefiro que busquem e entreguem em casa
            </label>
          </>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          {usable.length > 0 && (
            <Button loading={saving} onClick={() => void save()}>
              Publicar anúncio
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
