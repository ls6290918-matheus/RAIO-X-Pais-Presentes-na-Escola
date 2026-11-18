export type Customer = {
  id: string;
  business_id: string;
  name: string;
  whatsapp: string | null;
  email: string | null;
  notes: string | null;
  created_at: string;
};

export type Service = {
  id: string;
  business_id: string;
  name: string;
  description: string | null;
  price: number;
  due_days: number | null;
  active: boolean;
};

export type OrderStatus = "recebido" | "em_lavagem" | "pronto" | "entregue" | "cancelado";

export type Order = {
  id: string;
  business_id: string;
  number: number;
  customer_id: string;
  status: OrderStatus;
  due_date: string;
  total: number;
  paid: boolean;
  notes: string | null;
  received_at: string;
  ready_at: string | null;
  delivered_at: string | null;
  canceled_at: string | null;
  created_at: string;
};

export type OrderItem = {
  id: string;
  service_id: string | null;
  service_name: string;
  description: string | null;
  quantity: number;
  unit_price: number;
  position: number;
};
