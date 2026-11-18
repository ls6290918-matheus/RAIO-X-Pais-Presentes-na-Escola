import {
  forwardRef,
  useEffect,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { AlertCircle, CheckCircle2, Loader2, X } from "lucide-react";

export const cn = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");

/* ------------------------------------------------------------------ Button */
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "dark" | "outline" | "ghost";
  loading?: boolean;
  block?: boolean;
};

/** Classes do botão, para usar também em links (<Link className={buttonClass()}>). */
export function buttonClass(variant: NonNullable<ButtonProps["variant"]> = "primary", block?: boolean) {
  const styles = {
    primary: "bg-agua text-petroleo hover:bg-agua-600 focus-visible:ring-agua/50",
    dark: "bg-petroleo text-white hover:bg-petroleo-600 focus-visible:ring-petroleo/40",
    outline: "border border-grafite/15 bg-white text-grafite hover:bg-nevoa focus-visible:ring-grafite/20",
    ghost: "text-grafite hover:bg-nevoa focus-visible:ring-grafite/20",
  }[variant];
  return cn(
    "inline-flex h-11 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold transition",
    "focus-visible:outline-none focus-visible:ring-4 disabled:cursor-not-allowed disabled:opacity-60",
    styles,
    block && "w-full",
  );
}

export function Button({ variant = "primary", loading, block, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button className={cn(buttonClass(variant, block), className)} disabled={disabled || loading} {...rest}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ Field */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-grafite">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs font-medium text-red-600" role="alert">
          {error}
        </p>
      ) : hint ? (
        <div className="text-xs text-grafite-500">{hint}</div>
      ) : null}
    </div>
  );
}

const inputBase =
  "h-11 w-full rounded-xl border bg-white px-3.5 text-sm text-grafite placeholder:text-grafite-300 transition " +
  "focus:outline-none focus:ring-4 disabled:bg-nevoa disabled:text-grafite-500";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function Input({ className, invalid, ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          inputBase,
          invalid ? "border-red-400 focus:ring-red-100" : "border-grafite/15 focus:border-agua focus:ring-agua/20",
          className,
        )}
        aria-invalid={invalid || undefined}
        {...rest}
      />
    );
  },
);

export function Select({
  className,
  invalid,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select
      className={cn(
        inputBase,
        invalid ? "border-red-400 focus:ring-red-100" : "border-grafite/15 focus:border-agua focus:ring-agua/20",
        className,
      )}
      aria-invalid={invalid || undefined}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Textarea({
  className,
  invalid,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      className={cn(
        "min-h-[88px] w-full rounded-xl border bg-white px-3.5 py-2.5 text-sm text-grafite placeholder:text-grafite-300 transition",
        "focus:outline-none focus:ring-4 disabled:bg-nevoa disabled:text-grafite-500",
        invalid ? "border-red-400 focus:ring-red-100" : "border-grafite/15 focus:border-agua focus:ring-agua/20",
        className,
      )}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
}

/* ------------------------------------------------------------------ Alert */
export function Alert({ kind = "error", children }: { kind?: "error" | "success"; children: ReactNode }) {
  const isError = kind === "error";
  const Icon = isError ? AlertCircle : CheckCircle2;
  return (
    <div
      role={isError ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-sm",
        isError ? "bg-red-50 text-red-700" : "bg-agua-50 text-petroleo",
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ Card */
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("rounded-2xl border border-grafite/5 bg-white shadow-card", className)}>{children}</div>;
}

export function StatCard({
  label,
  value,
  icon,
  note,
}: {
  label: string;
  value: ReactNode;
  icon: ReactNode;
  note?: string;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-grafite-500">{label}</span>
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-agua-50 text-petroleo">{icon}</span>
      </div>
      <div className="mt-3 text-2xl font-semibold tracking-tight text-petroleo">{value}</div>
      {note && <p className="mt-1 text-xs text-grafite-500">{note}</p>}
    </Card>
  );
}

/* ------------------------------------------------------------------ Badge */
export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
        tone === "accent" ? "bg-agua-50 text-petroleo" : "bg-white/10 text-white/70",
      )}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ EmptyState */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-agua-50 text-petroleo">{icon}</div>
      <h3 className="mt-4 text-base font-semibold text-petroleo">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-grafite-500">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ Loading */
export function FullScreenLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-nevoa" aria-busy="true">
      <Loader2 className="h-7 w-7 animate-spin text-petroleo" aria-label="Carregando" />
    </div>
  );
}

/* ------------------------------------------------------------------ Logo */
export function Logo({ light = false }: { light?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden>
        <rect width="32" height="32" rx="8" fill={light ? "#163B46" : "#102C35"} />
        <path d="M9 20c3 2 11 2 14-1" stroke="#61D6C3" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        <circle cx="12" cy="11" r="2.5" fill="#61D6C3" />
        <circle cx="19" cy="9" r="1.6" fill="#61D6C3" opacity=".7" />
        <circle cx="22" cy="14" r="1.2" fill="#61D6C3" opacity=".5" />
      </svg>
      <span className={cn("text-lg font-bold tracking-tight", light ? "text-white" : "text-petroleo")}>
        Limpa<span className="text-agua"> Aqui</span>
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ PageHeader */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-petroleo">{title}</h1>
        {description && <p className="mt-1 text-sm text-grafite-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/* ------------------------------------------------------------------ Modal */
export function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, onClose]);

  if (!open) return null;
  // Portal: o modal pode ser aberto de dentro de outro formulário sem aninhar <form> no HTML
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-petroleo/60" onClick={onClose} />
      <div className="relative max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-6 shadow-card sm:max-w-lg sm:rounded-2xl">
        <div className="mb-5 flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold text-petroleo">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-grafite-500 hover:bg-nevoa" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ Spinner */
export function InlineLoader() {
  return (
    <div className="flex justify-center py-12" aria-busy="true">
      <Loader2 className="h-6 w-6 animate-spin text-petroleo" aria-label="Carregando" />
    </div>
  );
}
