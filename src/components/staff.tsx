"use client";
import { useState, useTransition } from "react";
import type { Result } from "@/app/staff/actions";
import { Button, cx } from "./ui";

/** button that runs a bound server action, with optional two-step confirm and inline result */
export function ActionButton({
  action,
  children,
  variant = "line",
  size = "sm",
  confirm,
  className,
}: {
  action: () => Promise<Result>;
  children: React.ReactNode;
  variant?: "primary" | "line" | "quiet" | "danger";
  size?: "sm" | "md";
  confirm?: string;
  className?: string;
}) {
  const [pending, start] = useTransition();
  const [armed, setArmed] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = () => {
    if (confirm && !armed) {
      setArmed(true);
      setTimeout(() => setArmed(false), 4000);
      return;
    }
    setArmed(false);
    start(async () => {
      const r = await action();
      setMsg(r.ok ? (r.message ? { ok: true, text: r.message } : null) : { ok: false, text: r.error });
      if (r.ok && r.message) setTimeout(() => setMsg(null), 4000);
    });
  };
  return (
    <span className={cx("inline-flex flex-col items-start gap-1", className)}>
      <Button type="button" variant={armed ? "danger" : variant} size={size} busy={pending} onClick={run}>
        {armed ? confirm : children}
      </Button>
      {msg && (
        <span role={msg.ok ? "status" : "alert"} className={cx("text-[13px]", msg.ok ? "text-sage" : "text-rose")}>
          {msg.text}
        </span>
      )}
    </span>
  );
}

export function FormMessage({ state }: { state: Result | null }) {
  if (!state) return null;
  return (
    <p role={state.ok ? "status" : "alert"} className={cx("text-sm", state.ok ? "text-sage" : "text-rose")}>
      {state.ok ? state.message : state.error}
    </p>
  );
}
