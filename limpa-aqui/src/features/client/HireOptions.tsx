import { Field, Textarea, cn } from "@/components/shared/ui";
import type { LogisticsMode } from "@/lib/types";

/** Escolha de logística e pagamento antes de confirmar a contratação (mostrados antes de confirmar, como manda o PRD). */
export function HireOptions({
  pickupAvailable,
  logistics,
  onLogistics,
  notes,
  onNotes,
}: {
  pickupAvailable: boolean;
  logistics: LogisticsMode;
  onLogistics: (v: LogisticsMode) => void;
  notes: string;
  onNotes: (v: string) => void;
}) {
  const options: Array<{ v: LogisticsMode; title: string; text: string; disabled?: boolean; soon?: boolean }> = [
    { v: "sem_logistica", title: "Eu levo e busco", text: "Você combina com o prestador e leva até ele." },
    {
      v: "prestador",
      title: "O prestador busca e entrega",
      text: pickupAvailable ? "Ele vai até o seu endereço buscar e devolver." : "Este prestador não faz coleta.",
      disabled: !pickupAvailable,
    },
    { v: "entregador", title: "Entregador do Limpa Aqui", text: "Coleta e devolução por entregadores parceiros.", disabled: true, soon: true },
  ];
  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-grafite">Como os itens vão e voltam</legend>
        <div className="grid gap-2">
          {options.map((o) => (
            <label
              key={o.v}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-xl border p-3",
                logistics === o.v ? "border-agua bg-agua-50/60" : "border-grafite/10",
                o.disabled && "cursor-not-allowed opacity-50",
              )}
            >
              <input
                type="radio"
                name="logistics"
                className="mt-1 accent-agua"
                checked={logistics === o.v}
                disabled={o.disabled}
                onChange={() => onLogistics(o.v)}
              />
              <span>
                <span className="block text-sm font-semibold text-grafite">
                  {o.title} {o.soon && <span className="ml-1 rounded-full bg-nevoa px-2 py-0.5 text-[11px] font-semibold">Em breve</span>}
                </span>
                <span className="block text-xs text-grafite-500">{o.text}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="rounded-xl bg-nevoa p-3 text-sm">
        <p className="font-semibold text-grafite">Pagamento: direto ao prestador</p>
        <p className="text-xs text-grafite-500">Você paga ao prestador (Pix, dinheiro ou cartão, como combinarem). O pagamento pelo app chega em breve.</p>
      </div>
      <Field label="Recado para o prestador (opcional)" htmlFor="hire-notes">
        <Textarea id="hire-notes" rows={2} maxLength={500} placeholder="Ex.: portão azul, melhor horário..." value={notes} onChange={(e) => onNotes(e.target.value)} />
      </Field>
    </div>
  );
}
