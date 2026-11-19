import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Alert, Button, Modal } from "@/components/shared/ui";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { TERMS_VERSION } from "@/lib/legal";

/** Quem já tinha conta (ou quando os textos mudam) aceita a versão atual dos Termos e da Política uma vez, ao entrar. */
export function TermsGate() {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const [pending, setPending] = useState(false);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return setPending(false);
    void supabase
      .from("profiles")
      .select("terms_version")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data, error: err }) => setPending(!err && Boolean(data) && data?.terms_version !== TERMS_VERSION));
  }, [user]);

  if (!pending || ["/termos", "/privacidade"].includes(location.pathname)) return null;

  async function accept() {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.rpc("accept_terms", { p_version: TERMS_VERSION });
    setBusy(false);
    if (err) return setError(friendlyError(err));
    setPending(false);
  }

  return (
    <Modal open title="Termos de Uso e Privacidade" onClose={() => undefined}>
      <div className="space-y-4" data-testid="terms-gate">
        <p className="text-sm text-grafite">
          Publicamos os Termos de Uso e a Política de Privacidade do Limpa Aqui, que explicam como funcionam pedidos, pagamentos, repasses, planos e como cuidamos dos seus
          dados. Para continuar, leia e aceite.
        </p>
        {error && <Alert>{error}</Alert>}
        <label className="flex items-start gap-3 text-sm text-grafite">
          <input type="checkbox" className="mt-1 accent-agua" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          <span>
            Li e aceito os{" "}
            <Link to="/termos" target="_blank" className="font-semibold text-petroleo hover:underline">
              Termos de Uso
            </Link>{" "}
            e a{" "}
            <Link to="/privacidade" target="_blank" className="font-semibold text-petroleo hover:underline">
              Política de Privacidade
            </Link>
            .
          </span>
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => void signOut()}>
            Sair
          </Button>
          <Button loading={busy} disabled={!checked} onClick={() => void accept()}>
            Aceitar e continuar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
