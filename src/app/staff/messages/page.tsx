import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { fmtDateTime } from "@/lib/time";
import { OUTBOX_KIND } from "@/lib/labels";
import { maskPhone } from "@/lib/phone";
import { Notice, Panel, Tag, cx } from "@/components/ui";
import { ActionButton } from "@/components/staff";
import { sendDueReminders } from "../actions";

export const metadata: Metadata = { title: "Messages" };

export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  const user = await requireUser();
  const { s } = await searchParams;
  const tab = s === "sent" ? "sent" : "scheduled";
  const scope = user.role === "SALES_HEAD" ? {} : { lead: { ownerId: user.id } };
  const rows = await db.outbox.findMany({
    where: { ...scope, channel: { not: "INTERNAL" }, ...(tab === "scheduled" ? { status: "SCHEDULED" } : { status: { not: "SCHEDULED" } }) },
    orderBy: { sendAt: tab === "scheduled" ? "asc" : "desc" },
    take: 80,
    include: { lead: { select: { id: true, name: true, phoneKey: true } } },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="wide text-3xl font-semibold">Messages</h1>
          <p className="mt-1 text-ink-2">Confirmations and reminders sent to buyers. Each one carries the project&apos;s RERA number and an opt-out line.</p>
        </div>
        <ActionButton action={sendDueReminders}>Send due reminders now</ActionButton>
      </div>
      <Notice>SMS sending is simulated in this demo: messages are recorded here instead of going to a real phone.</Notice>
      <nav className="flex gap-1.5">
        {(["scheduled", "sent"] as const).map((k) => (
          <Link key={k} href={`/staff/messages?s=${k}`} className={cx("rounded-full border px-3.5 py-1.5 text-sm", tab === k ? "border-ink bg-ink text-white" : "border-line text-ink-2")}>
            {k === "scheduled" ? "Scheduled" : "Sent and skipped"}
          </Link>
        ))}
      </nav>
      <Panel className="divide-y divide-line-2">
        {rows.length === 0 && <p className="px-5 py-10 text-center text-ink-3">{tab === "scheduled" ? "No reminders waiting." : "No messages yet."}</p>}
        {rows.map((o) => (
          <div key={o.id} className="px-5 py-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{OUTBOX_KIND[o.kind]}</span>
              <Link href={`/staff/leads/${o.leadId}`} className="text-indigo">
                {o.lead.name ?? o.leadId}
              </Link>
              <span className="num text-ink-3">{maskPhone(o.lead.phoneKey)}</span>
              <Tag tone={o.status === "SENT" ? "sage" : o.status === "SCHEDULED" ? "indigo" : "neutral"}>
                {o.status === "SCHEDULED" ? `Due ${fmtDateTime(o.sendAt)}` : o.status === "SENT" ? `Sent ${fmtDateTime(o.sentAt ?? o.sendAt)}` : o.status.toLowerCase()}
              </Tag>
              {o.note && <span className="text-ink-3">{o.note}</span>}
            </div>
            <p className="mt-1.5 text-[14px] leading-relaxed text-ink-2">{o.body}</p>
          </div>
        ))}
      </Panel>
    </div>
  );
}
