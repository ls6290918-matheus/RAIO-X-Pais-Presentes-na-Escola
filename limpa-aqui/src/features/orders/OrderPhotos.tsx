import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, ChevronLeft, ChevronRight, ImagePlus, Loader2, Trash2, X } from "lucide-react";
import { Alert, Card, cn } from "@/components/shared/ui";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { MAX_PHOTOS, removeOrderPhotoFile, signedPhotoUrls, uploadOrderPhoto } from "@/lib/photos";

type Kind = "antes" | "depois";
type Photo = { id: string; kind: Kind; path: string; created_at: string; url?: string };

const LABEL: Record<Kind, { title: string; hint: string }> = {
  antes: { title: "Antes", hint: "Como o item chegou" },
  depois: { title: "Depois", hint: "Resultado do serviço" },
};

/**
 * Fotos de antes e depois do pedido. Ficam num bucket privado do Supabase Storage:
 * só quem é da lavanderia vê (links temporários de 1 hora).
 */
export function OrderPhotos({ businessId, orderId }: { businessId: string; orderId: string }) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Kind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<number | null>(null);
  const inputs = { antes: useRef<HTMLInputElement>(null), depois: useRef<HTMLInputElement>(null) };

  const load = useCallback(async () => {
    const { data, error: err } = await supabase
      .from("order_photos")
      .select("id, kind, path, created_at")
      .eq("order_id", orderId)
      .order("created_at");
    if (err) {
      setError(friendlyError(err));
      setLoading(false);
      return;
    }
    const list = (data as Photo[]) ?? [];
    const urls = await signedPhotoUrls(list.map((p) => p.path));
    setPhotos(list.map((p) => ({ ...p, url: urls.get(p.path) })));
    setLoading(false);
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add(kind: Kind, files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) return setError(`Cada pedido pode ter no máximo ${MAX_PHOTOS} fotos.`);
    const chosen = Array.from(files).slice(0, room);
    setBusy(kind);
    try {
      for (const file of chosen) {
        const path = await uploadOrderPhoto(file, businessId, orderId);
        const { error: err } = await supabase.from("order_photos").insert({ business_id: businessId, order_id: orderId, kind, path });
        if (err) {
          await removeOrderPhotoFile(path); // não deixa arquivo solto no Storage
          throw new Error(friendlyError(err));
        }
      }
      if (files.length > chosen.length) setError(`Foram enviadas ${chosen.length} fotos: o limite é ${MAX_PHOTOS} por pedido.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      const input = inputs[kind].current;
      if (input) input.value = "";
      await load();
    }
  }

  async function remove(photo: Photo) {
    if (!window.confirm("Apagar esta foto?")) return;
    setError(null);
    const { error: err } = await supabase.from("order_photos").delete().eq("id", photo.id);
    if (err) return setError(friendlyError(err));
    await removeOrderPhotoFile(photo.path);
    setViewer(null);
    setPhotos((list) => list.filter((p) => p.id !== photo.id));
  }

  const ordered = [...photos.filter((p) => p.kind === "antes"), ...photos.filter((p) => p.kind === "depois")];
  const current = viewer != null ? ordered[viewer] : null;

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-petroleo">Fotos</h2>
        <span className="text-xs text-grafite-500">
          {photos.length} de {MAX_PHOTOS}
        </span>
      </div>
      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}
      <div className="mt-4 grid gap-5 sm:grid-cols-2">
        {(["antes", "depois"] as const).map((kind) => {
          const list = photos.filter((p) => p.kind === kind);
          return (
            <section key={kind} aria-label={`Fotos de ${LABEL[kind].title.toLowerCase()}`}>
              <p className="text-sm font-semibold text-grafite">{LABEL[kind].title}</p>
              <p className="text-xs text-grafite-500">{LABEL[kind].hint}</p>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {list.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setViewer(ordered.findIndex((x) => x.id === p.id))}
                    className="aspect-square overflow-hidden rounded-xl bg-nevoa"
                    aria-label={`Ver foto de ${LABEL[kind].title.toLowerCase()}`}
                  >
                    {p.url ? <img src={p.url} alt="" loading="lazy" className="h-full w-full object-cover" /> : <Camera className="m-auto h-5 w-5 text-grafite-300" />}
                  </button>
                ))}
                {photos.length < MAX_PHOTOS && (
                  <button
                    type="button"
                    disabled={!!busy || loading}
                    onClick={() => inputs[kind].current?.click()}
                    className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-grafite/15 text-xs font-medium text-grafite-500 transition hover:border-agua hover:text-petroleo disabled:opacity-60"
                    aria-label={`Adicionar foto de ${LABEL[kind].title.toLowerCase()}`}
                  >
                    {busy === kind ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
                    {busy === kind ? "Enviando…" : "Adicionar"}
                  </button>
                )}
              </div>
              <input
                ref={inputs[kind]}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                data-kind={kind}
                onChange={(e) => void add(kind, e.target.files)}
              />
            </section>
          );
        })}
      </div>

      {current && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/90" role="dialog" aria-modal="true" aria-label="Foto do pedido">
          <div className="flex items-center justify-between p-4 text-white">
            <span className="text-sm">
              <strong>{LABEL[current.kind].title}</strong> · {formatDateTime(current.created_at)}
            </span>
            <div className="flex gap-2">
              <button type="button" onClick={() => void remove(current)} className="rounded-lg p-2 hover:bg-white/10" aria-label="Apagar foto">
                <Trash2 className="h-5 w-5" />
              </button>
              <button type="button" onClick={() => setViewer(null)} className="rounded-lg p-2 hover:bg-white/10" aria-label="Fechar">
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-6">
            {current.url && <img src={current.url} alt="" className="max-h-full max-w-full rounded-lg object-contain" />}
            {ordered.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => setViewer((v) => (v! - 1 + ordered.length) % ordered.length)}
                  className={cn("absolute left-3 rounded-full bg-white/10 p-2 text-white hover:bg-white/20")}
                  aria-label="Foto anterior"
                >
                  <ChevronLeft className="h-6 w-6" />
                </button>
                <button
                  type="button"
                  onClick={() => setViewer((v) => (v! + 1) % ordered.length)}
                  className="absolute right-3 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
                  aria-label="Próxima foto"
                >
                  <ChevronRight className="h-6 w-6" />
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
