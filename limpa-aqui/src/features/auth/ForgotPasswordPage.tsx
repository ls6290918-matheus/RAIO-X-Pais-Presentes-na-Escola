import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { Alert, Button, Field, Input } from "@/components/shared/ui";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { fieldErrors, forgotSchema } from "./schemas";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = forgotSchema.safeParse({ email });
    if (!parsed.success) return setFieldError(fieldErrors(parsed.error).email);
    setFieldError(undefined);
    setLoading(true);
    const { error: err } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
      redirectTo: `${window.location.origin}/redefinir-senha`,
    });
    setLoading(false);
    if (err) return setError(friendlyError(err));
    setSent(true); // mesma resposta exista ou não a conta, para não revelar e-mails cadastrados
  }

  return (
    <AuthLayout title="Recuperar senha" subtitle="Enviaremos um link para você criar uma nova senha.">
      {sent ? (
        <div className="space-y-5">
          <Alert kind="success">
            Se houver uma conta com <strong>{email}</strong>, você receberá um e-mail com o link em instantes.
          </Alert>
          <Link to="/login" className="inline-block text-sm font-semibold text-petroleo hover:underline">
            Voltar para o login
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-5" noValidate>
          {error && <Alert>{error}</Alert>}
          <Field label="E-mail" htmlFor="email" error={fieldError}>
            <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} invalid={!!fieldError} />
          </Field>
          <Button type="submit" block loading={loading}>
            Enviar link
          </Button>
          <p className="text-center text-sm">
            <Link to="/login" className="font-semibold text-petroleo hover:underline">
              Voltar para o login
            </Link>
          </p>
        </form>
      )}
    </AuthLayout>
  );
}
