import { useRef, useState, type ReactNode } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Bike, Check, Home, LocateFixed, MapPin, Search, Store } from "lucide-react";
import { Alert, Button, FullScreenLoader, cn } from "@/components/shared/ui";
import { StepScreen, StepTitle } from "@/components/shared/steps";
import { useRoles, type UserRole } from "@/contexts/RolesContext";
import { useBusiness } from "@/contexts/BusinessContext";
import { pendingInvite } from "@/lib/invite";
import { AddressModal } from "@/features/client/AddressModal";

type Choice = { key: string; role: Exclude<UserRole, "admin">; title: string; text: string; icon: ReactNode; to: string };

/** As 4 entradas do PRD Mestre. "Trabalhar de casa" e "lavanderia" são o mesmo perfil (prestador) com caminhos diferentes. */
const CHOICES: Choice[] = [
  {
    key: "contratar",
    role: "anunciante",
    title: "Quero contratar um serviço",
    text: "Lavar roupas, tênis, sapatos, tapetes, cortinas e mais, perto de você.",
    icon: <Search className="h-6 w-6" />,
    to: "/cliente",
  },
  {
    key: "casa",
    role: "prestador",
    title: "Quero trabalhar de casa",
    text: "Ganhar dinheiro lavando e cuidando de peças na minha casa. Não precisa de CNPJ nem de loja.",
    icon: <Home className="h-6 w-6" />,
    to: "/onboarding?perfil=casa",
  },
  {
    key: "lavanderia",
    role: "prestador",
    title: "Tenho uma lavanderia ou empresa",
    text: "Divulgar serviços e preços, receber pedidos e conquistar clientes.",
    icon: <Store className="h-6 w-6" />,
    to: "/onboarding?perfil=lavanderia",
  },
  {
    key: "entregas",
    role: "entregador",
    title: "Quero trabalhar com entregas",
    text: "Fazer coletas e devoluções de bicicleta, moto ou carro. Passa por aprovação.",
    icon: <Bike className="h-6 w-6" />,
    to: "/entregas",
  },
];

/** Para onde ir primeiro: quem precisa de cadastro mais longo vem antes; os outros perfis ficam em "Trocar de perfil". */
const PRIORITY = ["lavanderia", "casa", "entregas", "contratar"];

