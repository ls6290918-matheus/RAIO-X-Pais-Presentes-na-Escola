import { useState, type ReactNode } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Bike, Home, Search, Store } from "lucide-react";
import { Alert, Card, FullScreenLoader, Logo, cn } from "@/components/shared/ui";
import { useRoles, type UserRole } from "@/contexts/RolesContext";
import { useBusiness } from "@/contexts/BusinessContext";
import { pendingInvite } from "@/lib/invite";

type Choice = { key: string; role: Exclude<UserRole, "admin">; title: string; text: string; icon: ReactNode; to: string };

/** As 4 entradas do PRD Mestre. "Trabalhar de casa" e "lavanderia" são o mesmo perfil (prestador) com caminhos diferentes. */
const CHOICES: Choice[] = [
  {
    key: "contratar",
    role: "anunciante",
    title: "Quero contratar um serviço",
    text: "Encontrar quem lave tênis, roupas, edredons, tapetes, sofás e mais, perto de você.",
    icon: <Search className="h-6 w-6" />,
    to: "/cliente",
  },
  {
    key: "casa",
    role: "prestador",
    title: "Quero trabalhar de casa",
    text: "Lavar e cuidar de peças na minha casa e ganhar dinheiro. Não precisa de CNPJ nem de loja.",
    icon: <Home className="h-6 w-6" />,
    to: "/onboarding?perfil=casa",
  },
  {
    key: "lavanderia",
    role: "prestador",
    title: "Tenho uma lavanderia ou empresa",
    text: "Receber pedidos de novos clientes e organizar pedidos, equipe e entregas.",
    icon: <Store className="h-6 w-6" />,
    to: "/onboarding?perfil=lavanderia",
  },
  {
    key: "entregas",
    role: "entregador",
    title: "Quero trabalhar com entregas",
    text: "Fazer coletas e devoluções de bicicleta, moto ou carro. O cadastro passa por aprovação.",
    icon: <Bike className="h-6 w-6" />,
    to: "/entregas",
  },
];

/** /comecar — primeira escolha de quem acabou de criar a conta. Dá para acrescentar outros perfis depois. */
export default function StartPage() {
  const navigate = useNavigate();
  const { roles, loading, addRole } = useRoles();
  const { business, loading: bizLoading } = useBusiness();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (loading || bizLoading) return <FullScreenLoader />;
  const invite = pendingInvite();
  if (invite) return <Navigate to={`/convite/${invite}`} replace />;
  if (business) return <Navigate to="/app" replace />;
  if (roles.length > 0) return <Navigate to="/conta" replace />;

  async function choose(c: Choice) {
    setBusy(c.key);
    setError(null);
    const err = await addRole(c.role);
    setBusy(null);
    if (err) return setError(err);
    navigate(c.to, { replace: true });
  }

  return (
    <div className="min-h-screen bg-nevoa px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8">
          <Logo />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-petroleo">O que você deseja fazer no Limpa Aqui?</h1>
        <p className="mt-1 text-sm text-grafite-500">Escolha um para começar. Depois você pode acrescentar outros na sua conta.</p>
        {error && (
          <div className="mt-4">
            <Alert>{error}</Alert>
          </div>
        )}
        <div className="mt-6 grid gap-3 sm:grid-cols-2" data-testid="start-choices">
          {CHOICES.map((c) => (
            <button
              key={c.key}
              type="button"
              disabled={busy !== null}
              onClick={() => void choose(c)}
              className={cn("text-left transition disabled:opacity-60", busy === c.key && "animate-pulse")}
            >
              <Card className="flex h-full items-start gap-4 p-5 hover:border-agua">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-agua-50 text-petroleo">{c.icon}</span>
                <span>
                  <span className="block text-base font-semibold text-petroleo">{c.title}</span>
                  <span className="mt-1 block text-sm text-grafite-500">{c.text}</span>
                </span>
              </Card>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
