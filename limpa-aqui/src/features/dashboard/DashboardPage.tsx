import { Link } from "react-router-dom";
import { CheckCircle2, Circle, Globe, PackagePlus, Receipt, Sparkles, UserPlus, type LucideIcon } from "lucide-react";
import { Card, cn } from "@/components/shared/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useBusiness } from "@/contexts/BusinessContext";
import { PUBLIC_DOMAIN, TIMEZONE } from "@/lib/format";

type Shortcut = { label: string; icon: LucideIcon; to?: string };

// Os atalhos ficam ativos conforme cada módulo for entregue (Etapas 2 a 6).
const SHORTCUTS: Shortcut[] = [
  { label: "Novo pedido", icon: PackagePlus },
  { label: "Novo cliente", icon: UserPlus },
  { label: "Cadastrar serviço", icon: Sparkles },
  { label: "Registrar pagamento", icon: Receipt },
];

function greeting() {
  const hour = Number(
    new Intl.DateTimeFormat("pt-BR", { hour: "numeric", hour12: false, timeZone: TIMEZONE }).format(new Date()),
  );
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { business } = useBusiness();
  const firstName = String(user?.user_metadata?.full_name ?? "").split(" ")[0];

  const steps = [
    { label: "Cadastrar sua lavanderia", done: true },
    { label: "Cadastrar seus serviços e preços", done: false },
    { label: "Cadastrar seus clientes", done: false },
    { label: "Criar o primeiro pedido", done: false },
    { label: "Publicar sua página", done: false },
  ];
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-petroleo">
          {greeting()}
          {firstName ? `, ${firstName}` : ""}
        </h1>
        <p className="mt-1 text-sm text-grafite-500">Este é o painel da {business?.name}.</p>
      </div>

      <section aria-labelledby="atalhos" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <h2 id="atalhos" className="sr-only">
          Atalhos
        </h2>
        {SHORTCUTS.map(({ label, icon: Icon, to }) => {
          const inner = (
            <>
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-agua-50 text-petroleo">
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <span className="text-sm font-semibold text-petroleo">{label}</span>
              {!to && <span className="text-[11px] font-medium text-grafite-500">Em breve</span>}
            </>
          );
          const base = "flex flex-col items-start gap-2.5 rounded-2xl border border-grafite/5 bg-white p-4 shadow-card";
          return to ? (
            <Link key={label} to={to} className={cn(base, "transition hover:-translate-y-0.5")}>
              {inner}
            </Link>
          ) : (
            <div key={label} className={cn(base, "cursor-not-allowed opacity-60")} aria-disabled="true">
              {inner}
            </div>
          );
        })}
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-petroleo">Primeiros passos</h2>
            <span className="text-sm text-grafite-500">
              {doneCount} de {steps.length}
            </span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-nevoa">
            <div className="h-full rounded-full bg-agua" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
          </div>
          <ul className="mt-5 space-y-3">
            {steps.map((s) => (
              <li key={s.label} className="flex items-center gap-3 text-sm">
                {s.done ? (
                  <CheckCircle2 className="h-5 w-5 text-agua-600" aria-hidden />
                ) : (
                  <Circle className="h-5 w-5 text-grafite-300" aria-hidden />
                )}
                <span className={s.done ? "text-grafite-500 line-through" : "text-grafite"}>{s.label}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="p-6">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-petroleo text-agua">
              <Globe className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-petroleo">Sua página pública</h2>
              <p className="truncate text-sm text-grafite-500">
                {PUBLIC_DOMAIN}/{business?.slug}
              </p>
            </div>
          </div>
          <p className="mt-4 text-sm text-grafite-500">
            Seus serviços, preços e o botão de WhatsApp vão aparecer aqui. A página fica disponível depois que você
            cadastrar os serviços e publicá-la.
          </p>
        </Card>
      </div>

      <Card className="p-6">
        <h2 className="text-base font-semibold text-petroleo">Indicadores</h2>
        <p className="mt-1 text-sm text-grafite-500">
          Faturamento, valores recebidos e pendentes, pedidos e ticket médio aparecem aqui assim que você registrar os
          primeiros pedidos.
        </p>
      </Card>
    </div>
  );
}
