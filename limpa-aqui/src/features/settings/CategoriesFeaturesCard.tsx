import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, RotateCcw, Trash2, Wand2 } from "lucide-react";
import { Alert, Button, Card, Input, buttonClass, cn } from "@/components/shared/ui";
import { useBusiness, type FeatureState } from "@/contexts/BusinessContext";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { featureIcon } from "@/lib/featureMeta";

type Category = { code: string; name: string; sort: number };
type BizCategory = { id: string; category_code: string | null; custom_name: string | null; active: boolean; source: "regra" | "manual" };

function Switch({ on, disabled, onChange, label }: { on: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-agua/30 disabled:cursor-not-allowed disabled:opacity-60",
        on ? "bg-agua" : "bg-grafite/20",
      )}
    >
      <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all", on ? "left-[22px]" : "left-0.5")} />
    </button>
  );
}

/**
 * Categorias atendidas e recursos ligados na lavanderia.
 * Ligar uma categoria recalcula os recursos pelas regras; ligar/desligar um recurso à mão
 * fica marcado como ajuste seu (o recálculo respeita). "Restaurar automático" desfaz os ajustes.
 */
export function CategoriesFeaturesCard() {
  const { business, role, features, refresh } = useBusiness();
  const isOwner = role === "owner";
  const [catalog, setCatalog] = useState<Category[]>([]);
  const [rows, setRows] = useState<BizCategory[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [custom, setCustom] = useState("");

  const load = useCallback(async () => {
    if (!business) return;
    const [c, r] = await Promise.all([
      supabase.from("service_categories").select("code, name, sort").order("sort"),
      supabase.from("business_categories").select("id, category_code, custom_name, active, source").eq("business_id", business.id),
    ]);
    setCatalog((c.data as Category[]) ?? []);
    setRows((r.data as BizCategory[]) ?? []);
  }, [business]);

  useEffect(() => {
    void load().then(() => {
      // Link "Abrir Configurações" (recurso desligado) leva direto para cá
      if (window.location.hash === "#recursos") document.getElementById("recursos")?.scrollIntoView({ behavior: "smooth" });
    });
  }, [load]);

  async function run(key: string, action: () => Promise<{ error: unknown }>, success: string) {
    if (!business) return;
    setBusy(key);
    setMessage(null);
    const { error } = await action();
    if (error) {
      setBusy(null);
      return setMessage({ kind: "error", text: friendlyError(error) });
    }
    await Promise.all([load(), refresh()]);
    setBusy(null);
    setMessage({ kind: "success", text: success });
  }

  // Categoria do catálogo: liga/desliga e recalcula os recursos pelas regras
  const toggleCategory = (code: string, on: boolean) =>
    run(
      `cat-${code}`,
      async () => {
        const row = rows.find((r) => r.category_code === code);
        const res = row
          ? await supabase.from("business_categories").update({ active: on }).eq("id", row.id)
          : await supabase.from("business_categories").insert({ business_id: business!.id, category_code: code, active: on });
        if (res.error) return res;
        return supabase.rpc("apply_business_rules", { p_business_id: business!.id });
      },
      on ? "Categoria ativada. Os recursos dela foram ligados." : "Categoria desativada.",
    );

  const addCustom = () => {
    const name = custom.trim().replace(/\s+/g, " ");
    if (name.length < 2 || name.length > 60) return setMessage({ kind: "error", text: "O nome precisa ter de 2 a 60 caracteres." });
    void run(
      "custom-add",
      async () => {
        const res = await supabase.from("business_categories").insert({ business_id: business!.id, custom_name: name });
        if (!res.error) setCustom("");
        return res;
      },
      "Serviço personalizado adicionado.",
    );
  };

  const toggleFeature = (f: FeatureState, on: boolean) =>
    run(
      `feat-${f.code}`,
      async () =>
        f.source
          ? supabase.from("business_features").update({ enabled: on }).eq("business_id", business!.id).eq("feature_code", f.code)
          : supabase.from("business_features").insert({ business_id: business!.id, feature_code: f.code, enabled: on }),
      on ? `${f.name} ligado.` : `${f.name} desligado.`,
    );

  const customRows = rows.filter((r) => r.custom_name);
  const listFeatures = features.filter((f) => f.code !== "checklist");

  return (
    <Card className="space-y-8 p-6" >
      <div id="recursos" className="scroll-mt-24">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-petroleo">Categorias e recursos</h2>
            <p className="mt-1 text-sm text-grafite-500">O que você atende define o que aparece no seu painel. Dá para mudar quando quiser.</p>
          </div>
          {isOwner && (
            <Link to="/personalizar" className={cn(buttonClass("outline"), "h-10")}>
              <Wand2 className="h-4 w-4" aria-hidden /> Refazer o assistente
            </Link>
          )}
        </div>
        {!isOwner && (
          <div className="mt-4">
            <Alert>Somente o dono da lavanderia pode alterar categorias e recursos.</Alert>
          </div>
        )}
        {message && (
          <div className="mt-4">
            <Alert kind={message.kind}>{message.text}</Alert>
          </div>
        )}
      </div>

      <section aria-labelledby="cat-title">
        <h3 id="cat-title" className="text-sm font-semibold text-petroleo">
          Serviços que você oferece
        </h3>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {catalog.map((c) => {
            const on = !!rows.find((r) => r.category_code === c.code && r.active);
            return (
              <li key={c.code} className="flex items-center justify-between gap-3 rounded-xl border border-grafite/10 px-3.5 py-2.5">
                <span className="text-sm text-grafite">{c.name}</span>
                <Switch label={c.name} on={on} disabled={!isOwner || !!busy} onChange={(v) => void toggleCategory(c.code, v)} />
              </li>
            );
          })}
        </ul>

        <div className="mt-4">
          <p className="text-sm font-medium text-grafite">Serviços personalizados</p>
          {customRows.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-2">
              {customRows.map((r) => (
                <li key={r.id} className={cn("inline-flex items-center gap-1.5 rounded-full py-1.5 pl-3 pr-1.5 text-sm font-medium", r.active ? "bg-agua-50 text-petroleo" : "bg-nevoa text-grafite-500 line-through")}>
                  {r.custom_name}
                  {isOwner && (
                    <button
                      type="button"
                      disabled={!!busy}
                      onClick={() =>
                        void run(`custom-${r.id}`, async () => supabase.from("business_categories").delete().eq("id", r.id), "Serviço personalizado removido.")
                      }
                      className="rounded-full p-0.5 hover:bg-white"
                      aria-label={`Remover ${r.custom_name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {isOwner && (
            <div className="mt-2 flex max-w-md gap-2">
              <Input
                aria-label="Novo serviço personalizado"
                placeholder="Ex.: Restauração de couro"
                value={custom}
                maxLength={60}
                onChange={(e) => setCustom(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCustom();
                  }
                }}
              />
              <Button type="button" variant="outline" onClick={addCustom} loading={busy === "custom-add"} aria-label="Adicionar serviço personalizado">
                <Plus className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          )}
        </div>
      </section>

      <section aria-labelledby="feat-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 id="feat-title" className="text-sm font-semibold text-petroleo">
            Recursos do painel
          </h3>
          {isOwner && listFeatures.some((f) => f.source === "manual") && (
            <Button
              variant="ghost"
              className="h-9 px-3 text-xs"
              loading={busy === "reset"}
              disabled={!!busy}
              onClick={() =>
                void run("reset", async () => supabase.rpc("reset_business_features", { p_business_id: business!.id }), "Recursos restaurados para o automático.")
              }
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Restaurar automático
            </Button>
          )}
        </div>
        <ul className="mt-3 divide-y divide-grafite/5 rounded-xl border border-grafite/10">
          {listFeatures.map((f) => {
            const Icon = featureIcon(f.code);
            return (
              <li key={f.code} className="flex items-center gap-3 px-3.5 py-3">
                <Icon className="h-5 w-5 shrink-0 text-grafite-500" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-grafite">
                    {f.name}
                    {f.status === "em_breve" && <span className="rounded-full bg-nevoa px-2 py-0.5 text-[11px] font-semibold text-grafite-500">Em breve</span>}
                  </p>
                  <p className="text-xs text-grafite-500">
                    {f.description}
                    {f.source === "manual" && <span className="font-medium text-petroleo"> · ajustado por você</span>}
                    {f.source === "regra" && <span> · automático</span>}
                  </p>
                </div>
                <Switch label={f.name} on={f.enabled} disabled={!isOwner || !!busy} onChange={(v) => void toggleFeature(f, v)} />
              </li>
            );
          })}
        </ul>
      </section>
    </Card>
  );
}
