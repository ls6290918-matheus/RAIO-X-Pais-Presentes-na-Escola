import { useCallback, useEffect, useState } from "react";
import { Check, Gem, Sparkles } from "lucide-react";
import { Alert, Button, Card, PageHeader, cn } from "@/components/shared/ui";
import { PixCheckout } from "@/components/shared/PixCheckout";
import { useBusiness } from "@/contexts/BusinessContext";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { formatBRL, formatDate } from "@/lib/format";

type PublicPlan = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  price: number;
  period_days: number;
  max_orders_month: number | null;
  max_staff: number | null;
  featured: boolean;
  is_default: boolean;
  features: string[];
};

const period = (d: number) => (d === 30 ? "mês" : d === 365 ? "ano" : `${d} dias`);
const limit = (v: number | null, word: string) => (v == null ? `${word[0].toUpperCase()}${word.slice(1)} ilimitados` : v === 0 ? `Sem ${word}` : `Até ${v} ${word}`);

/** /app/plano — plano da lavanderia, uso dos limites, troca de plano e Pix da mensalidade (só o dono). */
export default function PlanPage() {
  const { business, plan, refreshPlan, features } = useBusiness();
  const [plans, setPlans] = useState<PublicPlan[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  useEffect(() => {
    void supabase.rpc("public_plans").then(({ data }) => setPlans(((data as PublicPlan[]) ?? []).map((p) => ({ ...p, price: Number(p.price) }))));
  }, []);

  const invoice = plan?.open_invoice ?? null;

  const invoicePaid = useCallback(async () => {
    if (!invoice) return false;
    const { data } = await supabase.from("subscription_invoices").select("status").eq("id", invoice.id).maybeSingle();
    const paid = data?.status === "paga";
    if (paid) {
      await refreshPlan();
      setMsg({ kind: "success", text: `Pagamento confirmado! Seu plano ${invoice.plan_name} já está ativo.` });
    }
    return paid;
  }, [invoice, refreshPlan]);

  async function choose(p: PublicPlan) {
    if (!business) return;
    if (p.price === 0 && !window.confirm(`Mudar para o plano ${p.name}? Recursos fora dele ficam bloqueados na hora.`)) return;
    setBusy(p.id);
    setMsg(null);
    const { data, error } = await supabase.rpc("choose_plan", { p_business_id: business.id, p_plan_id: p.id });
    setBusy(null);
    if (error) return setMsg({ kind: "error", text: friendlyError(error) });
    await refreshPlan();
    if ((data as { activated: boolean }).activated) setMsg({ kind: "success", text: `Pronto! Você está no plano ${p.name}.` });
  }

  async function cancelInvoice() {
    if (!invoice) return;
    const { error } = await supabase.rpc("cancel_invoice", { p_invoice_id: invoice.id });
    if (error) return setMsg({ kind: "error", text: friendlyError(error) });
    await refreshPlan();
  }

  if (!plan) return null;
  const sub = plan.subscription;
  const featureName = (code: string) => features.find((f) => f.code === code)?.name ?? code;

  return (
    <div className="space-y-6">
      <PageHeader title="Meu plano" description="O que a sua lavanderia tem no Limpa Aqui e quanto custa." />
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      <Card className="space-y-4 p-6" >
        <div className="flex flex-wrap items-center gap-3">
          <Gem className="h-6 w-6 text-agua-600" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold text-petroleo" data-testid="current-plan">
              Plano {plan.plan.name}
            </p>
            <p className="text-sm text-grafite-500">
              {plan.plan.price > 0 ? `${formatBRL(Number(plan.plan.price))} por ${period(plan.plan.period_days)}` : "Sem mensalidade"}
              {sub?.current_period_end && plan.plan.id === sub.plan_id && ` · válido até ${formatDate(sub.current_period_end)}`}
              {sub?.source === "admin" && plan.plan.id === sub.plan_id && " · cortesia do Limpa Aqui"}
            </p>
          </div>
          {plan.plan.featured && <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">Destaque na busca</span>}
        </div>
        {sub?.expired && plan.plan.id === sub.plan_id && sub.grace_until && (
          <Alert>
            Seu plano venceu. Ele continua valendo até {formatDate(sub.grace_until)}; depois a lavanderia volta ao plano gratuito. Renove abaixo.
          </Alert>
        )}
        <div className="grid gap-3 sm:grid-cols-2" data-testid="plan-usage">
          <div className="rounded-xl bg-nevoa p-3 text-sm">
            <p className="text-grafite-500">Pedidos de balcão este mês</p>
            <p className="font-semibold text-grafite">
              {plan.usage.orders_month}
              {plan.plan.max_orders_month != null ? ` de ${plan.plan.max_orders_month}` : " (sem limite)"}
            </p>
          </div>
          <div className="rounded-xl bg-nevoa p-3 text-sm">
            <p className="text-grafite-500">Funcionários</p>
            <p className="font-semibold text-grafite">
              {plan.usage.staff}
              {plan.plan.max_staff != null ? ` de ${plan.plan.max_staff}` : " (sem limite)"}
            </p>
          </div>
        </div>
        <p className="text-xs text-grafite-500">Pedidos recebidos pelo marketplace não contam no limite.</p>
      </Card>

      {invoice && (
        <Card className="space-y-4 p-6" >
          <div>
            <h2 className="text-base font-semibold text-petroleo">Pagar o plano {invoice.plan_name}</h2>
            <p className="text-sm text-grafite-500">
              {formatBRL(Number(invoice.amount))} por Pix. O plano começa assim que o banco confirmar.
            </p>
          </div>
          <PixCheckout
            kind="invoice"
            id={invoice.id}
            onRefresh={invoicePaid}
            note="O pagamento é processado pela SyncPay e recebido pelo Limpa Aqui. Pagando antes do vencimento, os dias que faltam são somados."
          />
          <button type="button" className="w-full text-center text-xs font-semibold text-grafite-500 hover:underline" onClick={() => void cancelInvoice()}>
            Desistir desta mensalidade
          </button>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="plan-list">
        {plans.map((p) => {
          const current = p.id === plan.plan.id;
          const renew = current && p.price > 0;
          const blocked = p.price > 0 && !plan.can_pay;
          return (
            <Card key={p.id} className={cn("flex flex-col p-5", current && "ring-2 ring-agua")}>
              <div className="flex items-center gap-2">
                <p className="flex-1 text-base font-semibold text-petroleo">{p.name}</p>
                {p.featured && <Sparkles className="h-4 w-4 text-amber-500" aria-label="Destaque na busca" />}
                {current && <span className="rounded-full bg-agua-50 px-2.5 py-0.5 text-xs font-semibold text-agua-600">Atual</span>}
              </div>
              <p className="mt-2 text-2xl font-semibold text-grafite">
                {p.price > 0 ? formatBRL(p.price) : "Grátis"}
                {p.price > 0 && <span className="text-sm font-normal text-grafite-500"> / {period(p.period_days)}</span>}
              </p>
              {p.description && <p className="mt-2 text-sm text-grafite-500">{p.description}</p>}
              <ul className="mt-3 flex-1 space-y-1 text-sm text-grafite">
                <li className="flex gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-agua-600" aria-hidden /> {limit(p.max_orders_month, "pedidos de balcão")}
                </li>
                <li className="flex gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-agua-600" aria-hidden /> {limit(p.max_staff, "funcionários")}
                </li>
                {p.featured && (
                  <li className="flex gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-agua-600" aria-hidden /> Destaque no topo da busca
                  </li>
                )}
                <li className="pt-1 text-xs text-grafite-500">{p.features.map(featureName).join(" · ")}</li>
              </ul>
              {current && !renew ? (
                <Button className="mt-4" variant="outline" disabled>
                  Plano atual
                </Button>
              ) : (
                <Button className="mt-4" variant={current ? "outline" : "primary"} loading={busy === p.id} disabled={blocked || Boolean(invoice)} onClick={() => void choose(p)}>
                  {blocked ? "Em breve" : renew ? "Renovar" : p.price > 0 ? `Assinar por ${formatBRL(p.price)}` : "Mudar para este"}
                </Button>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
