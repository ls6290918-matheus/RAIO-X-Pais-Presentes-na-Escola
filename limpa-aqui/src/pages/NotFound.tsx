import { Link } from "react-router-dom";
import { Logo } from "@/components/shared/ui";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-nevoa px-6 text-center">
      <Logo />
      <div>
        <h1 className="text-2xl font-semibold text-petroleo">Página não encontrada</h1>
        <p className="mt-1 text-sm text-grafite-500">O endereço que você acessou não existe ou foi removido.</p>
      </div>
      <Link to="/" className="text-sm font-semibold text-petroleo hover:underline">
        Ir para o início
      </Link>
    </div>
  );
}
