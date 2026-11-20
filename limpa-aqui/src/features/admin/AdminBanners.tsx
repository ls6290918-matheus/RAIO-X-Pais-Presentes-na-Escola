import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, Pencil, Plus, Trash2 } from "lucide-react";
import { Alert, Button, Card, Field, InlineLoader, Input, Select, cn } from "@/components/shared/ui";
import { BannerCarousel, bannerImageUrl, type Banner } from "@/components/shared/market";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { compressPhoto } from "@/lib/photos";

type Row = Banner & { active: boolean; starts_at: string | null; ends_at: string | null; sort: number };
type Form = { id: string | null; title: string; subtitle: string; link_path: string; tone: Banner["tone"]; active: boolean; starts: string; ends: string; sort: string; image_path: string | null };
const empty = (): Form => ({ id: null, title: "", subtitle: "", link_path: "/buscar", tone: "petroleo", active: true, starts: "", ends: "", sort: "0", image_path: null });
const toLocal = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const TONES: Record<Banner["tone"], string> = { petroleo: "Petróleo (escuro)", agua: "Verde-água", claro: "Claro" };

/** Administração → Banners: destaques da home do cliente (sem banner ativo, o espaço não aparece). */
export function AdminBanners() {
  const [list, setList] = useState<Row[] | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("admin_banners");
    if (error) setMsg({ kind: "error", text: friendlyError(error) });
    setList((data as Row[]) ?? []);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function upload(file: File) {
    if (!form) return;
    setBusy(true);
    try {
      const blob = await compressPhoto(file);
      const path = `${crypto.randomUUID()}.jpg`;
      const { error } = await supabase.storage.from("banners").upload(path, blob, { contentType: "image/jpeg", cacheControl: "86400" });
      if (error) throw new Error("Não foi possível enviar a imagem.");
      setForm({ ...form, image_path: path });
    } catch (e) {
      setMsg({ kind: "error", text: e instanceof Error ? e.message : "Imagem inválida." });
    }
    setBusy(false);
  }

  async function save(f: Form) {
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.rpc("admin_upsert_banner", {
      p_id: f.id,
      p_title: f.title,
      p_subtitle: f.subtitle || null,
      p_link_path: f.link_path || null,
      p_tone: f.tone,
      p_active: f.active,
      p_starts_at: f.starts ? new Date(f.starts).toISOString() : null,
      p_ends_at: f.ends ? new Date(f.ends).toISOString() : null,
      p_sort: Number(f.sort) || 0,
      p_image_path: f.image_path,
    });
    setBusy(false);
    if (error) return setMsg({ kind: "error", text: friendlyError(error) });
    setMsg({ kind: "success", text: `Banner "${f.title}" salvo.` });
    setForm(null);
    await load();
  }

  async function remove(r: Row) {
    if (!window.confirm(`Apagar o banner "${r.title}"?`)) return;
    const { error } = await supabase.rpc("admin_delete_banner", { p_id: r.id });
    if (error) return setMsg({ kind: "error", text: friendlyError(error) });
    if (r.image_path) await supabase.storage.from("banners").remove([r.image_path]);
    await load();
  }

  if (list === null) return <InlineLoader />;

  return (
    <div className="space-y-4" data-testid="admin-banners">
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {form ? (
        <Card className="space-y-4 p-5">
          <h3 className="text-base font-semibold text-petroleo">{form.id ? "Editar banner" : "Novo banner"}</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Título" htmlFor="bn-title" hint="Até 60 letras.">
              <Input id="bn-title" maxLength={60} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </Field>
            <Field label="Texto de apoio (opcional)" htmlFor="bn-sub">
              <Input id="bn-sub" maxLength={120} value={form.subtitle} onChange={(e) => setForm({ ...form, subtitle: e.target.value })} />
            </Field>
            <Field label="Leva para (página do Limpa Aqui)" htmlFor="bn-link" hint="Ex.: /buscar?c=lavagem_tenis ou /p/nome-do-prestador">
              <Input id="bn-link" value={form.link_path} onChange={(e) => setForm({ ...form, link_path: e.target.value })} />
            </Field>
            <Field label="Cor" htmlFor="bn-tone">
              <Select id="bn-tone" value={form.tone} onChange={(e) => setForm({ ...form, tone: e.target.value as Banner["tone"] })}>
                {Object.entries(TONES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Começa em (opcional)" htmlFor="bn-start">
              <Input id="bn-start" type="datetime-local" value={form.starts} onChange={(e) => setForm({ ...form, starts: e.target.value })} />
            </Field>
            <Field label="Termina em (opcional)" htmlFor="bn-end">
              <Input id="bn-end" type="datetime-local" value={form.ends} onChange={(e) => setForm({ ...form, ends: e.target.value })} />
            </Field>
            <Field label="Ordem" htmlFor="bn-sort">
              <Input id="bn-sort" type="number" value={form.sort} onChange={(e) => setForm({ ...form, sort: e.target.value })} />
            </Field>
            <div>
              <p className="mb-1.5 text-sm font-medium text-grafite">Imagem (opcional)</p>
              <div className="flex items-center gap-2">
                <Button variant="outline" className="h-10" disabled={busy} onClick={() => fileRef.current?.click()}>
                  <ImagePlus className="h-4 w-4" aria-hidden /> {form.image_path ? "Trocar" : "Enviar"}
                </Button>
                {form.image_path && (
                  <Button variant="ghost" className="h-10" onClick={() => setForm({ ...form, image_path: null })}>
                    Tirar imagem
                  </Button>
                )}
              </div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-grafite">
            <input type="checkbox" className="h-4 w-4 accent-agua-600" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
            Ativo
          </label>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-grafite-500">Prévia</p>
            <div className="max-w-md">
              <BannerCarousel banners={[{ id: "preview", title: form.title || "Título do banner", subtitle: form.subtitle || null, image_path: form.image_path, link_path: null, tone: form.tone }]} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button loading={busy} onClick={() => void save(form)} data-testid="banner-save">
              Salvar
            </Button>
            <Button variant="outline" onClick={() => setForm(null)}>
              Cancelar
            </Button>
          </div>
        </Card>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-grafite-500">Os banners ativos aparecem no Início do cliente. Sem nenhum ativo, o espaço some.</p>
          <Button onClick={() => setForm(empty())} data-testid="banner-new">
            <Plus className="h-4 w-4" aria-hidden /> Novo banner
          </Button>
        </div>
      )}

      <Card className="overflow-hidden">
        {list.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-grafite-500">Nenhum banner ainda.</p>
        ) : (
          <ul className="divide-y divide-grafite/5" data-testid="banner-list">
            {list.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                {r.image_path ? (
                  <img src={bannerImageUrl(r.image_path)} alt="" className="h-12 w-20 rounded-lg object-cover" />
                ) : (
                  <span className={cn("h-12 w-20 rounded-lg", r.tone === "petroleo" ? "bg-petroleo" : r.tone === "agua" ? "bg-agua" : "bg-agua-50")} aria-hidden />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-grafite">{r.title}</p>
                  <p className="truncate text-xs text-grafite-500">
                    {r.link_path ?? "sem link"}
                    {r.ends_at && ` · até ${new Date(r.ends_at).toLocaleDateString("pt-BR")}`}
                  </p>
                </div>
                <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", r.active ? "bg-agua-50 text-petroleo" : "bg-nevoa text-grafite-500")}>
                  {r.active ? "Ativo" : "Desligado"}
                </span>
                <Button
                  variant="outline"
                  className="h-9"
                  aria-label={`Editar ${r.title}`}
                  onClick={() =>
                    setForm({
                      id: r.id,
                      title: r.title,
                      subtitle: r.subtitle ?? "",
                      link_path: r.link_path ?? "",
                      tone: r.tone,
                      active: r.active,
                      starts: toLocal(r.starts_at),
                      ends: toLocal(r.ends_at),
                      sort: String(r.sort),
                      image_path: r.image_path,
                    })
                  }
                >
                  <Pencil className="h-4 w-4" aria-hidden />
                </Button>
                <Button variant="outline" className="h-9" aria-label={`Apagar ${r.title}`} onClick={() => void remove(r)}>
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
