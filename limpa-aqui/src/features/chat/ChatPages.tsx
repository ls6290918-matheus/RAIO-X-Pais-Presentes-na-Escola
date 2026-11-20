import { useParams } from "react-router-dom";
import { PageHeader } from "@/components/shared/ui";
import { useBusiness } from "@/contexts/BusinessContext";
import { ClientShell } from "@/features/client/ClientShell";
import { ChatInbox, ChatThread } from "./Chat";

/** /cliente/mensagens e /cliente/mensagens/:id — conversas do cliente. */
export function ClientMessagesPage() {
  const { id } = useParams();
  return (
    <ClientShell>
      {id ? (
        <ChatThread conversationId={id} businessId={null} backTo="/cliente/mensagens" className="h-[calc(100dvh-10.5rem)] sm:h-[calc(100dvh-8.5rem)]" />
      ) : (
        <div className="space-y-5">
          <PageHeader title="Mensagens" description="Suas conversas com prestadores, por anúncio ou por pedido." />
          <ChatInbox businessId={null} basePath="/cliente/mensagens" />
        </div>
      )}
    </ClientShell>
  );
}

/** /app/mensagens e /app/mensagens/:id — conversas da lavanderia (dono e equipe). */
export function ProviderMessagesPage() {
  const { id } = useParams();
  const { business } = useBusiness();
  if (!business) return null;
  return id ? (
    <ChatThread conversationId={id} businessId={business.id} backTo="/app/mensagens" className="h-[calc(100dvh-12rem)] lg:h-[calc(100dvh-8rem)]" />
  ) : (
    <div className="space-y-5">
      <PageHeader title="Mensagens" description="Conversas com clientes sobre anúncios e pedidos." />
      <ChatInbox businessId={business.id} basePath="/app/mensagens" />
    </div>
  );
}
