import { useEffect, useState } from "react";
import { Alert, Button, Field, Input, Modal, Select, Textarea } from "@/components/shared/ui";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";

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
    setSaving(false);
    if (err) return setError(friendlyError(err));
    await onSaved(data as string);
  }

  return (
    <Modal open title="Publicar anúncio" onClose={onClose}>
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
