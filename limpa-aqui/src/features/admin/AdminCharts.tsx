import { useEffect, useRef, useState, type ReactNode } from "react";

/** Cor única das séries (passa no validador de paleta no fundo claro). */
export const SERIES = "#1395A1";
const TRACK = "rgba(37, 52, 58, 0.08)";
const GRID = "rgba(37, 52, 58, 0.08)";
const INK_MUTED = "#5B6B71";

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Arredonda o topo do eixo para um número "redondo". */
function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}

/** Anel de progresso (rosca) com o percentual no meio. */
export function ProgressRing({ value, total, label, detail, testId }: { value: number; total: number; label: string; detail: string; testId?: string }) {
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-grafite/5" data-testid={testId}>
      <div className="relative h-20 w-20 shrink-0" title={`${value} de ${total}`}>
        <svg viewBox="0 0 80 80" className="h-20 w-20 -rotate-90" role="img" aria-label={`${label}: ${pct}%`}>
          <circle cx="40" cy="40" r={r} fill="none" stroke={TRACK} strokeWidth="8" />
          {pct > 0 && (
            <circle cx="40" cy="40" r={r} fill="none" stroke={SERIES} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${(pct / 100) * c} ${c}`} />
          )}
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-base font-bold text-petroleo">{pct}%</span>
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-petroleo">{label}</p>
        <p className="mt-0.5 text-xs text-grafite-500">{detail}</p>
      </div>
    </div>
  );
}

export type Point = { label: string; value: number };

function Tooltip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  const left = Math.max(4, Math.min(x - 70, width - 144));
  return (
    <div
      className="pointer-events-none absolute z-10 w-[140px] rounded-lg bg-petroleo px-3 py-2 text-xs text-white shadow-lg"
      style={{ left, top: Math.max(0, y - 58) }}
      role="status"
    >
      {children}
    </div>
  );
}

type ChartProps = { points: Point[]; format: (v: number) => string; axisFormat?: (v: number) => string; unitLabel: string; height?: number; testId?: string };

const PAD = { top: 12, right: 8, bottom: 26, left: 44 };

function Axes({ w, h, max, format, points, xOf }: { w: number; h: number; max: number; format: (v: number) => string; points: Point[]; xOf: (i: number) => number }) {
  const ticks = [0, 0.5, 1].map((t) => t * max);
  const ih = h - PAD.top - PAD.bottom;
  const every = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor((w - PAD.left) / 56))));
  return (
    <>
      {ticks.map((t) => {
        const y = PAD.top + ih - (t / max) * ih;
        return (
          <g key={t}>
            <line x1={PAD.left} x2={w - PAD.right} y1={y} y2={y} stroke={GRID} />
            <text x={PAD.left - 6} y={y + 4} textAnchor="end" fontSize="10" fill={INK_MUTED}>
              {format(t)}
            </text>
          </g>
        );
      })}
      {points.map((p, i) =>
        i % every === 0 ? (
          <text key={p.label + i} x={xOf(i)} y={h - 8} textAnchor="middle" fontSize="10" fill={INK_MUTED}>
            {p.label}
          </text>
        ) : null,
      )}
    </>
  );
}

/** Barras verticais finas com topo arredondado e dica ao passar o mouse/tocar. */
export function BarChart({ points, format, axisFormat, unitLabel, height = 200, testId }: ChartProps) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  // contagens: topo par, para a marca do meio também ser um número inteiro
  const top = niceMax(Math.max(...points.map((p) => p.value), 0));
  const max = Math.max(2, Math.ceil(top / 2) * 2);
  const iw = Math.max(0, w - PAD.left - PAD.right);
  const ih = height - PAD.top - PAD.bottom;
  const slot = points.length ? iw / points.length : 0;
  const bw = Math.max(4, Math.min(24, slot - 4));
  const xOf = (i: number) => PAD.left + slot * i + slot / 2;
  return (
    <div ref={ref} className="relative" data-testid={testId} onMouseLeave={() => setHover(null)}>
      {w > 0 && (
        <svg width={w} height={height} role="img" aria-label={`Gráfico de barras: ${unitLabel}`}>
          <Axes w={w} h={height} max={max} format={axisFormat ?? format} points={points} xOf={xOf} />
          {points.map((p, i) => {
            const bh = (p.value / max) * ih;
            const x = xOf(i) - bw / 2;
            const y = PAD.top + ih - bh;
            const r = Math.min(4, bw / 2, bh);
            return (
              <g key={i}>
                {bh > 0 && (
                  <path
                    d={`M${x},${PAD.top + ih} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${PAD.top + ih} Z`}
                    fill={SERIES}
                    opacity={hover === null || hover === i ? 1 : 0.45}
                  />
                )}
                {/* área de toque maior que a barra */}
                <rect
                  x={PAD.left + slot * i}
                  y={PAD.top}
                  width={slot}
                  height={ih}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  onClick={() => setHover(i)}
                  data-testid={testId ? `${testId}-hit` : undefined}
                />
              </g>
            );
          })}
        </svg>
      )}
      {hover !== null && points[hover] && (
        <Tooltip x={xOf(hover)} y={PAD.top + ih - (points[hover].value / max) * ih} width={w}>
          <p className="text-white/70">{points[hover].label}</p>
          <p className="font-semibold">
            {format(points[hover].value)} {unitLabel}
          </p>
        </Tooltip>
      )}
    </div>
  );
}

/** Linha de 2px com área suave e marcador + linha guia no ponto sob o mouse. */
export function LineChart({ points, format, axisFormat, unitLabel, height = 200, testId }: ChartProps) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(...points.map((p) => p.value), 0));
  const iw = Math.max(0, w - PAD.left - PAD.right);
  const ih = height - PAD.top - PAD.bottom;
  const xOf = (i: number) => PAD.left + (points.length > 1 ? (iw * i) / (points.length - 1) : iw / 2);
  const yOf = (v: number) => PAD.top + ih - (v / max) * ih;
  const line = points.map((p, i) => `${i ? "L" : "M"}${xOf(i)},${yOf(p.value)}`).join(" ");
  const area = points.length ? `${line} L${xOf(points.length - 1)},${PAD.top + ih} L${xOf(0)},${PAD.top + ih} Z` : "";

  function onMove(e: React.MouseEvent<SVGRectElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - box.left;
    const i = points.length > 1 ? Math.round((x / box.width) * (points.length - 1)) : 0;
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  }

  return (
    <div ref={ref} className="relative" data-testid={testId} onMouseLeave={() => setHover(null)}>
      {w > 0 && (
        <svg width={w} height={height} role="img" aria-label={`Gráfico de linha: ${unitLabel}`}>
          <defs>
            <linearGradient id="lc-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={SERIES} stopOpacity="0.18" />
              <stop offset="100%" stopColor={SERIES} stopOpacity="0" />
            </linearGradient>
          </defs>
          <Axes w={w} h={height} max={max} format={axisFormat ?? format} points={points} xOf={xOf} />
          {area && <path d={area} fill="url(#lc-fill)" />}
          <path d={line} fill="none" stroke={SERIES} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {hover !== null && points[hover] && (
            <>
              <line x1={xOf(hover)} x2={xOf(hover)} y1={PAD.top} y2={PAD.top + ih} stroke={INK_MUTED} strokeDasharray="3 3" />
              <circle cx={xOf(hover)} cy={yOf(points[hover].value)} r="5" fill={SERIES} stroke="white" strokeWidth="2" />
            </>
          )}
          <rect
            x={PAD.left}
            y={PAD.top}
            width={iw}
            height={ih}
            fill="transparent"
            onMouseMove={onMove}
            onClick={onMove}
            data-testid={testId ? `${testId}-hit` : undefined}
          />
        </svg>
      )}
      {hover !== null && points[hover] && (
        <Tooltip x={xOf(hover)} y={yOf(points[hover].value)} width={w}>
          <p className="text-white/70">{points[hover].label}</p>
          <p className="font-semibold">
            {format(points[hover].value)} {unitLabel}
          </p>
        </Tooltip>
      )}
    </div>
  );
}
