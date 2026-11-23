// Notificações deste aparelho e preferências da conta (via RPCs do banco; tokens nunca são lidos de volta).
import { supabase } from "@/lib/supabase";
import { currentPlatform, deviceId, deviceName } from "@/lib/platform";
import { pushProvider, type PushState } from "@/lib/platform/push";

export type PrefCategory = "pedidos" | "mensagens" | "pagamentos" | "avaliacoes" | "logistica" | "marketing";
export type Preference = { category: PrefCategory; push: boolean; email: boolean };
export type Device = { device_id: string; platform: string; device_name: string | null; is_active: boolean; last_seen_at: string };

export const CATEGORY_LABEL: Record<PrefCategory, { title: string; hint: string }> = {
  pedidos: { title: "Pedidos", hint: "Novo pedido, propostas, andamento, cancelamento e disputas" },
  mensagens: { title: "Mensagens", hint: "Mensagens novas no chat" },
  pagamentos: { title: "Pagamentos", hint: "Pix confirmado, repasses e plano" },
  avaliacoes: { title: "Avaliações", hint: "Avaliação recebida" },
  logistica: { title: "Entregas", hint: "Corridas, coleta e devolução" },
  marketing: { title: "Novidades e ofertas", hint: "Cupons e novidades do Limpa Aqui" },
};

const ENABLED_KEY = "limpaaqui.push-enabled";
const remember = (on: boolean) => {
  try {
    if (on) localStorage.setItem(ENABLED_KEY, "1");
    else localStorage.removeItem(ENABLED_KEY);
  } catch { /* sem armazenamento local */ }
};
const remembered = () => {
  try {
    return localStorage.getItem(ENABLED_KEY) === "1";
  } catch {
    return false;
  }
};

export const pushState = (): Promise<PushState> => pushProvider().state();

async function register(token: string) {
  const { error } = await supabase.rpc("register_device", {
    p_device_id: deviceId(), p_platform: currentPlatform(), p_token: token, p_device_name: deviceName(),
  });
  if (error) throw error;
}

/** Ativa o push neste aparelho (pede a permissão do sistema). */
export async function enablePushHere() {
  const token = await pushProvider().enable();
  await register(token);
  remember(true);
}

/** Desativa o push neste aparelho. */
export async function disablePushHere() {
  remember(false);
  await supabase.rpc("unregister_device", { p_device_id: deviceId() });
  await pushProvider().disable();
}

/** Ao abrir o app logado: renova o token (o FCM troca de tempos em tempos) sem perguntar nada. */
export async function refreshPushRegistration() {
  if (!remembered()) return;
  const token = await pushProvider().currentToken();
  if (token) await register(token).catch(() => undefined);
}

export async function loadPreferences(): Promise<Preference[]> {
  const { data, error } = await supabase.rpc("my_notification_preferences");
  if (error) throw error;
  return (data as Preference[]) ?? [];
}

export async function savePreference(p: Preference) {
  const { error } = await supabase.rpc("set_notification_preference", { p_category: p.category, p_push: p.push, p_email: p.email });
  if (error) throw error;
}

export async function loadDevices(): Promise<Device[]> {
  const { data } = await supabase.rpc("my_devices");
  return (data as Device[]) ?? [];
}

export const isThisDevice = (d: Device) => d.device_id === deviceId();
