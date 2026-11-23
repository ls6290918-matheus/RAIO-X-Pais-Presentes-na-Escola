import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Bike, Home, Plus, Search, ShieldCheck, Store } from "lucide-react";
import { Alert, Card, PageHeader, buttonClass, cn } from "@/components/shared/ui";
import { SimpleLayout } from "@/components/layout/SimpleLayout";
import { useAuth } from "@/contexts/AuthContext";
import { useBusiness } from "@/contexts/BusinessContext";
import { ROLE_LABEL, useRoles, type RoleStatus, type UserRole } from "@/contexts/RolesContext";
import { NotificationSettings } from "@/features/settings/NotificationSettings";

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
  const navigate = useNavigate();
  const location = useLocation();
  // "Adicionar outro perfil" no menu da conta leva direto ao cartão
  useEffect(() => {
    if (location.hash === "#adicionar") window.setTimeout(() => document.getElementById("adicionar")?.scrollIntoView({ behavior: "smooth" }), 50);
  }, [location.hash]);

  /** Acrescenta o perfil e já leva para o cadastro dele (mesmas 4 entradas de /comecar). */
  async function add(key: string, role: "anunciante" | "prestador" | "entregador", to: string) {
    setBusy(key);
    setMsg(null);
    const err = await addRole(role);
    setBusy(null);
    if (err) return setMsg({ kind: "error", text: err });
    navigate(to);
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
        return (
          <div className="flex flex-wrap items-center gap-3">
            <p className="flex-1 text-sm text-grafite-500">
              {status === "pendente"
                ? "Seu cadastro está em análise pela administração. Complete veículo e municípios em Entregas."
                : "Cadastro aprovado. Veja as corridas da sua região."}
            </p>
            <Link to="/entregas" className={buttonClass()}>
              Abrir entregas
            </Link>
          </div>
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

  const addOptions = [
    { key: "contratar", role: "anunciante" as const, title: "Contratar serviços", text: "Pedir lavagens e receber propostas.", icon: <Search className="h-4 w-4" />, to: "/cliente" },
    { key: "casa", role: "prestador" as const, title: "Trabalhar de casa", text: "Oferecer lavagens sem precisar de loja nem CNPJ.", icon: <Home className="h-4 w-4" />, to: "/onboarding?perfil=casa" },
    { key: "lavanderia", role: "prestador" as const, title: "Lavanderia ou empresa", text: "Receber pedidos e organizar a operação.", icon: <Store className="h-4 w-4" />, to: "/onboarding?perfil=lavanderia" },
    { key: "entregas", role: "entregador" as const, title: "Trabalhar com entregas", text: "Coletas e devoluções; passa por aprovação.", icon: <Bike className="h-4 w-4" />, to: "/entregas" },
  ].filter((o) => !statusOf(o.role));
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

        {addOptions.length > 0 && (
          <div id="adicionar" className="scroll-mt-20" data-testid="add-profile">
          <Card className="p-5">
            <h2 className="text-base font-semibold text-petroleo">Acrescentar perfil</h2>
            <p className="mt-1 text-sm text-grafite-500">Uma mesma conta pode contratar, trabalhar de casa ou com uma lavanderia e fazer entregas.</p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {addOptions.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void add(o.key, o.role, o.to)}
                  className={cn(
                    "flex items-start gap-3 rounded-2xl border border-grafite/10 p-4 text-left transition hover:border-agua disabled:opacity-60",
                    busy === o.key && "animate-pulse",
                  )}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-agua-50 text-petroleo">{o.icon}</span>
                  <span>
                    <span className="flex items-center gap-1 text-sm font-semibold text-petroleo">
                      <Plus className="h-3.5 w-3.5" aria-hidden /> {o.title}
                    </span>
                    <span className="mt-0.5 block text-xs text-grafite-500">{o.text}</span>
                  </span>
                </button>
              ))}
            </div>
          </Card>
          </div>
        )}
        {roles.length > 0 && <NotificationSettings />}
      </div>
    </SimpleLayout>
  );
}
