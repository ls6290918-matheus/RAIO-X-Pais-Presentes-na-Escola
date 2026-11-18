import { Plus, Trash2 } from "lucide-react";
import { Button, Field, Input, Select } from "@/components/shared/ui";
import { useBusiness } from "@/contexts/BusinessContext";
import { formatBRL, moneyInput, parseMoney } from "@/lib/format";
import { priceLabel, unitShort } from "@/lib/pricing";
import type { Service } from "@/lib/types";
import { type ItemDraft, PIECE_TYPES, allowsFraction, emptyItem, itemKind, parseQty } from "./itemFields";

/**
 * Lista de itens do pedido/orçamento: serviço, ficha por categoria, quantidade e valor.
 * Usado em "Novo pedido" e em "Editar itens" do orçamento.
 */
export function ItemsEditor({
  items,
  setItems,
  services,
  errors,
}: {
  items: ItemDraft[];
  setItems: (fn: (list: ItemDraft[]) => ItemDraft[]) => void;
  services: Service[];
  errors: Record<string, string>;
}) {
  const { hasFeature } = useBusiness();
  const byId = new Map(services.map((s) => [s.id, s]));
  const update = (key: number, patch: Partial<ItemDraft>) => setItems((list) => list.map((it) => (it.key === key ? { ...it, ...patch } : it)));

  return (
    <>
      <datalist id="piece-types">
        {PIECE_TYPES.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
      <ul className="space-y-4">
        {items.map((it, i) => {
          const s = byId.get(it.serviceId);
          const kind = itemKind(s, hasFeature);
          const fraction = allowsFraction(s?.pricing_unit);
          const sub = parseMoney(it.price) * parseQty(it.quantity);
          return (
            <li key={it.key} className="rounded-xl border border-grafite/10 p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-grafite-500">Item {i + 1}</span>
                <div className="flex items-center gap-2">
                  {!Number.isNaN(sub) && sub > 0 && <span className="text-sm font-semibold text-petroleo">{formatBRL(sub)}</span>}
                  {items.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setItems((list) => list.filter((x) => x.key !== it.key))}
                      className="rounded-lg p-1.5 text-grafite-500 hover:bg-red-50 hover:text-red-600"
                      aria-label={`Remover item ${i + 1}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Serviço" htmlFor={`service-${it.key}`} error={errors[`service-${it.key}`]}>
                  <Select
                    id={`service-${it.key}`}
                    value={it.serviceId}
                    invalid={!!errors[`service-${it.key}`]}
                    onChange={(e) => {
                      const ns = byId.get(e.target.value);
                      update(it.key, {
                        serviceId: e.target.value,
                        price: ns && !(ns.pricing_unit === "orcamento" && Number(ns.price) === 0) ? moneyInput(ns.price) : "",
                        // a ficha muda conforme a categoria do novo serviço
                        attributes: ns?.category_code === s?.category_code ? it.attributes : {},
                      });
                    }}
                  >
                    <option value="">Escolha</option>
                    {services.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name} — {priceLabel(x.price, x.pricing_unit)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={kind ? "Observação (opcional)" : "Descrição (opcional)"} htmlFor={`desc-${it.key}`} error={errors[`desc-${it.key}`]}>
                  <Input
                    id={`desc-${it.key}`}
                    placeholder={kind ? "Ex.: mancha na lateral" : "Ex.: Nike Air Force branco"}
                    value={it.description}
                    onChange={(e) => update(it.key, { description: e.target.value })}
                    invalid={!!errors[`desc-${it.key}`]}
                  />
                </Field>
              </div>

              {kind && (
                <fieldset className="mt-3 rounded-xl bg-nevoa/70 p-3">
                  <legend className="sr-only">{kind.title}</legend>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-grafite-500" aria-hidden>
                    {kind.title}
                  </p>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {kind.fields.map((f) => (
                      <Field key={f.key} label={f.label} htmlFor={`attr-${it.key}-${f.key}`} error={errors[`attr-${it.key}-${f.key}`]}>
                        <Input
                          id={`attr-${it.key}-${f.key}`}
                          className="h-10 bg-white"
                          inputMode={f.numeric ? "decimal" : undefined}
                          list={f.list ? "piece-types" : undefined}
                          placeholder={f.placeholder}
                          maxLength={f.numeric ? 6 : f.max ?? 60}
                          value={it.attributes[f.key] ?? ""}
                          onChange={(e) => update(it.key, { attributes: { ...it.attributes, [f.key]: e.target.value } })}
                          invalid={!!errors[`attr-${it.key}-${f.key}`]}
                        />
                      </Field>
                    ))}
                  </div>
                </fieldset>
              )}

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label={`Quantidade${s ? ` (${unitShort(s.pricing_unit)})` : ""}`} htmlFor={`qty-${it.key}`} error={errors[`qty-${it.key}`]}>
                  <Input
                    id={`qty-${it.key}`}
                    inputMode={fraction ? "decimal" : "numeric"}
                    value={it.quantity}
                    onChange={(e) => update(it.key, { quantity: e.target.value })}
                    invalid={!!errors[`qty-${it.key}`]}
                  />
                </Field>
                <Field
                  label={s?.pricing_unit === "orcamento" ? "Valor combinado (R$)" : `Valor por ${s ? unitShort(s.pricing_unit) : "unidade"} (R$)`}
                  htmlFor={`price-${it.key}`}
                  error={errors[`price-${it.key}`]}
                >
                  <Input
                    id={`price-${it.key}`}
                    inputMode="decimal"
                    placeholder={s?.pricing_unit === "orcamento" ? "Defina após avaliar" : undefined}
                    value={it.price}
                    onChange={(e) => update(it.key, { price: e.target.value })}
                    invalid={!!errors[`price-${it.key}`]}
                  />
                </Field>
              </div>
            </li>
          );
        })}
      </ul>
      {items.length < 30 && (
        <Button type="button" variant="outline" className="mt-4" onClick={() => setItems((list) => [...list, emptyItem()])}>
          <Plus className="h-4 w-4" aria-hidden /> Adicionar item
        </Button>
      )}
    </>
  );
}
