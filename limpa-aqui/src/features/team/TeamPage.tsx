import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Crown, Link2, MessageCircle, Trash2, UserPlus, Users } from "lucide-react";
import { Alert, Button, Card, Field, InlineLoader, Input, PageHeader, buttonClass, cn } from "@/components/shared/ui";
import { useBusiness } from "@/contexts/BusinessContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { formatDate, formatDateTime } from "@/lib/format";
import { inviteLink } from "@/lib/invite";

type Member = { member_id: string; user_id: string; role: "owner" | "staff"; full_name: string | null; email: string; joined_at: string };
type Invite = {
  id: string;
  token: string;
  name: string | null;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
};

const inviteStatus = (i: Invite) =>
  i.revoked_at ? "Cancelado" : i.accepted_at ? "Aceito" : new Date(i.expires_at) <= new Date() ? "Expirado" : "Aguardando";

/** /app/equipe — só o dono: convidar funcionários por link, ver e remover a equipe. */
export default function TeamPage() {
  const { business } = useBusiness();
  const { user } = useAuth();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<Invite | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!business) return;
    const [m, i] = await Promise.all([
      supabase.rpc("list_team", { p_business_id: business.id }),
      supabase
        .from("team_invites")
        .select("id, token, name, created_at, expires_at, accepted_at, revoked_at")
        .eq("business_id", business.id)
        .order("created_at", { ascending: false })
        .limit(30),
    ]);
    if (m.error) setMsg({ kind: "error", text: friendlyError(m.error) });
    setMembers((m.data as Member[]) ?? []);
    setInvites((i.data as Invite[]) ?? []);
  }, [business]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createInvite() {
    if (!business) return;
    if (name.trim().length === 1 || name.trim().length > 80) return setMsg({ kind: "error", text: "O nome precisa ter de 2 a 80 caracteres (ou ficar em branco)." });
    setBusy("create");
    setMsg(null);
    const { data, error } = await supabase.rpc("create_invite", { p_business_id: business.id, p_name: name.trim() || null });
    setBusy(null);
    if (error) return setMsg({ kind: "error", text: friendlyError(error) });
    const row = (data as Array<{ id: string; token: string; expires_at: string }>)[0];
    setCreated({ id: row.id, token: row.token, name: name.trim() || null, created_at: new Date().toISOString(), expires_at: row.expires_at, accepted_at: null, revoked_at: null });
    setName("");
    await load();
  }

  async function copy(token: string) {
    try {
      await navigator.clipboard.writeText(inviteLink(token));
      setCopied(token);
      setTimeout(() => setCopied(null), 2500);
    } catch {
      setMsg({ kind: "error", text: "Não foi possível copiar. Selecione o link e copie manualmente." });
    }
  }

  async function revoke(i: Invite) {
    if (!window.confirm("Cancelar este convite? O link deixa de funcionar.")) return;
    setBusy(i.id);
    const { error } = await supabase.rpc("revoke_invite", { p_invite_id: i.id });
    setBusy(null);
    if (error) return setMsg({ kind: "error", text: friendlyError(error) });
    if (created?.id === i.id) setCreated(null);
    await load();
  }

  async function remove(m: Member) {
    if (!window.confirm(`Remover ${m.full_name ?? m.email} da equipe? A pessoa perde o acesso à lavanderia na hora.`)) return;
    setBusy(m.member_id);
    const { error } = await supabase.rpc("remove_member", { p_member_id: m.member_id });
    setBusy(null);
    if (error) return setMsg({ kind: "error", text: friendlyError(error) });
    setMsg({ kind: "success", text: `${m.full_name ?? m.email} foi removido(a) da equipe.` });
    await load();
  }

  const waText = (token: string, who: string | null) =>
    `https://wa.me/?text=${encodeURIComponent(
      `Olá${who ? `, ${who}` : ""}! Este é o seu convite para a equipe da ${business?.name} no Limpa Aqui: ${inviteLink(token)} (vale por 7 dias).`,
    )}`;

  if (members === null) return <InlineLoader />;
  const pending = invites.filter((i) => inviteStatus(i) === "Aguardando");
  const history = invites.filter((i) => inviteStatus(i) !== "Aguardando").slice(0, 10);

  return (
    <div className="space-y-6">
      <PageHeader title="Equipe" description="Convide funcionários para usar o Limpa Aqui com você." />
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      <Card className="p-6">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-agua-50 text-petroleo">
            <UserPlus className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h2 className="text-base font-semibold text-petroleo">Convidar pessoa</h2>
            <p className="text-sm text-grafite-500">
              Gere um link e mande pelo WhatsApp. Ele vale por 7 dias e funciona uma única vez. Funcionários cuidam de pedidos, clientes e entregas;
              preços, configurações e equipe ficam com você.
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Field label="Nome de quem vai receber (opcional)" htmlFor="inv-name">
              <Input id="inv-name" placeholder="Ex.: Paula" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
            </Field>
          </div>
          <Button onClick={() => void createInvite()} loading={busy === "create"}>
            <Link2 className="h-4 w-4" aria-hidden /> Gerar link de convite
          </Button>
        </div>

        {created && (
          <div className="mt-5 rounded-xl border border-agua bg-agua-50/60 p-4">
            <p className="text-sm font-semibold text-petroleo">Convite criado{created.name ? ` para ${created.name}` : ""}</p>
            <p className="mt-1 break-all rounded-lg bg-white px-3 py-2 font-mono text-xs text-grafite" data-testid="invite-link">
              {inviteLink(created.token)}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a href={waText(created.token, created.name)} target="_blank" rel="noreferrer" className={cn(buttonClass("dark"), "h-10")}>
                <MessageCircle className="h-4 w-4" aria-hidden /> Enviar pelo WhatsApp
              </a>
              <Button variant="outline" className="h-10" onClick={() => void copy(created.token)}>
                {copied === created.token ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
                {copied === created.token ? "Copiado" : "Copiar link"}
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        <h2 className="flex items-center gap-2 px-6 pt-5 text-base font-semibold text-petroleo">
          <Users className="h-5 w-5" aria-hidden /> Pessoas com acesso ({members.length})
        </h2>
        <ul className="mt-3 divide-y divide-grafite/5">
          {members.map((m) => (
            <li key={m.member_id} className="flex items-center gap-3 px-6 py-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-petroleo text-xs font-semibold text-agua">
                {(m.full_name ?? m.email).trim()[0]?.toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate text-sm font-semibold text-grafite">
                  {m.full_name ?? m.email}
                  {m.user_id === user?.id && <span className="text-xs font-normal text-grafite-500">(você)</span>}
                </p>
                <p className="truncate text-xs text-grafite-500">
                  {m.email} · desde {formatDate(m.joined_at)}
                </p>
              </div>
              {m.role === "owner" ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-agua-50 px-2.5 py-1 text-xs font-semibold text-petroleo">
                  <Crown className="h-3.5 w-3.5" aria-hidden /> Dono
                </span>
              ) : (
                <>
                  <span className="rounded-full bg-nevoa px-2.5 py-1 text-xs font-semibold text-grafite-500">Funcionário</span>
                  <button
                    type="button"
                    disabled={busy === m.member_id}
                    onClick={() => void remove(m)}
                    className="rounded-lg p-2 text-grafite-500 hover:bg-red-50 hover:text-red-600"
                    aria-label={`Remover ${m.full_name ?? m.email}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      </Card>

      {(pending.length > 0 || history.length > 0) && (
        <Card className="overflow-hidden">
          <h2 className="px-6 pt-5 text-base font-semibold text-petroleo">Convites</h2>
          <ul className="mt-3 divide-y divide-grafite/5">
            {[...pending, ...history].map((i) => {
              const st = inviteStatus(i);
              return (
                <li key={i.id} className="flex flex-wrap items-center gap-3 px-6 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-grafite">{i.name ?? "Convite sem nome"}</p>
                    <p className="text-xs text-grafite-500">
                      Criado em {formatDateTime(i.created_at)}
                      {st === "Aguardando" && ` · vale até ${formatDateTime(i.expires_at)}`}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-1 text-xs font-semibold",
                      st === "Aguardando" ? "bg-amber-50 text-amber-700" : st === "Aceito" ? "bg-agua-50 text-petroleo" : "bg-nevoa text-grafite-500",
                    )}
                  >
                    {st}
                  </span>
                  {st === "Aguardando" && (
                    <div className="flex gap-1">
                      <button type="button" onClick={() => void copy(i.token)} className="rounded-lg p-2 text-grafite-500 hover:bg-nevoa" aria-label="Copiar link do convite">
                        {copied === i.token ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      </button>
                      <button
                        type="button"
                        disabled={busy === i.id}
                        onClick={() => void revoke(i)}
                        className="rounded-lg px-2 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50"
                      >
                        Cancelar
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
