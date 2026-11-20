import { useCallback, useEffect, useState } from "react";
import { Flag } from "lucide-react";
import { Alert, Button, Card, EmptyState, InlineLoader, Modal, cn } from "@/components/shared/ui";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import type { Message } from "@/features/chat/chatApi";

type Report = {
  id: string;
  conversation_id: string;
  reason: string;
  status: "aberta" | "resolvida";
  created_at: string;
  reporter: string;
  client_name: string;
  business_name: string;
  subject: string;
  messages: number;
};

/** Administração → Denúncias: conversas denunciadas (o admin só lê conversas com denúncia). */
export function AdminReports() {
  const [list, setList] = useState<Report[] | null>(null);
  const [open, setOpen] = useState<Report | null>(null);
  const [msgs, setMsgs] = useState<Message[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: err } = await supabase.rpc("admin_chat_reports");
    if (err) setError(friendlyError(err));
    setList((data as Report[]) ?? []);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function view(r: Report) {
    setOpen(r);
    setMsgs(null);
    const { data } = await supabase.rpc("conversation_messages", { p_conversation_id: r.conversation_id });
    setMsgs(((data as Message[]) ?? []).reverse());
  }

  async function resolve(r: Report, block: boolean) {
    const { error: err } = await supabase.rpc("admin_resolve_chat_report", { p_report_id: r.id, p_block: block });
    if (err) return setError(friendlyError(err));
    setOpen(null);
    await load();
  }

  if (list === null) return <InlineLoader />;
  return (
    <div className="space-y-4" data-testid="admin-reports">
      {error && <Alert>{error}</Alert>}
      {list.length === 0 ? (
        <Card>
          <EmptyState icon={<Flag className="h-6 w-6" />} title="Nenhuma denúncia" description="Quando alguém denunciar uma conversa, ela aparece aqui." />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-grafite/5">
            {list.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-grafite">
                    {r.client_name} ↔ {r.business_name}
                  </p>
                  <p className="text-xs text-grafite-500">
                    {r.subject} · denunciada por {r.reporter} em {formatDateTime(r.created_at)}
                  </p>
                  <p className="mt-1 text-sm text-grafite">“{r.reason}”</p>
                </div>
                <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", r.status === "aberta" ? "bg-amber-50 text-amber-800" : "bg-nevoa text-grafite-500")}>
                  {r.status === "aberta" ? "Aberta" : "Resolvida"}
                </span>
                <Button variant="outline" className="h-9" onClick={() => void view(r)}>
                  Ver conversa ({r.messages})
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {open && (
        <Modal open title={`${open.client_name} ↔ ${open.business_name}`} onClose={() => setOpen(null)}>
          <div className="space-y-3">
            <div className="max-h-80 space-y-2 overflow-y-auto rounded-xl bg-nevoa p-3">
              {msgs === null ? (
                <InlineLoader />
              ) : (
                msgs.map((m) => (
                  <div key={m.id} className="rounded-lg bg-white px-3 py-2 text-sm">
                    <p className="text-[11px] text-grafite-500">{formatDateTime(m.created_at)}</p>
                    <p className="whitespace-pre-wrap text-grafite">{m.body ?? "📷 Foto"}</p>
                  </div>
                ))
              )}
            </div>
            {open.status === "aberta" && (
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" onClick={() => void resolve(open, false)}>
                  Resolver sem bloquear
                </Button>
                <Button onClick={() => void resolve(open, true)}>Bloquear a conversa e resolver</Button>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
