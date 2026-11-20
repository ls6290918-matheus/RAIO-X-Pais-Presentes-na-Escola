import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Eye, EyeOff, MailCheck } from "lucide-react";
import { Alert, Button, Field, Input, buttonClass, cn } from "@/components/shared/ui";
import { StepScreen, StepTitle } from "@/components/shared/steps";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { maskPhone, onlyDigits } from "@/lib/format";
import { TERMS_VERSION } from "@/lib/legal";
import { signupSchema } from "./schemas";

const TOTAL = 5;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * /cadastro — uma pergunta por tela: e-mail, senha, nome, WhatsApp e termos.
 * Dá para voltar sem perder o que foi preenchido. A conta é criada pelo Supabase Auth
 * (e-mail + senha, com confirmação por e-mail); o WhatsApp não é validado por SMS.
 */
export default function SignupPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({ email: "", password: "", confirm: "", fullName: "", phone: "" });
  const [showPass, setShowPass] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const set = (k: keyof typeof form, v: string) => {
    setError(null);
    setForm((f) => ({ ...f, [k]: v }));
  };

  // o que falta em cada passo (o botão fica desativado até ficar certo, como na referência)
  const phoneDigits = onlyDigits(form.phone);
  const problem: Record<number, string | null> = {
    1: EMAIL.test(form.email.trim()) ? null : "Digite um e-mail válido.",
    2: form.password.length < 8 ? "A senha precisa ter pelo menos 8 caracteres." : form.password !== form.confirm ? "As senhas não conferem." : null,
    3: form.fullName.trim().split(/\s+/).filter((p) => p.length > 1).length < 2 ? "Informe nome e sobrenome." : null,
    4: phoneDigits.length === 0 || phoneDigits.length === 10 || phoneDigits.length === 11 ? null : "Confira o número com DDD.",
    5: accepted ? null : "Para criar a conta, aceite os Termos de Uso e a Política de Privacidade.",
  };

  async function next(e?: FormEvent) {
    e?.preventDefault();
    if (problem[step]) return setError(problem[step]);
    if (step < TOTAL) return setStep(step + 1);
    await create();
  }

  async function create() {
    const parsed = signupSchema.safeParse({ fullName: form.fullName, email: form.email, password: form.password, confirm: form.confirm });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Confira os dados.");
    setLoading(true);
    const { data, error: err } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        data: { full_name: parsed.data.fullName, terms_version: TERMS_VERSION, ...(phoneDigits ? { phone: phoneDigits } : {}) },
        emailRedirectTo: `${window.location.origin}/comecar`,
      },
    });
    setLoading(false);
    if (err) return setError(friendlyError(err));
    // Com confirmação de e-mail ativa, o Supabase devolve identities vazio quando o e-mail já existe
    if (data.user && data.user.identities && data.user.identities.length === 0) {
      setStep(1);
      return setError("Já existe uma conta com este e-mail. Tente entrar ou recuperar a senha.");
    }
    // Sem confirmação de e-mail, a sessão já vem pronta
    if (data.session) return navigate("/comecar", { replace: true });
    setSentTo(parsed.data.email);
  }

  if (sentTo)
    return (
      <StepScreen label="Criar conta" testId="signup-sent">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-agua-50 text-petroleo">
          <MailCheck className="h-7 w-7" aria-hidden />
        </div>
        <StepTitle title="Confirme seu e-mail" subtitle={<>Enviamos um link para <strong className="text-grafite">{sentTo}</strong>. Abra o e-mail e toque no link para ativar a conta.</>} />
        <p className="text-xs text-grafite-500">Não chegou? Veja a caixa de spam ou aguarde alguns minutos.</p>
        <Link to="/login" className={cn(buttonClass("outline"), "mt-6")}>
          Ir para o login
        </Link>
      </StepScreen>
    );

  const action = (
    <Button block type="submit" form="signup-step" loading={loading} disabled={!!problem[step] && step !== 5} data-testid="signup-next">
      {step === TOTAL ? "Criar minha conta" : "Continuar"}
    </Button>
  );

  return (
    <StepScreen
      label="Criar conta"
      step={step}
      total={TOTAL}
      onBack={() => (step > 1 ? (setError(null), setStep(step - 1)) : navigate(-1))}
      action={action}
      testId="signup-steps"
    >
      <form id="signup-step" onSubmit={(e) => void next(e)} noValidate className="flex flex-col">
        {step === 1 && (
          <>
            <StepTitle title="Qual é o seu e-mail?" subtitle="Use um e-mail válido: é por ele que você confirma e recupera a conta." />
            <Field label="E-mail" htmlFor="email">
              <Input id="email" type="email" autoComplete="email" inputMode="email" autoFocus value={form.email} onChange={(e) => set("email", e.target.value)} />
            </Field>
          </>
        )}
        {step === 2 && (
          <>
            <StepTitle title="Crie uma senha" subtitle="Pelo menos 8 caracteres. Você vai usar para entrar." />
            <div className="space-y-4">
              <Field label="Senha" htmlFor="password">
                <div className="relative">
                  <Input
                    id="password"
                    type={showPass ? "text" : "password"}
                    autoComplete="new-password"
                    autoFocus
                    className="pr-11"
                    value={form.password}
                    onChange={(e) => set("password", e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass((s) => !s)}
                    className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-grafite-500"
                    aria-label={showPass ? "Esconder senha" : "Mostrar senha"}
                  >
                    {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </Field>
              <Field label="Repita a senha" htmlFor="confirm">
                <Input id="confirm" type={showPass ? "text" : "password"} autoComplete="new-password" value={form.confirm} onChange={(e) => set("confirm", e.target.value)} />
              </Field>
            </div>
          </>
        )}
        {step === 3 && (
          <>
            <StepTitle title="Como você se chama?" subtitle="Seu nome aparece nos pedidos e nas conversas." />
            <Field label="Nome e sobrenome" htmlFor="fullName">
              <Input id="fullName" autoComplete="name" autoFocus value={form.fullName} onChange={(e) => set("fullName", e.target.value)} />
            </Field>
          </>
        )}
        {step === 4 && (
          <>
            <StepTitle title="Qual é o seu WhatsApp?" subtitle="Para avisos dos seus pedidos. Opcional: você pode informar depois." />
            <Field label="WhatsApp com DDD" htmlFor="phone">
              <Input
                id="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                autoFocus
                placeholder="(21) 99999-9999"
                value={form.phone}
                onChange={(e) => set("phone", maskPhone(e.target.value))}
              />
            </Field>
          </>
        )}
        {step === 5 && (
          <>
            <StepTitle title="Quase lá!" subtitle="Confira e aceite os termos para criar a conta." />
            <dl className="space-y-2 rounded-2xl bg-nevoa p-4 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-grafite-500">E-mail</dt>
                <dd className="truncate font-medium text-grafite">{form.email.trim()}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-grafite-500">Nome</dt>
                <dd className="truncate font-medium text-grafite">{form.fullName.trim()}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-grafite-500">WhatsApp</dt>
                <dd className="font-medium text-grafite">{form.phone || "não informado"}</dd>
              </div>
            </dl>
            <label className="mt-5 flex items-start gap-3 text-sm text-grafite">
              <input type="checkbox" className="mt-1 h-4 w-4 accent-agua-600" checked={accepted} onChange={(e) => (setError(null), setAccepted(e.target.checked))} />
              <span>
                Li e aceito os{" "}
                <Link to="/termos" target="_blank" className="font-semibold text-petroleo underline">
                  Termos de Uso
                </Link>{" "}
                e a{" "}
                <Link to="/privacidade" target="_blank" className="font-semibold text-petroleo underline">
                  Política de Privacidade
                </Link>
                .
              </span>
            </label>
          </>
        )}
        {error && (
          <div className="mt-4">
            <Alert>{error}</Alert>
          </div>
        )}
        {step === 1 && (
          <p className="mt-6 text-sm text-grafite-500">
            Já tem conta?{" "}
            <Link to="/login" className="font-semibold text-petroleo hover:underline">
              Entrar
            </Link>
          </p>
        )}
      </form>
    </StepScreen>
  );
}
