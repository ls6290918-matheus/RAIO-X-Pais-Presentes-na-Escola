import { useEffect, useState } from "react";
import { Wrench } from "lucide-react";
import { Alert, Button, Card, Input, Textarea, cn } from "@/components/shared/ui";
import { useBusiness } from "@/contexts/BusinessContext";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { EQUIPMENT } from "@/features/onboarding/catalog";

/** Configurações → Perfil de trabalho: equipamentos, capacidade por dia e experiência (só o dono edita). */
export function WorkProfileCard() {
  const { business, role } = useBusiness();
  const isOwner = role === "owner";
  const [equipment, setEquipment] = useState<string[]>([]);
  const [capacity, setCapacity] = useState("");
  const [experience, setExperience] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  useEffect(() => {
    if (!business) return;
    void supabase
      .from("businesses")
      .select("equipment, daily_capacity, experience")
      .eq("id", business.id)
      .maybeSingle()
      .then(({ data }) => {
        const d = data as { equipment: string[] | null; daily_capacity: number | null; experience: string | null } | null;
        setEquipment(d?.equipment ?? []);
        setCapacity(d?.daily_capacity ? String(d.daily_capacity) : "");
        setExperience(d?.experience ?? "");
        setLoaded(true);
      });
  }, [business]);

  if (!business || !loaded) return null;

  async function save() {
    setBusy(true);
    setMsg(null);
    const cap = capacity.trim() ? Number(capacity) : null;
    const { error } = await supabase.rpc("set_work_profile", {
      p_business_id: business!.id,
      p_equipment: equipment,
      p_daily_capacity: cap,
      p_experience: experience,
    });
    setBusy(false);
    setMsg(error ? { kind: "error", text: friendlyError(error) } : { kind: "success", text: "Perfil de trabalho salvo." });
  }

  return (
    <Card className="space-y-5 p-6">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-agua-50 text-petroleo">
          <Wrench className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <h2 className="text-base font-semibold text-petroleo">Perfil de trabalho</h2>
          <p className="text-sm text-grafite-500">Equipamentos, quantos pedidos você atende por dia e a sua experiência.</p>
        </div>
      </div>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <fieldset disabled={!isOwner}>
        <legend className="mb-2 text-sm font-medium text-grafite">Equipamentos</legend>
        <div className="flex flex-wrap gap-2" data-testid="work-equipment">
          {EQUIPMENT.map((e) => {
            const on = equipment.includes(e.value);
            return (
              <button
                key={e.value}
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => setEquipment(on ? equipment.filter((x) => x !== e.value) : [...equipment, e.value])}
                className={cn(
                  "rounded-full border-2 px-3 py-1.5 text-xs font-semibold transition disabled:opacity-60",
                  on ? "border-agua bg-agua-50 text-petroleo" : "border-grafite/10 text-grafite-500",
                )}
              >
                {e.label}
              </button>
            );
          })}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
        <div>
          <label htmlFor="wp-capacity" className="text-sm font-medium text-grafite">
            Pedidos por dia
          </label>
          <Input
            id="wp-capacity"
            type="number"
            inputMode="numeric"
            min={1}
            max={1000}
            className="mt-1.5"
            disabled={!isOwner}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="wp-experience" className="text-sm font-medium text-grafite">
            Experiência
          </label>
          <Textarea
            id="wp-experience"
            className="mt-1.5"
            rows={2}
            maxLength={300}
            disabled={!isOwner}
            value={experience}
            onChange={(e) => setExperience(e.target.value)}
          />
        </div>
      </div>
      {isOwner && (
        <div className="flex justify-end">
          <Button loading={busy} onClick={() => void save()} data-testid="work-save">
            Salvar perfil de trabalho
          </Button>
        </div>
      )}
    </Card>
  );
}
