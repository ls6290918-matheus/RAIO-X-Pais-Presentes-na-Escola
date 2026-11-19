import { useState } from "react";
import { Alert, Button, Field, Input, Modal, Select } from "@/components/shared/ui";
import { AddressFields, type AddressForm, fromAddressForm, toAddressForm, validateAddress } from "@/components/shared/AddressFields";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import type { UserAddress } from "./clientTypes";

const LABELS = ["Casa", "Trabalho", "Outro"];

/** Cadastro e edição de endereço do cliente (CEP primeiro, preenchimento automático). */
export function AddressModal({ address, onClose, onSaved }: { address: UserAddress | null; onClose: () => void; onSaved: (msg: string) => Promise<void> }) {
  const initialLabel = address?.label ?? "Casa";
  const [labelKind, setLabelKind] = useState(LABELS.includes(initialLabel) && initialLabel !== "Outro" ? initialLabel : "Outro");
  const [customLabel, setCustomLabel] = useState(LABELS.includes(initialLabel) ? "" : initialLabel);
  const [form, setForm] = useState<AddressForm>(toAddressForm(address));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const e = validateAddress(form, { requireCity: true });
    const label = labelKind === "Outro" ? customLabel.trim() : labelKind;
    if (!label || label.length > 30) e.label = "Dê um nome de até 30 letras (ex.: Casa da mãe).";
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    setError(null);
    const row = { label, ...fromAddressForm(form) };
    const { error: err } = address
      ? await supabase.from("user_addresses").update(row).eq("id", address.id)
      : await supabase.from("user_addresses").insert(row);
    setSaving(false);
    if (err) return setError(friendlyError(err));
    await onSaved(address ? "Endereço atualizado." : "Endereço cadastrado.");
  }

  return (
    <Modal open title={address ? "Editar endereço" : "Novo endereço"} onClose={onClose}>
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome do endereço" htmlFor="ad-label" error={labelKind !== "Outro" ? errors.label : undefined}>
            <Select id="ad-label" value={labelKind} onChange={(e) => setLabelKind(e.target.value)}>
              {LABELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          {labelKind === "Outro" && (
            <Field label="Qual?" htmlFor="ad-custom" error={errors.label}>
              <Input id="ad-custom" placeholder="Ex.: Casa da mãe" maxLength={30} value={customLabel} onChange={(e) => setCustomLabel(e.target.value)} />
            </Field>
          )}
        </div>
        <AddressFields value={form} onChange={setForm} errors={errors} idPrefix="ad" />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={saving} onClick={() => void save()}>
            Salvar endereço
          </Button>
        </div>
      </div>
    </Modal>
  );
}
