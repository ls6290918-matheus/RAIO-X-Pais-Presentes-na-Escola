import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { Alert, Button, Field, Input } from "@/components/shared/ui";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { fieldErrors, loginSchema } from "./schemas";

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/app";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword(parsed.data);
    setLoading(false);
    if (error) return setFormError(friendlyError(error));
    navigate(from, { replace: true });
  }

  return (
    <AuthLayout title="Entrar" subtitle="Acesse o painel da sua lavanderia.">
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        {formError && <Alert>{formError}</Alert>}
        <Field label="E-mail" htmlFor="email" error={errors.email}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="voce@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            invalid={!!errors.email}
          />
        </Field>
        <Field label="Senha" htmlFor="password" error={errors.password}>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            invalid={!!errors.password}
          />
        </Field>
        <div className="flex justify-end">
          <Link to="/recuperar-senha" className="text-sm font-medium text-petroleo hover:underline">
            Esqueci minha senha
          </Link>
        </div>
        <Button type="submit" block loading={loading}>
          Entrar
        </Button>
        <p className="text-center text-sm text-grafite-500">
          Ainda não tem conta?{" "}
          <Link to="/cadastro" className="font-semibold text-petroleo hover:underline">
            Criar conta grátis
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}
