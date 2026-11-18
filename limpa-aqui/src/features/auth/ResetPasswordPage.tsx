import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { Alert, Button, Field, FullScreenLoader, Input } from "@/components/shared/ui";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { fieldErrors, resetSchema } from "./schemas";

export default function ResetPasswordPage() {
  const { session, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ password: "", confirm: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (authLoading) return <FullScreenLoader />;

  // O link do e-mail cria uma sessão temporária de recuperação. Sem ela, o link expirou.
  if (!session) {
    return (
      <AuthLayout title="Link inválido ou expirado">
        <div className="space-y-5">
          <p className="text-sm text-grafite">Peça um novo link de recuperação para redefinir sua senha.</p>
          <Link to="/recuperar-senha" className="inline-block text-sm font-semibold text-petroleo hover:underline">
            Solicitar novo link
          </Link>
        </div>
      </AuthLayout>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = resetSchema.safeParse(form);
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    setLoading(true);
    const { error: err } = await supabase.auth.updateUser({ password: parsed.data.password });
    setLoading(false);
    if (err) return setError(friendlyError(err));
    navigate("/app", { replace: true });
  }

  return (
    <AuthLayout title="Nova senha" subtitle="Escolha uma senha nova para sua conta.">
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        {error && <Alert>{error}</Alert>}
        <Field label="Nova senha" htmlFor="password" error={errors.password} hint="Mínimo de 8 caracteres.">
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            invalid={!!errors.password}
          />
        </Field>
        <Field label="Confirmar nova senha" htmlFor="confirm" error={errors.confirm}>
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            value={form.confirm}
            onChange={(e) => setForm((f) => ({ ...f, confirm: e.target.value }))}
            invalid={!!errors.confirm}
          />
        </Field>
        <Button type="submit" block loading={loading}>
          Salvar nova senha
        </Button>
      </form>
    </AuthLayout>
  );
}
