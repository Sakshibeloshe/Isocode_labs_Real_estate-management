"use client";
import { useActionState, useState } from "react";
import Link from "next/link";
import { addLead } from "@/app/staff/actions";
import { Button, Field, Input, Notice, Panel, Select, Textarea } from "@/components/ui";

export default function NewLeadForm() {
  const [state, action, pending] = useActionState(addLead, null);
  const [source, setSource] = useState("HOARDING");

  if (state?.ok && state.leadId) {
    return (
      <Panel className="mt-8 space-y-4 p-6">
        {state.outcome === "LINKED" && (
          <Notice tone="indigo">
            This buyer is already in the list, so we added this enquiry to <b>{state.leadId}</b> instead of creating a second lead.
          </Notice>
        )}
        {state.outcome === "POSSIBLE_DUPLICATE" && (
          <Notice tone="amber">
            Saved as {state.leadId}. The name looks like {state.matched} on the same project with a different number; check and link them from the lead page.
          </Notice>
        )}
        {state.outcome === "CREATED" && <Notice tone="sage">Saved as {state.leadId}.</Notice>}
        <div className="flex gap-3">
          <Link href={`/staff/leads/${state.leadId}`} className="inline-flex h-11 items-center rounded-[var(--radius-ctl)] bg-indigo px-4 font-medium text-white">
            Open lead
          </Link>
          <Link href="/staff/leads/new" onClick={() => location.reload()} className="inline-flex h-11 items-center rounded-[var(--radius-ctl)] border border-line px-4">
            Add another
          </Link>
        </div>
      </Panel>
    );
  }

  return (
    <form action={action} className="mt-8 space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Buyer's name">
          <Input name="name" required minLength={2} maxLength={80} autoComplete="off" />
        </Field>
        <Field label="Mobile number" hint="Used to check for duplicates">
          <Input name="phone" inputMode="tel" placeholder="98250 12345" maxLength={20} />
        </Field>
        <Field label="Email (optional)">
          <Input name="email" type="email" maxLength={120} />
        </Field>
        <Field label="Source">
          <Select name="source" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="HOARDING">Hoarding call</option>
            <option value="PORTAL">Property portal</option>
            <option value="SOCIAL_AD">Social media ad</option>
            <option value="WEBSITE">Website</option>
          </Select>
        </Field>
        <Field label="Project">
          <Select name="projectId" required defaultValue="P1">
            <option value="P1">Project 1</option>
            <option value="P2">Project 2</option>
          </Select>
        </Field>
        <Field label="Looking for">
          <Select name="bhk" defaultValue="">
            <option value="">Not known</option>
            <option>2 BHK</option>
            <option>3 BHK</option>
          </Select>
        </Field>
        <Field label="Language">
          <Select name="language" defaultValue="GU">
            <option value="GU">Gujarati</option>
            <option value="HI">Hindi</option>
            <option value="EN">English</option>
          </Select>
        </Field>
        <Field label="Campaign or portal (optional)">
          <Input name="campaign" maxLength={80} placeholder={source === "PORTAL" ? "e.g. 99acres" : source === "HOARDING" ? "e.g. SG Highway" : ""} />
        </Field>
      </div>
      <Field label="Note (optional)">
        <Textarea name="note" rows={2} maxLength={500} />
      </Field>
      <fieldset className="space-y-3 rounded-[var(--radius-card)] border border-line bg-surface p-4">
        <label className="flex items-start gap-3">
          <input type="checkbox" name="consent" defaultChecked className="mt-1 size-4 accent-[var(--color-indigo)]" />
          <span>
            Buyer agreed to be contacted about this enquiry
            <span className="block text-sm text-ink-3">Needed before any SMS or reminder is sent (DPDP Act).</span>
          </span>
        </label>
        <label className="flex items-start gap-3">
          <input type="checkbox" name="contacted" defaultChecked={source === "HOARDING"} key={source} className="mt-1 size-4 accent-[var(--color-indigo)]" />
          <span>
            I&apos;ve already spoken to them
            <span className="block text-sm text-ink-3">Counts as reached now. Leave unticked to send them a chat link instead.</span>
          </span>
        </label>
      </fieldset>
      {state && !state.ok && (
        <p role="alert" className="text-sm text-rose">
          {state.error}
        </p>
      )}
      <Button type="submit" busy={pending}>
        Save lead
      </Button>
    </form>
  );
}
