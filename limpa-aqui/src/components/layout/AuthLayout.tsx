import type { ReactNode } from "react";
import { ClipboardList, Link2, Wallet } from "lucide-react";
import { Logo } from "@/components/shared/ui";

const highlights = [
  { icon: ClipboardList, text: "Pedidos com vários pares, fotos e status em um só lugar" },
  { icon: Link2, text: "Link de acompanhamento para o seu cliente, sem cadastro" },
  { icon: Wallet, text: "Recebido, pendente e faturado sempre separados" },
];

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="grid min-h-screen bg-nevoa lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-petroleo p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-agua/10 blur-3xl"
          aria-hidden
        />
        <Logo light />
        <div className="relative max-w-md">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">
            Sua lavanderia mais organizada.
            <br />
            <span className="text-agua">Seu negócio em outro nível.</span>
          </h2>
          <ul className="mt-8 space-y-4">
            {highlights.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3 text-sm text-white/80">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-agua">
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <span className="pt-1.5">{text}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-white/40">© {new Date().getFullYear()} Limpa Aqui</p>
      </aside>

      <main className="flex items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-petroleo">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-grafite-500">{subtitle}</p>}
          <div className="mt-7">{children}</div>
        </div>
      </main>
    </div>
  );
}
