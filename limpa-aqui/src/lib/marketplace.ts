import type { LogisticsMode, PaymentMode } from "@/lib/types";

export const PAYMENT_LABEL: Record<PaymentMode, string> = {
  direto: "Pagamento direto ao prestador",
  app: "Pagamento pelo app",
};

export const LOGISTICS_LABEL: Record<LogisticsMode, string> = {
  sem_logistica: "Cliente leva e busca",
  prestador: "Prestador busca e entrega",
  entregador: "Coleta e entrega por entregador",
};
