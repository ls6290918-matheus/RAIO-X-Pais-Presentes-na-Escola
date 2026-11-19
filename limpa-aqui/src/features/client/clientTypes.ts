import type { Address } from "@/lib/maps";
import type { LogisticsMode, OrderStatus, PaymentMode } from "@/lib/types";

export type UserAddress = Address & {
  id: string;
  label: string;
  is_default: boolean;
  municipality_id: number | null;
  municipality: { name: string } | null;
};

export type MyOrder = {
  id: string;
  number: number;
  status: OrderStatus;
  created_at: string;
  due_date: string;
  total: number;
  paid: boolean;
  business_name: string;
  business_whatsapp: string | null;
  items: Array<{ name: string; quantity: number; unit_price: number }>;
  payment_mode: PaymentMode | null;
  logistics_mode: LogisticsMode | null;
  delivery_fee_total: number;
};

export const isActiveOrder = (o: MyOrder) => !["entregue", "cancelado"].includes(o.status);
