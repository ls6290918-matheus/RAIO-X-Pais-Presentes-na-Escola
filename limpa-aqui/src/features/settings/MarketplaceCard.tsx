import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, ExternalLink, Plus, Search, Store, X } from "lucide-react";
import { Alert, Button, Card, Field, Input, Textarea, cn } from "@/components/shared/ui";
import { useBusiness } from "@/contexts/BusinessContext";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { PixKeyForm } from "@/components/shared/PixKeyForm";
import { useAppPaymentAvailable } from "@/features/client/HireOptions";

type Municipality = { id: number; name: string };
type MarketData = {
  slug: string;
  municipality_id: number | null;
  marketplace_visible: boolean;
  public_description: string | null;
  offers_pickup: boolean;
  accepts_direct_payment: boolean;
  accepts_app_payment: boolean;
};

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-50",
        checked ? "bg-agua" : "bg-grafite/20",
      )}
    >
      <span className={cn("inline-block h-5 w-5 rounded-full bg-white shadow transition", checked ? "translate-x-5" : "translate-x-0.5")} />
    </button>
  );
}

/** Configurações → "No marketplace": como o prestador aparece para quem contrata. Só o dono altera. */
export function MarketplaceCard() {
  const { business, role } = useBusiness();
  const isOwner = role === "owner";
  const [data, setData] = useState<MarketData | null>(null);
  const [areas, setAreas] = useState<Municipality[]>([]);
  const [all, setAll] = useState<Municipality[]>([]);
  const [missing, setMissing] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [hasPixKey, setHasPixKey] = useState(false);
  const platformApp = useAppPaymentAvailable();

  const load = useCallback(async () => {
    if (!business) return;
    const [b, a, m, r, k] = await Promise.all([
      supabase
        .from("businesses")
        .select("slug, municipality_id, marketplace_visible, public_description, offers_pickup, accepts_direct_payment, accepts_app_payment")
        .eq("id", business.id)
        .single(),
      supabase.from("service_areas").select("municipality_id, municipality:municipalities(id, name)").eq("business_id", business.id).eq("active", true),
      supabase.from("municipalities").select("id, name").eq("state_id", 33).order("name"),
      supabase.rpc("marketplace_requirements", { p_business_id: business.id }),
      supabase.from("payout_accounts").select("id").eq("business_id", business.id).maybeSingle(),
    ]);
    setHasPixKey(Boolean(k.data));
    const err = b.error ?? a.error ?? m.error ?? r.error;
    if (err) setMsg({ kind: "error", text: friendlyError(err) });
    const d = b.data as MarketData | null;
    setData(d);
    setDescription(d?.public_description ?? "");
    setAreas(
      ((a.data as unknown as Array<{ municipality: Municipality }>) ?? [])
        .map((x) => x.municipality)
        .filter(Boolean)
        .sort((x, y) => x.name.localeCompare(y.name)),
    );
    setAll((m.data as Municipality[]) ?? []);
    setMissing((r.data as string[]) ?? []);
  }, [business]);

  useEffect(() => {
    void load();
  }, [load]);

  const suggestions = useMemo(() => {
    const k = norm(q.trim());
    if (!k) return [];
    const have = new Set(areas.map((a) => a.id));
    return all.filter((m) => !have.has(m.id) && norm(m.name).includes(k)).slice(0, 6);
  }, [q, all, areas]);

  if (!business || !data) return null;
  const home = all.find((m) => m.id === data.municipality_id) ?? null;
  const homeMissing = home && !areas.some((a) => a.id === home.id);

  async function run(key: string, fn: () => PromiseLike<{ error: unknown }>, ok?: string) {
    setBusy(key);
    setMsg(null);
    const { error } = await fn();
    setBusy(null);
    if (error) {
      setMsg({ kind: "error", text: friendlyError(error) });
      return false;
    }
    if (ok) setMsg({ kind: "success", text: ok });
    await load();
    return true;
  }

  const addArea = (m: Municipality) =>
    run(`a${m.id}`, () => supabase.from("service_areas").insert({ business_id: business.id, municipality_id: m.id }), `${m.name} adicionado.`).then(() => setQ(""));
  const removeArea = (m: Municipality) =>
    run(`a${m.id}`, () => supabase.from("service_areas").delete().eq("business_id", business.id).eq("municipality_id", m.id));
  const setFlag = (col: "offers_pickup" | "accepts_direct_payment", v: boolean) =>
    run(col, () => supabase.from("businesses").update({ [col]: v }).eq("id", business.id));
  const setApp = (v: boolean) =>
    run("app", () => supabase.rpc("set_app_payment", { p_business_id: business.id, p_enabled: v }), v ? "Pagamento pelo app ligado." : "Pagamento pelo app desligado.");
  const saveDescription = () =>
    run("desc", () => supabase.from("businesses").update({ public_description: description.trim() || null }).eq("id", business.id), "Descrição salva.");
  const setVisible = (v: boolean) =>
    run(
      "visible",
      () => supabase.rpc("set_marketplace_visible", { p_business_id: business.id, p_visible: v }),
      v ? "Pronto! Sua lavanderia já aparece na busca." : "Sua lavanderia saiu da busca.",
    );

  const publicUrl = `${window.location.origin}/p/${data.slug}`;

  return (
    <Card className="p-6" >
      <div id="marketplace" className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-agua-50 text-petroleo">
          <Store className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <h2 className="text-base font-semibold text-petroleo">No marketplace</h2>
          <p className="text-sm text-grafite-500">Como sua lavanderia aparece para quem procura serviços no Limpa Aqui.</p>
        </div>
      </div>

      <div className="mt-5 space-y-6">
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
        {!isOwner && <Alert>Somente o dono da lavanderia pode alterar estas informações.</Alert>}

        {/* Aparecer na busca */}
        <div className="rounded-xl border border-grafite/10 p-4">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <p className="text-sm font-semibold text-grafite">Aparecer na busca</p>
              <p className="text-xs text-grafite-500">
                {data.marketplace_visible ? "Visível para quem procura nos municípios que você atende." : "Hoje sua lavanderia não aparece para clientes novos."}
              </p>
            </div>
            <Toggle
              label="Aparecer na busca"
              checked={data.marketplace_visible}
              disabled={!isOwner || busy === "visible" || (!data.marketplace_visible && missing.length > 0)}
              onChange={(v) => void setVisible(v)}
            />
          </div>
          {!data.marketplace_visible && missing.length > 0 && (
            <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800" data-testid="mk-missing">
              <p className="flex items-center gap-2 font-semibold">
                <AlertCircle className="h-4 w-4" aria-hidden /> Para aparecer falta:
              </p>
              <ul className="mt-1 list-disc pl-6">
                {missing.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          )}
          {data.marketplace_visible && (
            <p className="mt-3 text-sm">
              <a href={publicUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-petroleo hover:underline">
                Ver meu perfil público <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </a>
            </p>
          )}
        </div>

        {/* Municípios atendidos */}
        <div>
          <p className="text-sm font-semibold text-grafite">Municípios que você atende</p>
          <p className="text-xs text-grafite-500">Clientes destes municípios do RJ encontram você na busca.</p>
          <div className="mt-3 flex flex-wrap gap-2" data-testid="mk-areas">
            {areas.map((m) => (
              <span key={m.id} className="inline-flex items-center gap-1 rounded-full bg-agua-50 py-1 pl-3 pr-1 text-sm font-medium text-petroleo">
                {m.name}
                {isOwner && (
                  <button
                    type="button"
                    disabled={busy === `a${m.id}`}
                    onClick={() => void removeArea(m)}
                    className="rounded-full p-1 hover:bg-white"
                    aria-label={`Remover ${m.name}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </span>
            ))}
            {areas.length === 0 && <span className="text-sm text-grafite-500">Nenhum município ainda.</span>}
          </div>
          {isOwner && (
            <div className="mt-3 space-y-2">
              {homeMissing && (
                <Button variant="outline" className="h-9" loading={busy === `a${home!.id}`} onClick={() => void addArea(home!)}>
                  <Plus className="h-4 w-4" aria-hidden /> Adicionar {home!.name} (sua cidade)
                </Button>
              )}
              <div className="relative sm:max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-grafite-500" aria-hidden />
                <Input className="pl-9" placeholder="Adicionar município do RJ" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Adicionar município" />
              </div>
              {suggestions.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {suggestions.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      disabled={busy === `a${m.id}`}
                      onClick={() => void addArea(m)}
                      className="inline-flex items-center gap-1 rounded-full border border-grafite/15 px-3 py-1 text-sm text-grafite hover:border-agua"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden /> {m.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Coleta e pagamento */}
        <div className="space-y-3">
          <p className="text-sm font-semibold text-grafite">Atendimento e pagamento</p>
          <label className="flex items-center gap-3">
            <Toggle label="Faço coleta e devolução" checked={data.offers_pickup} disabled={!isOwner || busy === "offers_pickup"} onChange={(v) => void setFlag("offers_pickup", v)} />
            <span className="text-sm text-grafite">Faço coleta e devolução na casa do cliente</span>
          </label>
          <label className="flex items-center gap-3">
            <Toggle
              label="Aceito pagamento direto"
              checked={data.accepts_direct_payment}
              disabled={!isOwner || busy === "accepts_direct_payment"}
              onChange={(v) => void setFlag("accepts_direct_payment", v)}
            />
            <span className="text-sm text-grafite">Aceito pagamento direto (Pix, dinheiro ou cartão comigo)</span>
          </label>
          <div className="flex items-start gap-3">
            <Toggle
              label="Pagamento pelo app"
              checked={data.accepts_app_payment}
              disabled={!isOwner || busy === "app" || (!data.accepts_app_payment && (!platformApp || !hasPixKey))}
              onChange={(v) => void setApp(v)}
            />
            <span className="text-sm text-grafite">
              Aceito pagamento pelo app (Pix)
              <span className="block text-xs text-grafite-500">
                {platformApp === false
                  ? "Ainda não liberado pela plataforma."
                  : "O cliente paga pelo Limpa Aqui antes de você começar; a plataforma desconta a comissão e repassa o valor para a sua chave Pix."}
              </span>
            </span>
          </div>
          {isOwner && platformApp && (
            <div className="rounded-xl border border-grafite/10 p-4">
              <p className="mb-2 text-sm font-semibold text-grafite">Chave Pix para receber os repasses</p>
              <PixKeyForm businessId={business.id} onSaved={() => void load()} />
            </div>
          )}
        </div>

        {/* Descrição */}
        <div>
          <Field label="Descrição no seu perfil" htmlFor="mk-desc" hint={`${description.length}/500. Conte o que você faz bem, prazos e diferenciais.`}>
            <Textarea id="mk-desc" rows={3} maxLength={500} value={description} disabled={!isOwner} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          {isOwner && (
            <Button className="mt-3" variant="outline" loading={busy === "desc"} onClick={() => void saveDescription()}>
              Salvar descrição
            </Button>
          )}
        </div>

        <p className="text-xs text-grafite-500">
          Seus serviços e preços aparecem no perfil como estão no menu <Link to="/app/servicos" className="font-semibold text-petroleo hover:underline">Serviços</Link>.
          Rua, número e WhatsApp não aparecem para o público.
        </p>
      </div>
    </Card>
  );
}
