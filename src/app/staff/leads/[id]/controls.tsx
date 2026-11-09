"use client";
import { useState, useTransition } from "react";
import { closeLead, reassignLead } from "../../actions";
import { Button, Input, Select } from "@/components/ui";

export function Reassign({ leadId, ownerId, execs }: { leadId: string; ownerId: string | null; execs: { id: string; name: string; role: string }[] }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div>
      <Select
        aria-label="Owner"
        defaultValue={ownerId ?? ""}
        disabled={pending}
        onChange={(e) =>
          start(async () => {
            const r = await reassignLead(leadId, e.target.value);
            setMsg(r.ok ? r.message ?? "Saved" : r.error);
          })
        }
      >
        {execs.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
            {e.role === "SALES_HEAD" ? " (sales head)" : ""}
          </option>
        ))}
      </Select>
      {msg && <p className="mt-1 text-sm text-ink-3">{msg}</p>}
    </div>
  );
}

export function CloseLead({ leadId }: { leadId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!open)
    return (
      <Button variant="quiet" size="sm" onClick={() => setOpen(true)}>
        Close lead
      </Button>
    );
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await closeLead(leadId, reason);
          if (!r.ok) setErr(r.error);
        });
      }}
    >
      <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason, e.g. bought elsewhere" maxLength={120} required autoFocus list="close-reasons" />
      <datalist id="close-reasons">
        <option>Bought elsewhere</option>
        <option>Budget too low</option>
        <option>Not interested</option>
        <option>Wrong number</option>
      </datalist>
      {err && <p className="text-sm text-rose">{err}</p>}
      <div className="flex gap-2">
        <Button size="sm" type="submit" busy={pending}>
          Close lead
        </Button>
        <Button size="sm" variant="quiet" type="button" onClick={() => setOpen(false)}>
          Keep open
        </Button>
      </div>
    </form>
  );
}
