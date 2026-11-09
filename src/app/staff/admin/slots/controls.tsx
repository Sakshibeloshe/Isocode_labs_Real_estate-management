"use client";
import { useActionState, useState, useTransition } from "react";
import { addTemplate, updateSlot } from "../../actions";
import { Button, Field, Input, cx } from "@/components/ui";
import { FormMessage } from "@/components/staff";
import { fmtTime } from "@/lib/time";

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function TemplateForm({ projectId }: { projectId: string }) {
  const [state, action, pending] = useActionState(addTemplate, null);
  return (
    <form action={action} className="mt-3 rounded-[var(--radius-card)] border border-line bg-surface p-4">
      <input type="hidden" name="projectId" value={projectId} />
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Time">
          <Input name="time" type="time" step={1800} defaultValue="18:00" required className="w-32" />
        </Field>
        <Field label="Places">
          <Input name="capacity" type="number" min={1} max={20} defaultValue={2} required className="w-24" />
        </Field>
        <fieldset className="flex flex-wrap gap-1.5">
          <legend className="mb-1.5 text-sm font-medium text-ink-2">Days</legend>
          {WD.map((d, i) => (
            <label key={d} className="cursor-pointer">
              <input type="checkbox" name="weekday" value={i} defaultChecked className="peer sr-only" />
              <span className="inline-block rounded-full border border-line px-3 py-1.5 text-sm text-ink-3 peer-checked:border-indigo peer-checked:bg-indigo-soft peer-checked:text-indigo peer-focus-visible:outline-2 peer-focus-visible:outline-indigo">
                {d}
              </span>
            </label>
          ))}
        </fieldset>
        <Button type="submit" busy={pending}>
          Add or update time
        </Button>
      </div>
      <div className="mt-2">
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function SlotChip({ slot }: { slot: { id: string; startsAt: string; capacity: number; reserved: number; closed: boolean; past: boolean } }) {
  const [open, setOpen] = useState(false);
  const [cap, setCap] = useState(slot.capacity);
  const [closed, setClosed] = useState(slot.closed);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const full = slot.reserved >= slot.capacity;
  const label = fmtTime(new Date(slot.startsAt));

  if (open)
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-ctl)] border border-indigo bg-indigo-soft/40 px-2.5 py-1.5">
        <span className="num text-sm font-medium">{label}</span>
        <label className="flex items-center gap-1 text-sm">
          Places
          <input type="number" min={0} max={20} value={cap} onChange={(e) => setCap(Number(e.target.value))} className="num h-8 w-14 rounded-md border border-line bg-surface px-1.5" />
        </label>
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} className="accent-[var(--color-indigo)]" /> Closed
        </label>
        <Button
          size="sm"
          busy={pending}
          onClick={() =>
            start(async () => {
              const r = await updateSlot(slot.id, cap, closed);
              if (r.ok) {
                setOpen(false);
                setErr(null);
              } else setErr(r.error);
            })
          }
        >
          Save
        </Button>
        <button className="text-sm text-ink-3" onClick={() => setOpen(false)}>
          Cancel
        </button>
        {err && <span className="w-full text-[13px] text-rose">{err}</span>}
      </div>
    );

  return (
    <button
      disabled={slot.past}
      onClick={() => setOpen(true)}
      title={slot.closed ? "Closed" : `${slot.reserved} booked of ${slot.capacity}`}
      className={cx(
        "num rounded-[var(--radius-ctl)] border px-2.5 py-1.5 text-sm transition-colors disabled:opacity-40",
        slot.closed ? "border-line bg-line-2 text-ink-3 line-through" : full ? "border-indigo bg-indigo text-white" : slot.reserved ? "border-indigo/40 bg-indigo-soft text-indigo" : "border-line text-ink-2 hover:border-ink-3",
      )}
    >
      {label} <span className="opacity-70">{slot.reserved}/{slot.capacity}</span>
    </button>
  );
}
