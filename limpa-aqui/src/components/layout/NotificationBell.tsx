import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";
import { cn } from "@/components/shared/ui";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

type Notice = { id: string; kind: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string };

function ago(iso: string) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? "ontem" : `há ${d} dias`;
}

/** Sininho com os avisos da conta (pedido novo, Pix confirmado, situação do pedido, propostas, corridas, repasses). */
export function NotificationBell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notice[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const unread = items.filter((n) => !n.read_at).length;

  const load = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("notifications")
      .select("id, kind, title, body, link, read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(30);
    setItems((data as Notice[]) ?? []);
  }, [user]);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 60000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  async function openItem(n: Notice) {
    setOpen(false);
    if (!n.read_at) {
      setItems((list) => list.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
      await supabase.rpc("mark_notifications_read", { p_ids: [n.id] });
    }
    if (n.link) navigate(n.link);
  }

  async function readAll() {
    setItems((list) => list.map((x) => ({ ...x, read_at: x.read_at ?? new Date().toISOString() })));
    await supabase.rpc("mark_notifications_read", { p_ids: null });
  }

  if (!user) return null;
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => {
          setOpen((o) => !o);
          if (!open) void load();
        }}
        className="relative flex h-10 w-10 items-center justify-center rounded-xl text-grafite hover:bg-nevoa"
        aria-label={unread ? `Avisos: ${unread} não lidos` : "Avisos"}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="bell"
      >
        <Bell className="h-5 w-5" aria-hidden />
        {unread > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white" data-testid="bell-count">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div role="menu" className="fixed inset-x-4 top-16 z-40 overflow-hidden rounded-2xl border border-grafite/10 bg-white shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-[22rem]" data-testid="bell-menu">
          <div className="flex items-center justify-between border-b border-grafite/5 px-4 py-3">
            <p className="text-sm font-semibold text-petroleo">Avisos</p>
            {unread > 0 && (
              <button className="text-xs font-semibold text-petroleo hover:underline" onClick={() => void readAll()}>
                Marcar todos como lidos
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-grafite-500">Nenhum aviso por enquanto.</p>
          ) : (
            <ul className="max-h-96 divide-y divide-grafite/5 overflow-y-auto">
              {items.map((n) => (
                <li key={n.id}>
                  <button role="menuitem" onClick={() => void openItem(n)} className={cn("flex w-full gap-3 px-4 py-3 text-left hover:bg-nevoa", !n.read_at && "bg-agua-50/50")}>
                    <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-agua-600")} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-grafite">{n.title}</span>
                      {n.body && <span className="block text-xs text-grafite-500">{n.body}</span>}
                      <span className="mt-0.5 block text-[11px] text-grafite-500">{ago(n.created_at)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
