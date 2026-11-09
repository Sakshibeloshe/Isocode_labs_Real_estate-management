import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/server/auth";
import NewLeadForm from "./form";

export const metadata: Metadata = { title: "Add a lead" };

export default async function NewLeadPage() {
  await requireUser();
  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/staff/leads" className="text-sm text-ink-3 hover:text-ink">
        Leads
      </Link>
      <h1 className="wide mt-2 text-3xl font-semibold">Add a lead</h1>
      <p className="mt-2 text-ink-2">
        For hoarding calls, walk-ins and portal leads that didn&apos;t arrive by email. We check for duplicates before saving, and send the buyer a chat link if they agreed to be contacted.
      </p>
      <NewLeadForm />
    </div>
  );
}
