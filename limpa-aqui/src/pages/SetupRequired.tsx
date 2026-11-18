import { Logo } from "@/components/shared/ui";

/** Exibida quando as variáveis do Supabase não foram configuradas no .env */
export default function SetupRequired() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-nevoa px-6">
      <div className="max-w-md space-y-4 rounded-2xl bg-white p-8 shadow-card">
        <Logo />
        <h1 className="text-lg font-semibold text-petroleo">Configuração pendente</h1>
        <p className="text-sm text-grafite">
          Crie o arquivo <code className="rounded bg-nevoa px-1">.env</code> a partir do{" "}
          <code className="rounded bg-nevoa px-1">.env.example</code> com a URL e a chave anon do seu projeto Supabase
          e reinicie o servidor.
        </p>
      </div>
    </div>
  );
}
