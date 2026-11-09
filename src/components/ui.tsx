import clsx from "clsx";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

export function cx(...a: Parameters<typeof clsx>) {
  return clsx(...a);
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "quiet" | "line" | "danger"; size?: "sm" | "md"; busy?: boolean };

export function Button({ variant = "primary", size = "md", busy, className, children, disabled, ...rest }: BtnProps) {
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-[var(--radius-ctl)] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-55",
        size === "md" ? "h-11 px-4 text-[15px]" : "h-9 px-3 text-sm",
        variant === "primary" && "bg-indigo text-white hover:bg-indigo-2",
        variant === "line" && "border border-line bg-surface text-ink hover:border-ink-3",
        variant === "quiet" && "text-ink-2 hover:bg-line-2 hover:text-ink",
        variant === "danger" && "border border-rose/30 bg-surface text-rose hover:bg-rose-soft",
        className,
      )}
    >
      {busy && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx("size-4 animate-spin", className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink-2">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-sm text-rose">{error}</span> : hint ? <span className="mt-1 block text-sm text-ink-3">{hint}</span> : null}
    </label>
  );
}

const ctl =
  "w-full rounded-[var(--radius-ctl)] border border-line bg-surface px-3 text-[15px] text-ink placeholder:text-ink-3 focus:border-indigo focus:outline-none focus:ring-2 focus:ring-indigo/15";

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cx(ctl, "h-11", className)} />;
}
export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={cx(ctl, "h-11 appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 12 12%22><path d=%22M2 4l4 4 4-4%22 fill=%22none%22 stroke=%22%2378817b%22 stroke-width=%221.5%22/></svg>')] bg-[right_12px_center] bg-no-repeat pr-9", className)}>
      {children}
    </select>
  );
}
export function Textarea({ className, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cx(ctl, "py-2.5 leading-relaxed", className)} />;
}

export function Panel({ className, children, ...rest }: React.HTMLAttributes<HTMLElement>) {
  return (
    <section {...rest} className={cx("rounded-[var(--radius-card)] border border-line bg-surface", className)}>
      {children}
    </section>
  );
}

const TONES = {
  neutral: "bg-line-2 text-ink-2",
  indigo: "bg-indigo-soft text-indigo",
  sage: "bg-sage-soft text-sage",
  amber: "bg-amber-soft text-amber",
  rose: "bg-rose-soft text-rose",
} as const;
export type Tone = keyof typeof TONES;

export function Tag({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx("inline-flex h-6 items-center whitespace-nowrap rounded-full px-2.5 text-[13px] font-medium", TONES[tone], className)}>{children}</span>;
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 px-6 py-12 sm:items-center sm:text-center">
      <p className="text-lg font-medium">{title}</p>
      {children && <p className="max-w-md text-ink-2">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Notice({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <div className={cx("rounded-[var(--radius-ctl)] px-4 py-3 text-[15px]", TONES[tone])}>{children}</div>;
}
