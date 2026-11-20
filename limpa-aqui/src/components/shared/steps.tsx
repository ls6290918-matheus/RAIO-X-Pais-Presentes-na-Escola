import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Logo, cn } from "./ui";

/**
 * Moldura de fluxo em passos (cadastro, escolha de perfil, localização):
 * topo com voltar, título curto e barra de progresso; conteúdo com uma pergunta por tela;
 * ação principal fixa no rodapé no celular.
 */
export function StepScreen({
  label,
  step,
  total,
  onBack,
  action,
  children,
  testId,
}: {
  label: string;
  step?: number;
  total?: number;
  onBack?: () => void;
  action?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  const pct = step && total ? Math.round((step / total) * 100) : null;
  return (
    <div className="flex min-h-[100dvh] flex-col bg-white sm:bg-nevoa" data-testid={testId}>
      <header className="sticky top-0 z-10 bg-white sm:bg-transparent">
        <div className="mx-auto flex h-14 w-full max-w-lg items-center gap-2 px-2 sm:px-0">
          {onBack ? (
            <button type="button" onClick={onBack} className="flex h-10 w-10 items-center justify-center rounded-full text-petroleo hover:bg-nevoa" aria-label="Voltar">
              <ArrowLeft className="h-5 w-5" />
            </button>
          ) : (
            <span className="pl-2">
              <Logo />
            </span>
          )}
          <p className="flex-1 text-center text-xs font-semibold uppercase tracking-wider text-grafite-500">{label}</p>
          <span className="w-10" aria-hidden />
        </div>
        {pct !== null && (
          <div className="mx-auto h-1 w-full max-w-lg bg-grafite/5 sm:rounded-full" role="progressbar" aria-valuenow={step} aria-valuemin={1} aria-valuemax={total} aria-label={`Passo ${step} de ${total}`}>
            <div className="h-1 rounded-full bg-agua transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>
        )}
      </header>
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col px-5 pb-32 pt-6 sm:mt-6 sm:flex-none sm:rounded-3xl sm:bg-white sm:p-8 sm:pb-8 sm:shadow-card">
        {children}
        {action && <div className="mt-8 hidden sm:block">{action}</div>}
      </main>
      {action && (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-grafite/5 bg-white px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:hidden">{action}</div>
      )}
    </div>
  );
}

/** Título e apoio de cada passo ("Qual é o seu e-mail?"). */
export function StepTitle({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="text-[22px] font-semibold leading-snug tracking-tight text-petroleo">{title}</h1>
      {subtitle && <p className="mt-1.5 text-sm text-grafite-500">{subtitle}</p>}
    </div>
  );
}

/** Bloco cinza animado enquanto carrega. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-xl bg-grafite/[0.07]", className)} aria-hidden />;
}
