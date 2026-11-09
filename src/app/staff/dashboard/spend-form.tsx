"use client";
import { useActionState } from "react";
import { saveSpend } from "../actions";
import { Button, Field, Input, Select } from "@/components/ui";
import { FormMessage } from "@/components/staff";

export default function SpendForm({ months }: { months: string[] }) {
  const [state, action, pending] = useActionState(saveSpend, null);
  return (
    <form action={action} className="mt-3 grid items-end gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-5 sm:grid-cols-[1fr_1fr_1fr_auto]">
      <Field label="Month">
        <Select name="month">
          {months.map((m) => (
            <option key={m} value={m}>
              {new Date(`${m}-15T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Source">
        <Select name="source">
          <option value="PORTAL">Property portal</option>
          <option value="SOCIAL_AD">Social media ad</option>
          <option value="WEBSITE">Website</option>
          <option value="HOARDING">Hoarding</option>
        </Select>
      </Field>
      <Field label="Amount (₹)">
        <Input name="amount" inputMode="numeric" pattern="\d+" required placeholder="1400000" />
      </Field>
      <Button type="submit" busy={pending}>
        Save spend
      </Button>
      <div className="sm:col-span-4">
        <FormMessage state={state} />
      </div>
    </form>
  );
}
