"use client";
import { useActionState, useState } from "react";
import { login } from "@/app/staff/actions";
import { Button, Field, Input } from "@/components/ui";

export default function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(login, null);
  // controlled so a wrong password doesn't wipe the email (React resets forms after an action)
  const [email, setEmail] = useState("");
  return (
    <form action={action} className="mt-8 space-y-4">
      <input type="hidden" name="next" value={next} />
      <Field label="Work email">
        <Input name="email" type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Password">
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>
      {state && !state.ok && (
        <p role="alert" className="text-sm text-rose">
          {state.error}
        </p>
      )}
      <Button type="submit" busy={pending} className="w-full">
        Sign in
      </Button>
    </form>
  );
}
