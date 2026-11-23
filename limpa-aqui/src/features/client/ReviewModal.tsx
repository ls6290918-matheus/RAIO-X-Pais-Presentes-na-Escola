import { useState } from "react";
import { Alert, Button, Modal, Textarea } from "@/components/shared/ui";
import { StarsInput } from "@/components/shared/Stars";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";

export type ReviewStatus = {
  order_id: string;
  can_review_provider: boolean;
  provider_rating: number | null;
  deliveries: Array<{ id: string; leg: "pickup" | "return"; rating: number | null }>;
};

/** Avaliar a lavanderia do pedido e, se houve, os entregadores da coleta e da devolução. */
export function ReviewModal({ businessName, status, onClose, onSaved }: { businessName: string; status: ReviewStatus; onClose: () => void; onSaved: () => void }) {
  const [rating, setRating] = useState(status.provider_rating ?? 0);
  const [quality, setQuality] = useState(0);
  const [punctuality, setPunctuality] = useState(0);
  const [service, setService] = useState(0);
  const [comment, setComment] = useState("");
  const [couriers, setCouriers] = useState<Record<string, number>>(Object.fromEntries(status.deliveries.map((d) => [d.id, d.rating ?? 0])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!rating) return setError("Escolha de 1 a 5 estrelas para a lavanderia.");
    setBusy(true);
    setError(null);
    const r = await supabase.rpc("submit_review", {
      p_order_id: status.order_id,
      p_rating: rating,
      p_comment: comment.trim() || null,
      p_quality: quality || null,
      p_punctuality: punctuality || null,
      p_service: service || null,
      p_delivery_id: null,
    });
    if (r.error) {
      setBusy(false);
      return setError(friendlyError(r.error));
    }
    for (const d of status.deliveries) {
      const v = couriers[d.id];
      if (!v || v === d.rating) continue;
      const c = await supabase.rpc("submit_review", { p_order_id: status.order_id, p_rating: v, p_delivery_id: d.id });
      if (c.error) {
        setBusy(false);
        return setError(friendlyError(c.error));
      }
    }
    setBusy(false);
    onSaved();
  }

  return (
    <Modal open title="Como foi o seu pedido?" onClose={onClose}>
      <div className="space-y-5" data-testid="review-modal">
        {error && <Alert>{error}</Alert>}
        <div className="text-center">
          <p className="text-sm font-semibold text-petroleo">{businessName}</p>
          <div className="mt-2">
            <StarsInput value={rating} onChange={setRating} label="Nota da lavanderia" size={36} />
          </div>
        </div>
        <div className="space-y-2 rounded-2xl bg-nevoa p-3">
          {(
            [
              ["Qualidade do serviço", quality, setQuality],
              ["Pontualidade", punctuality, setPunctuality],
              ["Atendimento", service, setService],
            ] as const
          ).map(([label, v, set]) => (
            <div key={label} className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-grafite">{label}</span>
              <StarsInput value={v} onChange={set} label={label} size={20} />
            </div>
          ))}
          <p className="text-[11px] text-grafite-500">Opcional</p>
        </div>
        <Textarea rows={3} maxLength={500} placeholder="Conte como foi (opcional). Aparece no perfil da lavanderia com o seu primeiro nome." value={comment} onChange={(e) => setComment(e.target.value)} aria-label="Comentário" />
        {status.deliveries.length > 0 && (
          <div className="space-y-2 border-t border-grafite/10 pt-4">
            <p className="text-sm font-semibold text-petroleo">E os entregadores?</p>
            {status.deliveries.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-2">
                <span className="text-xs text-grafite">{d.leg === "pickup" ? "Coleta" : "Devolução"}</span>
                <StarsInput value={couriers[d.id] ?? 0} onChange={(v) => setCouriers((c) => ({ ...c, [d.id]: v }))} label={`Nota do entregador da ${d.leg === "pickup" ? "coleta" : "devolução"}`} size={22} />
              </div>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Agora não
          </Button>
          <Button loading={busy} onClick={() => void save()} data-testid="review-send">
            Enviar avaliação
          </Button>
        </div>
        <p className="text-[11px] text-grafite-500">Você pode mudar a avaliação em até 7 dias.</p>
      </div>
    </Modal>
  );
}
