import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Logo } from "@/components/shared/ui";
import { UserMenu } from "@/components/layout/AppLayout";

/** Layout das áreas fora do painel da lavanderia (minha conta, administração). */
export function SimpleLayout({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-screen bg-nevoa">
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-grafite/5 bg-white/85 px-4 backdrop-blur sm:px-6">
        <Link to="/conta" aria-label="Início">
          <Logo />
        </Link>
        <UserMenu />
      </header>
      <main className={`mx-auto px-4 py-6 sm:px-6 sm:py-8 ${wide ? "max-w-6xl" : "max-w-3xl"}`}>{children}</main>
    </div>
  );
}
