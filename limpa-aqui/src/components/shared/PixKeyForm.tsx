import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Field, Input, Select } from "@/components/shared/ui";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";

type KeyType = "cpf" | "cnpj" | "email" | "telefone" | "aleatoria";
type Account = { pix_key_type: KeyType; pix_key: string; holder_name: string };

const TYPE_LABEL: Record<KeyType, string> = { cpf: "CPF", cnpj: "CNPJ", email: "E-mail", telefone: "Telefone", aleatoria: "Chave aleatória" };

/** Chave Pix para receber repasses do Limpa Aqui (lavanderia: só o dono; entregador: a própria conta). */
export function PixKeyForm({ businessId, onSaved, disabled }: { businessId: string | null; onSaved?: () => void; disabled?: boolean }) {
  const { user } = useAuth();
  const [acc, setAcc] = useState<Account | null | undefined>(undefined);
  const [type, setType] = useState<KeyType>("cpf");
  const [key, setKey] = useState("");
  const [holder, setHolder] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  const load = useCallback(async () => {
    let q = supabase.from("payout_accounts").select("pix_key_type, pix_key, holder_name");
    q = businessId ? q.eq("business_id", businessId) : q.eq("user_id", user?.id ?? "");
    const { data } = await q.maybeSingle();
    const a = (data as Account | null) ?? null;
    setAcc(a);
    if (a) {
      setType(a.pix_key_type);
      setKey(a.pix_key);
      setHolder(a.holder_name);
    }
  }, [businessId, user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.rpc("save_payout_account", { p_business_id: businessId, p_key_type: type, p_key: key, p_holder: holder });
    setBusy(false);
    if (error) return setMsg({ kind: "error", text: friendlyError(error) });
    setEditing(false);
    setMsg({ kind: "success", text: "Chave Pix salva." });
    await load();
    onSaved?.();
  }

  if (acc === undefined) return null;
  if (acc && !editing)
    return (
      <div className="space-y-2" data-testid="pix-key">
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
        <p className="text-sm text-grafite">
          Repasses vão para a chave Pix <strong>{TYPE_LABEL[acc.pix_key_type]}: {acc.pix_key}</strong> ({acc.holder_name}).
        </p>
        {!disabled && (
          <Button variant="outline" onClick={() => setEditing(true)}>
            Trocar chave Pix
          </Button>
        )}
      </div>
    );
  if (disabled) return <p className="text-sm text-grafite-500">Nenhuma chave Pix de repasse cadastrada.</p>;
  return (
    <div className="space-y-3" data-testid="pix-key-form">
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <Field label="Tipo de chave" htmlFor="pix-type">
          <Select id="pix-type" value={type} onChange={(e) => setType(e.target.value as KeyType)}>
            {Object.entries(TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Chave Pix" htmlFor="pix-key-input">
          <Input id="pix-key-input" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} />
        </Field>
      </div>
      <Field label="Nome do titular" htmlFor="pix-holder" hint="Como aparece no banco. Usado só para o Limpa Aqui fazer os seus repasses.">
        <Input id="pix-holder" value={holder} onChange={(e) => setHolder(e.target.value)} />
      </Field>
      <div className="flex gap-2">
        <Button loading={busy} onClick={() => void save()}>
          Salvar chave Pix
        </Button>
        {acc && (
          <Button variant="outline" onClick={() => setEditing(false)}>
            Cancelar
          </Button>
        )}
      </div>
    </div>
  );
}
