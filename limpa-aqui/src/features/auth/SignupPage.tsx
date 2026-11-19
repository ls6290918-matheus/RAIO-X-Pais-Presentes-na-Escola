import { useState, type ChangeEvent, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { MailCheck } from "lucide-react";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { Alert, Button, Field, Input } from "@/components/shared/ui";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { fieldErrors, signupSchema } from "./schemas";
import { TERMS_VERSION } from "@/lib/legal";

export default function SignupPage() {
  const [form, setForm] = useState({ fullName: "", email: "", password: "", confirm: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);

  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const parsed = signupSchema.safeParse(form);
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    if (!accepted) return setErrors({ terms: "Para criar a conta, aceite os Termos de Uso e a Política de Privacidade." });
    setErrors({});
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        data: { full_name: parsed.data.fullName, terms_version: TERMS_VERSION },
        emailRedirectTo: `${window.location.origin}/onboarding`,
      },
    });
    setLoading(false);
    if (error) return setFormError(friendlyError(error));
    // Com confirmação de e-mail ativa, o Supabase devolve identities vazio quando o e-mail já existe
    if (data.user && data.user.identities && data.user.identities.length === 0) {
      return setFormError("Já existe uma conta com este e-mail. Tente entrar ou recuperar a senha.");
    }
    setSentTo(parsed.data.email);
  }

  if (sentTo) {
    return (
      <AuthLayout title="Confirme seu e-mail">
        <div className="space-y-5">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-agua-50 text-petroleo">
            <MailCheck className="h-7 w-7" aria-hidden />
          </div>
          <p className="text-sm text-grafite">
            Enviamos um link de confirmação para <strong>{sentTo}</strong>. Abra o e-mail e clique no link para ativar
            sua conta e cadastrar sua lavanderia.
          </p>
          <p className="text-xs text-grafite-500">Não chegou? Verifique a caixa de spam ou aguarde alguns minutos.</p>
          <Link to="/login" className="inline-block text-sm font-semibold text-petroleo hover:underline">
            Voltar para o login
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Criar conta" subtitle="Comece a organizar sua lavanderia hoje.">
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        {formError && <Alert>{formError}</Alert>}
        <Field label="Seu nome" htmlFor="fullName" error={errors.fullName}>
          <Input id="fullName" autoComplete="name" value={form.fullName} onChange={set("fullName")} invalid={!!errors.fullName} />
        </Field>
        <Field label="E-mail" htmlFor="email" error={errors.email}>
          <Input id="email" type="email" autoComplete="email" value={form.email} onChange={set("email")} invalid={!!errors.email} />
        </Field>
        <Field label="Senha" htmlFor="password" error={errors.password} hint="Mínimo de 8 caracteres.">
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={set("password")}
            invalid={!!errors.password}
          />
        </Field>
        <Field label="Confirmar senha" htmlFor="confirm" error={errors.confirm}>
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            value={form.confirm}
            onChange={set("confirm")}
            invalid={!!errors.confirm}
          />
        </Field>
        <div>
          <label className="flex items-start gap-3 text-sm text-grafite">
            <input id="terms" type="checkbox" className="mt-1 accent-agua" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
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
          {errors.terms && <p className="mt-1 text-xs font-medium text-red-600">{errors.terms}</p>}
        </div>
        <Button type="submit" block loading={loading}>
          Criar conta
        </Button>
        <p className="text-center text-sm text-grafite-500">
          Já tem conta?{" "}
          <Link to="/login" className="font-semibold text-petroleo hover:underline">
            Entrar
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}
