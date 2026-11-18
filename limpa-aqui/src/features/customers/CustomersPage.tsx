import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { MessageCircle, Pencil, Plus, Search, Trash2, Users } from "lucide-react";
import { Alert, Button, Card, EmptyState, InlineLoader, Input, Modal, PageHeader } from "@/components/shared/ui";
import { useBusiness } from "@/contexts/BusinessContext";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { maskPhone, searchTerm, whatsappLink } from "@/lib/format";
import type { Customer } from "@/lib/types";
import { CUSTOMER_COLUMNS, CustomerForm } from "./CustomerForm";

export default function CustomersPage() {
  const { business, role } = useBusiness();
  const isOwner = role === "owner";
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [params] = useSearchParams();
  const [editing, setEditing] = useState<Customer | null | undefined>(params.get("novo") ? null : undefined); // undefined = fechado, null = novo

  const load = useCallback(async () => {
    if (!business) return;
    setError(null);
    const q = searchTerm(query);
    let req = supabase.from("customers").select(CUSTOMER_COLUMNS).eq("business_id", business.id).order("name").limit(200);
    if (q) {
      const digits = q.replace(/\D/g, "");
      req = digits.length >= 4 ? req.or(`name.ilike.%${q}%,whatsapp.ilike.%${digits}%`) : req.ilike("name", `%${q}%`);
    }
    const { data, error: err } = await req;
    if (err) setError(friendlyError(err));
    setCustomers((data as Customer[]) ?? []);
    setLoading(false);
  }, [business, query]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  async function remove(c: Customer) {
    if (!window.confirm(`Excluir o cliente ${c.name}?`)) return;
    const { error: err } = await supabase.from("customers").delete().eq("id", c.id);
    if (err) return setError(friendlyError(err));
    setCustomers((list) => list.filter((x) => x.id !== c.id));
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clientes"
        description="Quem deixa os calçados com você."
        action={
          <Button onClick={() => setEditing(null)}>
            <Plus className="h-4 w-4" aria-hidden /> Novo cliente
          </Button>
        }
      />

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-grafite-300" aria-hidden />
        <Input
          aria-label="Buscar cliente"
          placeholder="Buscar por nome ou WhatsApp"
          className="pl-10"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {error && <Alert>{error}</Alert>}

      <Card>
        {loading ? (
          <InlineLoader />
        ) : customers.length === 0 ? (
          query ? (
            <EmptyState icon={<Search className="h-6 w-6" />} title="Nenhum cliente encontrado" description="Confira a busca ou cadastre um novo cliente." />
          ) : (
            <EmptyState
              icon={<Users className="h-6 w-6" />}
              title="Nenhum cliente ainda"
              description="Cadastre seus clientes para criar pedidos e avisar pelo WhatsApp quando estiver pronto."
              action={<Button onClick={() => setEditing(null)}>Cadastrar cliente</Button>}
            />
          )
        ) : (
          <ul className="divide-y divide-grafite/5">
            {customers.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-agua-50 text-sm font-semibold text-petroleo">
                  {c.name.trim()[0]?.toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-petroleo">{c.name}</p>
                  <p className="truncate text-xs text-grafite-500">
                    {[c.whatsapp && maskPhone(c.whatsapp), c.email].filter(Boolean).join(" · ") || "Sem contato"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Link
                    to={`/app/pedidos/novo?cliente=${c.id}`}
                    className="hidden rounded-lg px-3 py-2 text-xs font-semibold text-petroleo hover:bg-nevoa sm:block"
                  >
                    Novo pedido
                  </Link>
                  {c.whatsapp && (
                    <a
                      href={whatsappLink(c.whatsapp)}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg p-2 text-agua-600 hover:bg-nevoa"
                      aria-label={`WhatsApp de ${c.name}`}
                    >
                      <MessageCircle className="h-4 w-4" />
                    </a>
                  )}
                  <button onClick={() => setEditing(c)} className="rounded-lg p-2 text-grafite-500 hover:bg-nevoa" aria-label={`Editar ${c.name}`}>
                    <Pencil className="h-4 w-4" />
                  </button>
                  {isOwner && (
                    <button onClick={() => void remove(c)} className="rounded-lg p-2 text-grafite-500 hover:bg-red-50 hover:text-red-600" aria-label={`Excluir ${c.name}`}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal open={editing !== undefined} title={editing ? "Editar cliente" : "Novo cliente"} onClose={() => setEditing(undefined)}>
        <CustomerForm
          key={editing?.id ?? "novo"}
          customer={editing}
          onCancel={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            void load();
          }}
        />
      </Modal>
    </div>
  );
}
