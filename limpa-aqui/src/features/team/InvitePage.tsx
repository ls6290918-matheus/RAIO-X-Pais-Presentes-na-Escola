import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Clock, UserPlus, XCircle } from "lucide-react";
import { Alert, Button, Card, FullScreenLoader, Logo, buttonClass, cn } from "@/components/shared/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useBusiness } from "@/contexts/BusinessContext";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { clearPendingInvite, savePendingInvite } from "@/lib/invite";

type Invite = { business_name: string; status: "valido" | "usado" | "expirado" | "cancelado"; expires_at: string };

const STATUS_TEXT: Record<Exclude<Invite["status"], "valido">, string> = {
  usado: "Este convite já foi usado.",
  expirado: "Este convite expirou. Peça um novo link para a lavanderia.",
  cancelado: "Este convite foi cancelado pela lavanderia.",
};

/** /convite/:token — a pessoa convidada aceita entrar na equipe da lavanderia. */
export default function InvitePage() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const { session, user, loading: authLoading, signOut } = useAuth();
  const { business, loading: bizLoading, refresh } = useBusiness();
  const [invite, setInvite] = useState<Invite | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    void supabase.rpc("get_invite", { p_token: token }).then(({ data, error: err }) => {
      if (err) setError(friendlyError(err));
      const row = (data as Invite[] | null)?.[0] ?? null;
      setInvite(row);
      if (row?.status === "valido") savePendingInvite(token);
      else clearPendingInvite();
    });
  }, [token]);

  async function accept() {
    setAccepting(true);
    setError(null);
    const { error: err } = await supabase.rpc("accept_invite", { p_token: token });
    if (err) {
      setAccepting(false);
      return setError(friendlyError(err));
    }
    clearPendingInvite();
    await refresh();
    navigate("/app", { replace: true, state: { joined: true } });
  }

  if (invite === undefined || authLoading || (session && bizLoading)) return <FullScreenLoader />;

  const firstName = String(user?.user_metadata?.full_name ?? "").split(" ")[0];

  let body;
  if (!invite) {
    body = (
      <Status icon={<XCircle className="h-6 w-6" />} title="Convite não encontrado" text="Confira se o link foi copiado inteiro ou peça um novo para a lavanderia." />
    );
  } else if (invite.status !== "valido") {
    body = <Status icon={<Clock className="h-6 w-6" />} title={invite.business_name} text={STATUS_TEXT[invite.status]} />;
  } else if (!session) {
    body = (
      <>
        <Status
          icon={<UserPlus className="h-6 w-6" />}
          title={`Você foi convidado para a equipe da ${invite.business_name}`}
          text="Crie sua conta ou entre para aceitar. Depois disso você já vê os pedidos, clientes e serviços da lavanderia."
        />
        <div className="mt-6 grid gap-2 sm:grid-cols-2">
          <Link to="/cadastro" className={buttonClass()}>
            Criar conta
          </Link>
          <Link to="/login" state={{ from: `/convite/${token}` }} className={buttonClass("outline")}>
            Já tenho conta
          </Link>
        </div>
        <p className="mt-4 text-center text-xs text-grafite-500">Convite válido até {formatDateTime(invite.expires_at)}.</p>
      </>
    );
  } else if (business) {
    body = (
      <>
        <Status
          icon={<UserPlus className="h-6 w-6" />}
          title={`Convite da ${invite.business_name}`}
          text={`Sua conta já faz parte da ${business.name}. Para aceitar este convite, entre com outra conta.`}
        />
        <div className="mt-6 grid gap-2 sm:grid-cols-2">
          <Link to="/app" className={buttonClass()} onClick={clearPendingInvite}>
            Ir para o meu painel
          </Link>
          <Button variant="outline" onClick={() => void signOut()}>
            Entrar com outra conta
          </Button>
        </div>
      </>
    );
  } else {
    body = (
      <>
        <Status
          icon={<UserPlus className="h-6 w-6" />}
          title={`${firstName ? `${firstName}, você` : "Você"} foi convidado para a equipe da ${invite.business_name}`}
          text="Ao aceitar, você passa a ver e cuidar dos pedidos, clientes e serviços da lavanderia. Configurações, preços e equipe ficam com o dono."
        />
        <Button className="mt-6" block loading={accepting} onClick={() => void accept()}>
          Aceitar convite
        </Button>
        <button type="button" onClick={() => void signOut()} className="mt-3 w-full text-center text-sm text-grafite-500 hover:text-petroleo">
          Não é você? Sair
        </button>
      </>
    );
  }

  return (
    <div className="min-h-screen bg-nevoa px-4 py-10">
      <div className="mx-auto max-w-md">
        <div className="mb-8">
          <Logo />
        </div>
        <Card className="p-6 sm:p-8">
          {error && (
            <div className="mb-4">
              <Alert>{error}</Alert>
            </div>
          )}
          {body}
        </Card>
      </div>
    </div>
  );
}

function Status({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="text-center">
      <span className={cn("mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-agua-50 text-petroleo")}>{icon}</span>
      <h1 className="mt-4 text-xl font-semibold tracking-tight text-petroleo">{title}</h1>
      <p className="mt-2 text-sm text-grafite-500">{text}</p>
    </div>
  );
}