/** /comecar — escolha de um ou mais perfis e (para quem contrata) a localização. */
export default function StartPage() {
  const navigate = useNavigate();
  const { roles, loading, addRole } = useRoles();
  const { business, loading: bizLoading } = useBusiness();
  const [picked, setPicked] = useState<string[]>([]);
  const [phase, setPhase] = useState<"escolha" | "local">("escolha");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locMsg, setLocMsg] = useState<string | null>(null);
  const [addressOpen, setAddressOpen] = useState(false);
  const started = useRef(false);

  if (loading || bizLoading) return <FullScreenLoader />;
  const invite = pendingInvite();
  if (invite) return <Navigate to={`/convite/${invite}`} replace />;
  // quem já tem perfil e não está no meio deste fluxo vai para a conta
  if (!started.current && business) return <Navigate to="/app" replace />;
  if (!started.current && roles.length > 0) return <Navigate to="/conta" replace />;

  const first = () => CHOICES.find((c) => c.key === PRIORITY.find((k) => picked.includes(k)))!;

  function toggle(key: string) {
    setError(null);
    setPicked((p) => {
      if (p.includes(key)) return p.filter((k) => k !== key);
      // "de casa" e "lavanderia" são o mesmo perfil: fica um dos dois
      const other = key === "casa" ? "lavanderia" : key === "lavanderia" ? "casa" : null;
      return [...p.filter((k) => k !== other), key];
    });
  }

  async function confirm() {
    if (picked.length === 0) return setError("Escolha pelo menos uma opção.");
    started.current = true;
    setBusy(true);
    setError(null);
    const rolesToAdd = [...new Set(CHOICES.filter((c) => picked.includes(c.key)).map((c) => c.role))];
    for (const r of rolesToAdd) {
      const err = await addRole(r);
      if (err) {
        setBusy(false);
        return setError(err);
      }
    }
    setBusy(false);
    if (picked.includes("contratar")) setPhase("local");
    else navigate(first().to, { replace: true });
  }

  function askLocation() {
    if (!navigator.geolocation) return setLocMsg("Seu navegador não informa a localização. Cadastre pelo CEP.");
    setLocMsg("Pedindo permissão ao navegador…");
    navigator.geolocation.getCurrentPosition(
      () => navigate(first().to, { replace: true }),
      () => setLocMsg("Não foi possível usar a localização. Você pode cadastrar o endereço pelo CEP."),
      { timeout: 10000 },
    );
  }

  if (phase === "local")
    return (
      <StepScreen
        label="Sua localização"
        step={2}
        total={2}
        onBack={() => setPhase("escolha")}
        testId="start-location"
        action={
          <div className="space-y-2">
            <Button block onClick={askLocation} data-testid="loc-allow">
              <LocateFixed className="h-4 w-4" aria-hidden /> Usar minha localização
            </Button>
            <Button block variant="outline" onClick={() => setAddressOpen(true)}>
              <MapPin className="h-4 w-4" aria-hidden /> Cadastrar endereço pelo CEP
            </Button>
          </div>
        }
      >
        <div className="mx-auto mb-6 w-full max-w-xs rounded-2xl border border-grafite/10 bg-white p-4 shadow-card" aria-hidden>
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-agua-50 text-agua-600">
              <Store className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-petroleo">Lavanderia perto de você</p>
              <p className="text-xs text-grafite-500">Tênis · Roupas · a 1,2 km</p>
            </div>
          </div>
          <p className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-agua-600">Exemplo ilustrativo</p>
        </div>
        <StepTitle title="Ative sua localização" subtitle="Para mostrar quem lava e entrega na sua região. Você pode trocar o endereço quando quiser." />
        {locMsg && <p className="text-sm text-grafite-500" role="status">{locMsg}</p>}
        <button type="button" onClick={() => navigate(first().to, { replace: true })} className="mt-4 self-start text-sm font-semibold text-grafite-500 hover:underline" data-testid="loc-skip">
          Agora não
        </button>
        {addressOpen && (
          <AddressModal
            address={null}
            onClose={() => setAddressOpen(false)}
            onSaved={async () => {
              setAddressOpen(false);
              navigate(first().to, { replace: true });
            }}
          />
        )}
      </StepScreen>
    );

  return (
    <StepScreen
      label="Começar"
      step={picked.includes("contratar") ? 1 : undefined}
      total={picked.includes("contratar") ? 2 : undefined}
      testId="start-page"
      action={
        <Button block loading={busy} disabled={picked.length === 0} onClick={() => void confirm()} data-testid="start-continue">
          Continuar{picked.length > 1 ? ` com ${picked.length} perfis` : ""}
        </Button>
      }
    >
      <StepTitle title="O que você deseja fazer no Limpa Aqui?" subtitle="Marque uma ou mais opções. Dá para acrescentar outras depois, na sua conta." />
      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}
      <div className="grid gap-3" data-testid="start-choices">
        {CHOICES.map((c) => {
          const on = picked.includes(c.key);
          return (
            <button
              key={c.key}
              type="button"
              role="checkbox"
              aria-checked={on}
              disabled={busy}
              onClick={() => toggle(c.key)}
              className={cn(
                "flex items-start gap-4 rounded-2xl border-2 bg-white p-4 text-left transition disabled:opacity-60",
                on ? "border-agua bg-agua-50/50" : "border-grafite/10 hover:border-grafite/25",
              )}
            >
              <span className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl", on ? "bg-agua text-petroleo" : "bg-agua-50 text-petroleo")}>{c.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold text-petroleo">{c.title}</span>
                <span className="mt-0.5 block text-sm text-grafite-500">{c.text}</span>
              </span>
              <span className={cn("mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2", on ? "border-agua bg-agua text-petroleo" : "border-grafite/20")} aria-hidden>
                {on && <Check className="h-4 w-4" />}
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-4 text-xs text-grafite-500">"Trabalhar de casa" e "lavanderia" são o mesmo perfil de prestador: escolha o que mais combina com você.</p>
    </StepScreen>
  );
}
