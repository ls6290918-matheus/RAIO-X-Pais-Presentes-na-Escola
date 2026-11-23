import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, Smartphone } from "lucide-react";
import { Alert, Button, Card, cn } from "@/components/shared/ui";
import { friendlyError } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import type { PushState } from "@/lib/platform/push";
import {
  CATEGORY_LABEL, disablePushHere, enablePushHere, isThisDevice, loadDevices, loadPreferences, pushState, savePreference,
  type Device, type Preference,
} from "@/lib/notifications";

function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn("relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-50", checked ? "bg-agua" : "bg-grafite/20")}
    >
      <span className={cn("inline-block h-5 w-5 rounded-full bg-white shadow transition", checked ? "translate-x-[22px]" : "translate-x-0.5")} />
    </button>
  );
}

const STATE_TEXT: Record<PushState, string> = {
  unsupported: "Este navegador não recebe notificações. Use o Chrome, o Edge ou o Firefox, ou instale o app.",
  not_configured: "As notificações no celular ainda estão sendo configuradas pela equipe do Limpa Aqui.",
  ios_needs_install: "No iPhone, toque em Compartilhar → Adicionar à Tela de Início e abra o Limpa Aqui por lá para receber notificações.",
  denied: "As notificações estão bloqueadas para este site. Libere nas configurações do navegador e tente de novo.",
  default: "Receba avisos de pedidos, mensagens e entregas mesmo com o app fechado.",
  granted: "Receba avisos de pedidos, mensagens e entregas mesmo com o app fechado.",
};

/** Notificações: ativar neste aparelho, escolher o que receber e ver os aparelhos da conta. */
export function NotificationSettings({ compact = false, only }: { compact?: boolean; only?: Array<Preference["category"]> }) {
  const [state, setState] = useState<PushState | null>(null);
  const [prefs, setPrefs] = useState<Preference[] | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  const load = useCallback(async () => {
    const [st, pr, dv] = await Promise.all([pushState().catch(() => "unsupported" as PushState), loadPreferences().catch(() => []), loadDevices()]);
    setState(st);
    setPrefs(pr);
    setDevices(dv);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const here = devices.find(isThisDevice);
  const activeHere = !!here?.is_active && state === "granted";

  async function toggleHere() {
    setBusy(true);
    setMsg(null);
    try {
      if (activeHere) {
        await disablePushHere();
        setMsg({ kind: "success", text: "Notificações desativadas neste aparelho." });
      } else {
        await enablePushHere();
        setMsg({ kind: "success", text: "Pronto! Este aparelho vai receber as notificações do Limpa Aqui." });
      }
    } catch (e) {
      const code = (e as Error).message;
      setMsg({ kind: "error", text: code in STATE_TEXT ? STATE_TEXT[code as PushState] : friendlyError(e) });
    } finally {
      setBusy(false);
      await load();
    }
  }

  async function change(p: Preference) {
    setPrefs((list) => list?.map((x) => (x.category === p.category ? p : x)) ?? null);
    try {
      await savePreference(p);
    } catch (e) {
      setMsg({ kind: "error", text: friendlyError(e) });
      await load();
    }
  }

  const canEnable = state === "default" || state === "granted";
  const shown = (prefs ?? []).filter((p) => !only || only.includes(p.category));

  return (
    <Card className="space-y-4 p-5" data-testid="notification-settings">
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-agua-50 text-petroleo">
          {activeHere ? <Bell className="h-5 w-5" aria-hidden /> : <BellOff className="h-5 w-5" aria-hidden />}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-petroleo">Notificações</h2>
          <p className="text-sm text-grafite-500" data-testid="push-state">
            {state === null ? "Verificando este aparelho…" : activeHere ? "Ativas neste aparelho." : STATE_TEXT[state]}
          </p>
        </div>
        {canEnable && (
          <Button variant={activeHere ? "outline" : "primary"} className="h-10" loading={busy} onClick={() => void toggleHere()} data-testid="push-toggle">
            {activeHere ? "Desativar aqui" : "Ativar neste aparelho"}
          </Button>
        )}
      </div>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      {!compact && prefs && (
        <div>
          <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 gap-y-3 text-sm" data-testid="notification-prefs">
            <span className="text-[11px] font-semibold uppercase text-grafite-500">O que receber</span>
            <span className="text-[11px] font-semibold uppercase text-grafite-500">Celular</span>
            <span className="text-[11px] font-semibold uppercase text-grafite-500">E-mail</span>
            {shown.map((p) => (
              <div key={p.category} className="contents">
                <div className="min-w-0">
                  <p className="font-medium text-grafite">{CATEGORY_LABEL[p.category].title}</p>
                  <p className="text-xs text-grafite-500">{CATEGORY_LABEL[p.category].hint}</p>
                </div>
                <Toggle checked={p.push} onChange={(v) => void change({ ...p, push: v })} label={`${CATEGORY_LABEL[p.category].title} no celular`} />
                <Toggle checked={p.email} onChange={(v) => void change({ ...p, email: v })} label={`${CATEGORY_LABEL[p.category].title} por e-mail`} />
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-grafite-500">
            Avisos importantes da conta e da administração sempre chegam. Os avisos continuam no sino do app, mesmo com as notificações desligadas.
          </p>
        </div>
      )}

      {!compact && devices.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold uppercase text-grafite-500">Seus aparelhos</p>
          <ul className="mt-2 space-y-1.5">
            {devices.map((d) => (
              <li key={d.device_id} className="flex items-center gap-2 text-xs text-grafite-500">
                <Smartphone className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="flex-1 text-grafite">
                  {d.device_name ?? d.platform}
                  {isThisDevice(d) && " (este)"}
                </span>
                <span>{d.is_active ? `ativo · ${formatDateTime(d.last_seen_at)}` : "desativado"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
