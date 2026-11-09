"use client";
import { useActionState, useState } from "react";
import { saveFact } from "../../actions";
import { Button, Field, Input, Select, Tag, Textarea } from "@/components/ui";
import { FormMessage } from "@/components/staff";

type F = { id: string; projectId: string; key: string; label: string; valueEn: string; valueHi: string; valueGu: string; tag: string; published: boolean; meta: string };

export default function FactEditor({ fact, isNew }: { fact: F; isNew?: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(async (prev: Awaited<ReturnType<typeof saveFact>> | null, fd: FormData) => {
    const r = await saveFact(prev, fd);
    if (r.ok) setOpen(false);
    return r;
  }, null);

  if (!open) {
    if (isNew)
      return (
        <div className="px-5 py-3">
          <button className="text-sm font-medium text-indigo" onClick={() => setOpen(true)}>
            Add a fact
          </button>
          <FormMessage state={state} />
        </div>
      );
    return (
      <div className="grid gap-2 px-5 py-4 sm:grid-cols-[200px_minmax(0,1fr)_auto] sm:gap-6">
        <div>
          <p className="font-medium">{fact.label}</p>
          <p className="text-sm text-ink-3">{fact.meta}</p>
        </div>
        <div className="min-w-0">
          <p className="text-[15px] text-ink-2">{fact.valueEn}</p>
          <div className="mt-2 flex flex-wrap gap-1">
            <Tag tone={fact.tag === "RERA_REGISTERED" ? "indigo" : "neutral"}>{fact.tag === "RERA_REGISTERED" ? "RERA registered" : "Marketing"}</Tag>
            {!fact.published && <Tag tone="amber">Draft, not used</Tag>}
            <Tag tone={fact.valueHi ? "sage" : "neutral"}>{fact.valueHi ? "Hindi text" : "Hindi: auto"}</Tag>
            <Tag tone={fact.valueGu ? "sage" : "neutral"}>{fact.valueGu ? "Gujarati text" : "Gujarati: auto"}</Tag>
          </div>
          <FormMessage state={state} />
        </div>
        <div>
          <Button variant="line" size="sm" onClick={() => setOpen(true)}>
            Edit
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4 bg-paper/60 px-5 py-5">
      <input type="hidden" name="id" value={fact.id} />
      <input type="hidden" name="projectId" value={fact.projectId} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Label">
          <Input name="label" defaultValue={fact.label} required maxLength={80} />
        </Field>
        <Field label="Key" hint="Short id the assistant cites">
          <Input name="key" defaultValue={fact.key} required pattern="[a-z0-9_]{2,40}" readOnly={!isNew} className={!isNew ? "bg-line-2" : ""} />
        </Field>
        <Field label="Type">
          <Select name="tag" defaultValue={fact.tag}>
            <option value="RERA_REGISTERED">RERA registered</option>
            <option value="MARKETING">Marketing</option>
          </Select>
        </Field>
      </div>
      <Field label="English">
        <Textarea name="valueEn" defaultValue={fact.valueEn} rows={2} required maxLength={600} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Hindi (optional)" hint="Approved wording; used as is">
          <Textarea name="valueHi" defaultValue={fact.valueHi} rows={2} maxLength={600} lang="hi" />
        </Field>
        <Field label="Gujarati (optional)" hint="Approved wording; used as is">
          <Textarea name="valueGu" defaultValue={fact.valueGu} rows={2} maxLength={600} lang="gu" />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-[15px]">
        <input type="checkbox" name="published" defaultChecked={fact.published} className="size-4 accent-[var(--color-indigo)]" />
        Published (the assistant may use it)
      </label>
      <FormMessage state={state} />
      <div className="flex gap-2">
        <Button type="submit" busy={pending}>
          {isNew ? "Add fact" : "Save"}
        </Button>
        <Button type="button" variant="quiet" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
