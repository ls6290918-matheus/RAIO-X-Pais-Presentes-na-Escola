import type { OrderStatus } from "@/lib/types";
import { formatBRL } from "@/lib/format";

export const STATUS_LABEL: Record<OrderStatus, string> = {
  recebido: "Recebido",
  em_lavagem: "Em lavagem",
  pronto: "Pronto",
  entregue: "Entregue",
  cancelado: "Cancelado",
};

export const STATUS_STYLE: Record<OrderStatus, string> = {
  recebido: "bg-sky-50 text-sky-700",
  em_lavagem: "bg-amber-50 text-amber-700",
  pronto: "bg-agua-50 text-petroleo",
  entregue: "bg-nevoa text-grafite-500",
  cancelado: "bg-red-50 text-red-700",
};

export const OPEN_STATUSES: OrderStatus[] = ["recebido", "em_lavagem", "pronto"];

/** Próximos passos oferecidos na tela (espelha set_order_status no banco). */
export const NEXT_STEPS: Record<OrderStatus, Array<{ to: OrderStatus; label: string; primary?: boolean }>> = {
  recebido: [
    { to: "em_lavagem", label: "Iniciar lavagem", primary: true },
    { to: "pronto", label: "Marcar como pronto" },
  ],
  em_lavagem: [
    { to: "pronto", label: "Marcar como pronto", primary: true },
    { to: "recebido", label: "Voltar para recebido" },
  ],
  pronto: [
    { to: "entregue", label: "Registrar entrega", primary: true },
    { to: "em_lavagem", label: "Voltar para lavagem" },
  ],
  entregue: [{ to: "pronto", label: "Desfazer entrega" }],
  cancelado: [],
};

export const canCancel = (s: OrderStatus) => OPEN_STATUSES.includes(s);

/** Mensagem pronta para o WhatsApp do cliente, conforme o status. */
export function whatsappMessage(opts: {
  customerName: string;
  businessName: string;
  number: number;
  status: OrderStatus;
  total: number;
  paid: boolean;
  dueDate: string;
}) {
  const first = opts.customerName.trim().split(/\s+/)[0];
  const pedido = `pedido #${opts.number}`;
  const valor = opts.paid ? "" : ` Valor: ${formatBRL(opts.total)}.`;
  switch (opts.status) {
    case "recebido":
      return `Olá, ${first}! Recebemos o seu ${pedido} na ${opts.businessName}. Previsão de entrega: ${opts.dueDate}.${valor}`;
    case "em_lavagem":
      return `Olá, ${first}! O seu ${pedido} já está em lavagem na ${opts.businessName}. Previsão de entrega: ${opts.dueDate}.`;
    case "pronto":
      return `Olá, ${first}! O seu ${pedido} está pronto para retirada na ${opts.businessName}.${valor}`;
    case "entregue":
      return `Olá, ${first}! Obrigado por escolher a ${opts.businessName}. Esperamos que tenha gostado do resultado do ${pedido}!`;
    default:
      return `Olá, ${first}! Sobre o seu ${pedido} na ${opts.businessName}:`;
  }
}
