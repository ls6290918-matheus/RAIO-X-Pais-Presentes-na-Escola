import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { refreshPushRegistration } from "@/lib/notifications";

/** Ao entrar no app: renova em silêncio o registro do aparelho (o token do FCM muda de tempos em tempos). */
export function PushBootstrap() {
  const { user } = useAuth();
  useEffect(() => {
    if (!user) return;
    const t = window.setTimeout(() => void refreshPushRegistration().catch(() => undefined), 3000);
    return () => window.clearTimeout(t);
  }, [user]);
  return null;
}
