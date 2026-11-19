import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Bike, Plus, Search, ShieldCheck, Store } from "lucide-react";
import { Alert, Button, Card, PageHeader, buttonClass, cn } from "@/components/shared/ui";
import { SimpleLayout } from "@/components/layout/SimpleLayout";
import { useAuth } from "@/contexts/AuthContext";
import { useBusiness } from "@/contexts/BusinessContext";
import { ROLE_LABEL, useRoles, type RoleStatus, type UserRole } from "@/contexts/RolesContext";

const ICON: Record<UserRole, ReactNode> = {
  anunciante: <Search className="h-5 w-5" />,
  prestador: <Store className="h-5 w-5" />,
  entregador: <Bike className="h-5 w-5" />,
  admin: <ShieldCheck className="h-5 w-5" />,
};

const STATUS_TEXT: Record<RoleStatus, string> = { ativo: "Ativo", pendente: "Aguardando aprovação", suspenso: "Suspenso" };

/** /conta — os perfis da conta, o que cada um já permite e como acrescentar outro. */
export default function AccountPage() {
  const { user } = useAuth();
  const { business, role: bizRole } = useBusiness();
  const { roles, statusOf, addRole } = useRoles();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const firstName = String(user?.user_metadata?.full_name ?? "").split(" ")[0];

  async function add(role: "anunciante" | "prestador" | "entregador") {
    setBusy(role);
    setMsg(null);
    const err = await addRole(role);
    setBusy(null);
    if (err) return setMsg({ kind: "error", text: err });
    setMsg({
      kind: "success",
      text: role === "entregador" ? "Pedido enviado. A administração vai analisar seu cadastro de entregador." : `Perfil "${ROLE_LABEL[role]}" adicionado.`,
    });
  }

  function body(role: UserRole, status: RoleStatus): ReactNode {
    if (status === "suspenso") return <p className="text-sm text-grafite-500">Este perfil está suspenso. Fale com a administração do Limpa Aqui.</p>;
    switch (role) {
      case "prestador":
        return business ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="flex-1 text-sm text-grafite-500">
              {bizRole === "owner" ? "Você é dono(a) da" : "Você faz parte da equipe da"} <strong className="text-grafite">{business.name}</strong>.
            </p>
            <Link to="/app" className={buttonClass()}>
              Abrir minha lavanderia
            </Link>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <p className="flex-1 text-sm text-grafite-500">Falta cadastrar o seu negócio para receber pedidos.</p>
            <Link to="/onboarding" className={buttonClass()}>
              Cadastrar meu negócio
            </Link>
          </div>
        );
      case "anunciante":
        return (
          <div className="flex flex-wrap items-center gap-3">
            <p className="flex-1 text-sm text-grafite-500">Seus dados, endereços e pedidos de serviços contratados.</p>
            <Link to="/cliente" className={buttonClass()}>
              Abrir minha área de cliente
            </Link>
          </div>
        );
      case "entregador":
        return status === "pendente" ? (
          <p className="text-sm text-grafite-500">Seu cadastro está em análise pela administração. Você será avisado quando for aprovado.</p>
        ) : (
          <p className="text-sm text-grafite-500">Cadastro aprovado. As corridas de coleta e devolução chegam na etapa de logística.</p>
        );
      case "admin":
        return (
          <div className="flex flex-wrap items-center gap-3">
            <p className="flex-1 text-sm text-grafite-500">Municípios atendidos, aprovação de entregadores e, depois, relatórios.</p>
            <Link to="/admin" className={buttonClass("dark")}>
              Abrir administração
            </Link>
          </div>
        );
    }
  }

  const missing = (["anunciante", "prestador", "entregador"] as const).filter((r) => !statusOf(r));
  const order: UserRole[] = ["admin", "prestador", "anunciante", "entregador"];

  return (
    <SimpleLayout>
      <div className="space-y-6">
        <PageHeader title={firstName ? `Olá, ${firstName}` : "Minha conta"} description="Seus perfis no Limpa Aqui." />
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

        {roles.length === 0 && (
          <Card className="p-6 text-sm text-grafite-500">Sua conta ainda não tem perfil. Escolha um abaixo para começar.</Card>
        )}

        {order
          .filter((r) => statusOf(r))
          .map((r) => {
            const st = statusOf(r)!;
            return (
              <Card key={r} className="p-5">
                <div className="mb-3 flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-agua-50 text-petroleo">{ICON[r]}</span>
                  <h2 className="flex-1 text-base font-semibold text-petroleo">{ROLE_LABEL[r]}</h2>
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-1 text-xs font-semibold",
                      st === "ativo" ? "bg-agua-50 text-petroleo" : st === "pendente" ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700",
                    )}
                  >
                    {STATUS_TEXT[st]}
                  </span>
                </div>
                {body(r, st)}
              </Card>
            );
          })}

        {missing.length > 0 && (
          <Card className="p-5">
            <h2 className="text-base font-semibold text-petroleo">Acrescentar perfil</h2>
            <p className="mt-1 text-sm text-grafite-500">Uma mesma conta pode contratar, oferecer serviços e fazer entregas.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {missing.map((r) => (
                <Button key={r} variant="outline" loading={busy === r} disabled={busy !== null} onClick={() => void add(r)}>
                  <Plus className="h-4 w-4" aria-hidden /> {ROLE_LABEL[r]}
                </Button>
              ))}
            </div>
          </Card>
        )}
      </div>
    </SimpleLayout>
  );
}
