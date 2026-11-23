import { useCallback, useEffect, useState } from "react";
import { MessageSquareQuote, Star } from "lucide-react";
import { Alert, Button, Card, EmptyState, PageHeader, Textarea } from "@/components/shared/ui";
import { Skeleton } from "@/components/shared/steps";
import { StarsDisplay } from "@/components/shared/Stars";
import { useBusiness } from "@/contexts/BusinessContext";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";

type Item = {
  id: string;
  rating: number;
  quality: number | null;
  punctuality: number | null;
  service: number | null;
  comment: string | null;
  reply: string | null;
  created_at: string;
  order_number: number;
  author: string;
};
type Data = {
  summary: { count: number; rating: number | null; quality: number | null; punctuality: number | null; service: number | null; stars: Record<string, number> };
  items: Item[];
};

const fmt = (v: number | null) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));

/** /app/avaliacoes — avaliações dos clientes, médias por critério e resposta pública do dono. */
export default function ReviewsPage() {
  const { business, role } = useBusiness();
  const isOwner = role === "owner";
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replying, setReplying] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!business) return;
    const { data: d, error: err } = await supabase.rpc("business_reviews", { p_business_id: business.id });
    if (err) return setError(friendlyError(err));
    setData(d as Data);
  }, [business]);
  useEffect(() => {
    void load();
  }, [load]);

  async function reply(id: string) {
    setBusy(true);
    const { error: err } = await supabase.rpc("reply_review", { p_review_id: id, p_reply: text });
    setBusy(false);
    if (err) return setError(friendlyError(err));
    setReplying(null);
    setText("");
    await load();
  }

  const s = data?.summary;
  const total = Number(s?.count ?? 0);
  return (
    <div className="space-y-5" data-testid="reviews-page">
      <PageHeader title="Avaliações" description="O que os clientes do Limpa Aqui dizem sobre você. As avaliações e suas respostas aparecem no seu perfil público." />
      {error && <Alert>{error}</Alert>}
      {data === null ? (
        <Skeleton className="h-40" />
      ) : total === 0 ? (
        <Card>
          <EmptyState icon={<Star className="h-6 w-6" />} title="Nenhuma avaliação ainda" description="Quando um cliente receber um pedido feito pelo Limpa Aqui, ele pode avaliar você aqui." />
        </Card>
      ) : (
        <>
          <section className="grid gap-4 rounded-3xl bg-petroleo p-5 text-white sm:grid-cols-[auto_1fr]" data-testid="reviews-summary">
            <div className="text-center sm:pr-6">
              <p className="text-5xl font-bold">{fmt(s!.rating)}</p>
              <div className="mt-1 flex justify-center">
                <StarsDisplay value={Number(s!.rating ?? 0)} size={16} />
              </div>
              <p className="mt-1 text-xs text-white/60">{total} avaliação(ões)</p>
            </div>
            <div className="space-y-1.5">
              {[5, 4, 3, 2, 1].map((n) => {
                const c = Number(s!.stars[String(n)] ?? 0);
                return (
                  <div key={n} className="flex items-center gap-2 text-xs">
                    <span className="w-3 text-white/70">{n}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full rounded-full bg-amber-400" style={{ width: `${total ? (c / total) * 100 : 0}%` }} />
                    </div>
                    <span className="w-6 text-right text-white/60">{c}</span>
                  </div>
                );
              })}
              <div className="grid grid-cols-3 gap-2 pt-3 text-center">
                {(
                  [
                    ["Qualidade", s!.quality],
                    ["Pontualidade", s!.punctuality],
                    ["Atendimento", s!.service],
                  ] as const
                ).map(([l, v]) => (
                  <div key={l} className="rounded-xl bg-white/[0.06] py-2">
                    <p className="text-[11px] text-white/60">{l}</p>
                    <p className="text-sm font-bold">{fmt(v)}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <ul className="space-y-3" data-testid="reviews-list">
            {data.items.map((r) => (
              <li key={r.id}>
                <Card className="space-y-2 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <StarsDisplay value={r.rating} />
                    <span className="text-sm font-semibold text-grafite">{r.author}</span>
                    <span className="text-xs text-grafite-500">
                      pedido nº {r.order_number} · {new Date(r.created_at).toLocaleDateString("pt-BR")}
                    </span>
                  </div>
                  {r.comment ? <p className="text-sm text-grafite">{r.comment}</p> : <p className="text-sm italic text-grafite-500">Sem comentário.</p>}
                  {r.reply && replying !== r.id && (
                    <p className="rounded-xl bg-nevoa px-3 py-2 text-xs text-grafite-500">
                      <span className="font-semibold text-petroleo">Sua resposta:</span> {r.reply}
                    </p>
                  )}
                  {isOwner &&
                    (replying === r.id ? (
                      <div className="space-y-2">
                        <Textarea rows={2} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} aria-label="Resposta pública" placeholder="Agradeça ou explique. A resposta fica pública no seu perfil." />
                        <div className="flex gap-2">
                          <Button className="h-9" loading={busy} onClick={() => void reply(r.id)}>
                            Publicar resposta
                          </Button>
                          <Button variant="outline" className="h-9" onClick={() => setReplying(null)}>
                            Cancelar
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setReplying(r.id);
                          setText(r.reply ?? "");
                        }}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-agua-600 hover:underline"
                      >
                        <MessageSquareQuote className="h-3.5 w-3.5" aria-hidden /> {r.reply ? "Editar resposta" : "Responder"}
                      </button>
                    ))}
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
