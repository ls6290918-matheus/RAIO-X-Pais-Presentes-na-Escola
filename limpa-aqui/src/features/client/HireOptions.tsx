import { useEffect, useState } from "react";
import { Field, Textarea, cn } from "@/components/shared/ui";
import { formatBRL } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import type { LogisticsMode, PaymentMode } from "@/lib/types";

export type CourierQuote = { available: boolean; reason: string | null; distance_km: number | null; fee_per_leg: number | null; total: number | null };

/** O admin pode desligar o pagamento pelo app a qualquer momento: a tela pergunta antes de oferecer. */
export function useAppPaymentAvailable() {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    void supabase.rpc("app_payment_available").then(({ data }) => setOn(Boolean(data)));
  }, []);
  return on;
}

/** Escolha de logística e pagamento antes de confirmar a contratação (mostrados antes de confirmar, como manda o PRD). */
export function HireOptions({
  pickupAvailable,
  logistics,
  onLogistics,
  notes,
  onNotes,
  courier,
  payment,
  onPayment,
  acceptsDirect,
  acceptsApp,
}: {
  courier?: CourierQuote | null;
  payment: PaymentMode;
  onPayment: (v: PaymentMode) => void;
  acceptsDirect: boolean;
  acceptsApp: boolean;
  pickupAvailable: boolean;
  logistics: LogisticsMode;
  onLogistics: (v: LogisticsMode) => void;
  notes: string;
  onNotes: (v: string) => void;
}) {
  const platformApp = useAppPaymentAvailable();
  const appOk = acceptsApp && platformApp === true;
  // escolhe sozinho a única forma disponível (ou volta para "direto" se o app foi desligado)
  useEffect(() => {
    if (payment === "app" && platformApp !== null && !appOk && acceptsDirect) onPayment("direto");
    if (payment === "direto" && !acceptsDirect && appOk) onPayment("app");
  }, [payment, appOk, acceptsDirect, platformApp, onPayment]);

  const payOptions: Array<{ v: PaymentMode; title: string; text: string; disabled: boolean }> = [
    {
      v: "app",
      title: "Pelo app, com Pix",
      text: appOk
        ? `Você paga agora pelo Limpa Aqui${logistics === "entregador" ? " (serviço e entregas juntos)" : ""}. O pedido começa assim que o Pix for confirmado.`
        : !acceptsApp
          ? "Este prestador ainda não recebe pelo app."
          : platformApp === null
            ? "Verificando..."
            : "Temporariamente indisponível.",
      disabled: !appOk,
    },
    {
      v: "direto",
      title: "Direto ao prestador",
      text: acceptsDirect
        ? `Você paga ao prestador (Pix, dinheiro ou cartão, como combinarem)${logistics === "entregador" ? " e ao entregador em cada corrida" : ""}.`
        : "Este prestador só recebe pelo app.",
      disabled: !acceptsDirect,
    },
  ];

  const options: Array<{ v: LogisticsMode; title: string; text: string; disabled?: boolean; soon?: boolean }> = [
    { v: "sem_logistica", title: "Eu levo e busco", text: "Você combina com o prestador e leva até ele." },
    {
      v: "prestador",
      title: "O prestador busca e entrega",
      text: pickupAvailable ? "Ele vai até o seu endereço buscar e devolver." : "Este prestador não faz coleta.",
      disabled: !pickupAvailable,
    },
    courier?.available
      ? {
          v: "entregador",
          title: `Entregador do Limpa Aqui · ${formatBRL(Number(courier.total))}`,
          text: `Coleta e devolução (${formatBRL(Number(courier.fee_per_leg))} cada, ~${String(courier.distance_km).replace(".", ",")} km). ${payment === "app" ? "Pago junto, pelo app." : "Você paga ao entregador em cada corrida."}`,
        }
      : {
          v: "entregador",
          title: "Entregador do Limpa Aqui",
          text: courier === undefined ? "Calculando..." : courier?.reason ?? "Ainda não disponível na sua região.",
          disabled: true,
        },
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
      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-grafite">Como você quer pagar</legend>
        <div className="grid gap-2" data-testid="payment-options">
          {payOptions.map((o) => (
            <label
              key={o.v}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-xl border p-3",
                payment === o.v && !o.disabled ? "border-agua bg-agua-50/60" : "border-grafite/10",
                o.disabled && "cursor-not-allowed opacity-50",
              )}
            >
              <input
                type="radio"
                name="payment"
                className="mt-1 accent-agua"
                checked={payment === o.v}
                disabled={o.disabled}
                onChange={() => onPayment(o.v)}
              />
              <span>
                <span className="block text-sm font-semibold text-grafite">{o.title}</span>
                <span className="block text-xs text-grafite-500">{o.text}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="Recado para o prestador (opcional)" htmlFor="hire-notes">
        <Textarea id="hire-notes" rows={2} maxLength={500} placeholder="Ex.: portão azul, melhor horário..." value={notes} onChange={(e) => onNotes(e.target.value)} />
      </Field>
    </div>
  );
}
