import { useEffect, useState } from "react";
import { AlertTriangle, Camera, CheckCircle2, KeyRound, ShieldAlert } from "lucide-react";
import { Alert, Button, Input, Modal, Textarea, cn } from "@/components/shared/ui";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { compressPhoto } from "@/lib/photos";

export const PROOF_BUCKET = "delivery-proofs";

export type Proof = {
  delivery_id: string;
  leg: "pickup" | "return";
  stage: "coleta" | "entrega";
  item_count: number;
  condition: "ok" | "avaria";
  notes: string | null;
  photo_path: string | null;
  code_verified: boolean | null;
  created_at: string;
  url?: string;
};

/** Envia a foto do comprovante para <corrida>/<id>.jpg (bucket privado). */
export async function uploadProofPhoto(file: File, deliveryId: string) {
  const blob = await compressPhoto(file);
  const path = `${deliveryId}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from(PROOF_BUCKET).upload(path, blob, { contentType: "image/jpeg", cacheControl: "3600" });
  if (error) throw new Error("Não foi possível enviar a foto. Verifique a conexão e tente de novo.");
  return path;
}

/** Comprovantes das corridas, com links temporários das fotos. */
export async function loadProofs(deliveryIds: string[]) {
  if (!deliveryIds.length) return [] as Proof[];
  const { data } = await supabase.rpc("delivery_proofs_for", { p_delivery_ids: deliveryIds });
  const rows = (data as Proof[]) ?? [];
  const paths = rows.map((r) => r.photo_path).filter(Boolean) as string[];
  if (paths.length) {
    const { data: s } = await supabase.storage.from(PROOF_BUCKET).createSignedUrls(paths, 3600);
    const m = new Map((s ?? []).filter((x) => x.path && x.signedUrl).map((x) => [x.path!, x.signedUrl as string]));
    rows.forEach((r) => r.photo_path && (r.url = m.get(r.photo_path)));
  }
  return rows;
}

/** Lista de comprovantes de uma corrida (coleta e entrega). */
export function ProofList({ proofs }: { proofs: Proof[] }) {
  if (!proofs.length) return null;
  return (
    <ul className="mt-1.5 space-y-1.5" data-testid="delivery-proofs">
      {proofs.map((p) => (
        <li key={p.stage} className="flex items-start gap-2 rounded-lg bg-white/70 p-2 text-xs">
          {p.url ? (
            <a href={p.url} target="_blank" rel="noreferrer" className="shrink-0">
              <img src={p.url} alt={`Foto da ${p.stage}`} className="h-12 w-12 overflow-hidden rounded-md bg-nevoa object-cover text-[0px]" />
            </a>
          ) : (
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-nevoa text-grafite-500">
              <Camera className="h-4 w-4" aria-hidden />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-grafite">
              {p.stage === "coleta" ? "Coleta" : "Entrega"}: {p.item_count} {p.item_count === 1 ? "peça" : "peças"} ·{" "}
              {p.condition === "ok" ? <span className="text-agua-600">sem avarias</span> : <span className="text-red-700">com avaria</span>}
            </p>
            <p className="text-grafite-500">
              {formatDateTime(p.created_at)}
              {p.stage === "entrega" && (p.code_verified ? " · código conferido" : "")}
            </p>
            {p.stage === "entrega" && p.code_verified === false && (
              <p className="font-semibold text-amber-800">Entregue sem o código de quem recebe</p>
            )}
            {p.notes && <p className="text-grafite">“{p.notes}”</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Código de 4 dígitos para quem recebe as peças (lavanderia na coleta, cliente na devolução). */
export function HandoffCode({ code, leg }: { code: string; leg: "pickup" | "return" }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-petroleo px-3 py-2 text-white" data-testid="handoff-code">
      <KeyRound className="h-4 w-4 shrink-0 text-agua" aria-hidden />
      <div className="min-w-0 flex-1 text-xs">
        <p className="font-semibold">{leg === "pickup" ? "Código para receber as peças da coleta" : "Código para receber o seu pedido"}</p>
        <p className="text-white/60">Passe ao entregador só quando as peças estiverem com você.</p>
      </div>
      <span className="font-mono text-xl font-bold tracking-[0.3em] text-agua">{code}</span>
    </div>
  );
}

/** Janela do entregador para registrar a coleta ou a entrega com comprovante. */
export function ProofModal({ deliveryId, stage, orderNumber, onClose, onDone }: { deliveryId: string; stage: "coleta" | "entrega"; orderNumber: number; onClose: () => void; onDone: (msg: string) => void }) {
  const [count, setCount] = useState("");
  const [condition, setCondition] = useState<"ok" | "avaria">("ok");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [noCode, setNoCode] = useState(false);
  const [pickCount, setPickCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (stage !== "entrega") return;
    void loadProofs([deliveryId]).then((p) => {
      const c = p.find((x) => x.stage === "coleta")?.item_count;
      if (c) {
        setPickCount(c);
        setCount(String(c));
      }
    });
  }, [deliveryId, stage]);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  const photoRequired = stage === "coleta" || noCode;
  const n = Number(count);
  const ready = n >= 1 && n <= 500 && (!photoRequired || file) && (condition === "ok" || notes.trim()) && (stage === "coleta" || (noCode ? notes.trim() : /^\d{4}$/.test(code)));

  async function save() {
    setBusy(true);
    setError(null);
    let path: string | null = null;
    try {
      path = file ? await uploadProofPhoto(file, deliveryId) : null;
      if (stage === "coleta") {
        const { error: err } = await supabase.rpc("delivery_pickup", { p_delivery_id: deliveryId, p_item_count: n, p_condition: condition, p_photo_path: path, p_notes: notes || null });
        if (err) throw new Error(friendlyError(err));
        onDone("Coleta registrada com foto e quantidade.");
      } else {
        const { data, error: err } = await supabase.rpc("delivery_dropoff", {
          p_delivery_id: deliveryId, p_code: noCode ? null : code, p_item_count: n, p_condition: condition,
          p_photo_path: path, p_notes: notes || null, p_without_code: noCode,
        });
        if (err) throw new Error(friendlyError(err));
        const r = data as { ok: boolean; error?: string; remaining?: number };
        if (!r.ok) {
          throw new Error(r.error + (r.remaining ? ` Restam ${r.remaining} tentativa(s).` : ""));
        }
        onDone("Entrega registrada. Obrigado!");
      }
    } catch (e) {
      // foto enviada mas registro recusado: apaga para não ficar arquivo solto
      if (path) await supabase.storage.from(PROOF_BUCKET).remove([path]);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title={`${stage === "coleta" ? "Registrar coleta" : "Registrar entrega"} · pedido #${orderNumber}`} onClose={onClose}>
      <div className="space-y-4" data-testid="proof-modal">
        {error && <Alert>{error}</Alert>}
        {stage === "entrega" && !noCode && (
          <label className="block">
            <span className="text-sm font-medium text-grafite">Código de quem recebe</span>
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={4}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
              className="mt-1 text-center font-mono text-2xl tracking-[0.5em]"
              aria-label="Código de entrega"
              placeholder="0000"
            />
            <span className="mt-1 block text-xs text-grafite-500">Peça o código de 4 dígitos que aparece no app de quem está recebendo.</span>
          </label>
        )}
        <label className="block">
          <span className="text-sm font-medium text-grafite">Quantas peças?</span>
          <Input type="number" inputMode="numeric" min={1} max={500} value={count} onChange={(e) => setCount(e.target.value)} className="mt-1" aria-label="Quantidade de peças" />
          {pickCount !== null && n > 0 && n !== pickCount && (
            <span className="mt-1 flex items-center gap-1 text-xs font-semibold text-amber-800">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Na coleta foram {pickCount}. A lavanderia e o cliente serão avisados.
            </span>
          )}
        </label>
        <div>
          <span className="text-sm font-medium text-grafite">Estado das peças</span>
          <div className="mt-1 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Estado das peças">
            {(
              [
                ["ok", "Tudo certo", CheckCircle2],
                ["avaria", "Tem avaria", ShieldAlert],
              ] as const
            ).map(([k, label, Icon]) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={condition === k}
                onClick={() => setCondition(k)}
                className={cn(
                  "flex h-11 items-center justify-center gap-2 rounded-xl border text-sm font-semibold",
                  condition === k ? (k === "ok" ? "border-agua bg-agua-50 text-petroleo" : "border-red-300 bg-red-50 text-red-800") : "border-grafite/15 text-grafite-500",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden /> {label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className="text-sm font-medium text-grafite">Foto {photoRequired ? "(obrigatória)" : "(opcional)"}</span>
          <label className="mt-1 flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-grafite/25 p-3 text-sm text-petroleo">
            {preview ? <img src={preview} alt="Foto escolhida" className="h-14 w-14 rounded-lg object-cover" /> : <Camera className="h-6 w-6" aria-hidden />}
            <span className="font-semibold">{file ? "Trocar foto" : stage === "coleta" ? "Fotografar as peças" : "Fotografar a entrega"}</span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              aria-label="Foto do comprovante"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                if (preview) URL.revokeObjectURL(preview);
                setPreview(f ? URL.createObjectURL(f) : null);
              }}
            />
          </label>
        </div>
        <Textarea
          rows={2}
          maxLength={300}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          aria-label="Observações"
          placeholder={noCode ? "Quem recebeu e por que não tinha o código (obrigatório)" : condition === "avaria" ? "Descreva a avaria (obrigatório)" : "Observações (opcional)"}
        />
        {stage === "entrega" && (
          <label className="flex items-start gap-2 text-xs text-grafite-500">
            <input type="checkbox" checked={noCode} onChange={(e) => setNoCode(e.target.checked)} className="mt-0.5" />
            Quem recebe não tem o código (ex.: porteiro). A entrega fica marcada para conferência e exige foto e explicação.
          </label>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Voltar
          </Button>
          <Button loading={busy} disabled={!ready} onClick={() => void save()}>
            {stage === "coleta" ? "Confirmar coleta" : "Confirmar entrega"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
