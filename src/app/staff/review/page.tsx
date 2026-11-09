import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { fmtDateTime, relativeTime } from "@/lib/time";
import { FLAG_REASON } from "@/lib/labels";
import { Empty, Panel, Tag, cx } from "@/components/ui";
import { ActionButton } from "@/components/staff";
import { reviewFlag } from "../actions";

export const metadata: Metadata = { title: "Review chats" };

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  await requireUser(["SALES_HEAD"]);
  const { done } = await searchParams;
  const showDone = done === "1";
  const flags = await db.flag.findMany({
    where: showDone ? { verdict: { not: "PENDING" } } : { verdict: "PENDING" },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      lead: { select: { id: true, name: true } },
      conversation: { include: { messages: { orderBy: { createdAt: "asc" }, take: 12 } } },
    },
  });
  const now = new Date();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="wide text-3xl font-semibold">Review chats</h1>
          <p className="mt-1 max-w-2xl text-ink-2">Chats the assistant flagged: questions it couldn&apos;t answer, replies it stopped itself from sending, and attempts to bend its rules. Reviewing daily keeps the fact sheet complete.</p>
        </div>
        <nav className="flex gap-1.5">
          <Link href="/staff/review" className={cx("rounded-full border px-3.5 py-1.5 text-sm", !showDone ? "border-ink bg-ink text-white" : "border-line text-ink-2")}>
            To review
          </Link>
          <Link href="/staff/review?done=1" className={cx("rounded-full border px-3.5 py-1.5 text-sm", showDone ? "border-ink bg-ink text-white" : "border-line text-ink-2")}>
            Reviewed
          </Link>
        </nav>
      </div>

      {flags.length === 0 ? (
        <Panel>
          <Empty title={showDone ? "Nothing reviewed yet" : "All caught up"}>{showDone ? "" : "New flags appear here as buyers chat."}</Empty>
        </Panel>
      ) : (
        <div className="space-y-4">
          {flags.map((f) => (
            <Panel key={f.id} className="p-5">
              <div className="flex flex-wrap items-center gap-2">
                <Tag tone={f.reason === "OUTPUT_BLOCKED" || f.reason === "DISTRESS" ? "rose" : f.reason === "MISSING_FACT" ? "amber" : "neutral"}>{FLAG_REASON[f.reason]}</Tag>
                <span className="text-sm text-ink-3">{relativeTime(f.createdAt, now)}</span>
                {f.lead && (
                  <Link href={`/staff/leads/${f.lead.id}`} className="text-sm font-medium text-indigo">
                    {f.lead.name ?? f.lead.id}
                  </Link>
                )}
                {f.verdict !== "PENDING" && <Tag tone="sage">{f.verdict === "FINE" ? "Fine" : f.verdict === "FIX_FACT_SHEET" ? "Fact sheet to fix" : "Behaviour to fix"}</Tag>}
              </div>
              <p className="mt-2 font-medium">{f.detail}</p>
              {f.excerpt && (
                <blockquote className="mt-2 border-l-2 border-line pl-3 text-[15px] text-ink-2">
                  {f.reason === "OUTPUT_BLOCKED" ? "Stopped reply: " : ""}
                  {f.excerpt}
                </blockquote>
              )}
              <details className="mt-3">
                <summary className="cursor-pointer text-sm text-ink-3">Chat around it</summary>
                <div className="mt-2 space-y-1.5 text-[14px]">
                  {f.conversation.messages.map((m) => (
                    <p key={m.id}>
                      <span className="text-ink-3">{m.role === "BUYER" ? "Buyer" : "Assistant"} · {fmtDateTime(m.createdAt)}: </span>
                      {m.content || "(card)"}
                    </p>
                  ))}
                </div>
              </details>
              {f.verdict === "PENDING" && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <ActionButton action={reviewFlag.bind(null, f.id, "FINE")}>Handled fine</ActionButton>
                  <ActionButton action={reviewFlag.bind(null, f.id, "FIX_FACT_SHEET")}>Add to fact sheet</ActionButton>
                  <ActionButton action={reviewFlag.bind(null, f.id, "FIX_BEHAVIOUR")}>Assistant got it wrong</ActionButton>
                  {f.reason === "MISSING_FACT" && (
                    <Link href="/staff/admin/facts" className="self-center text-sm font-medium text-indigo">
                      Open fact sheet
                    </Link>
                  )}
                </div>
              )}
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
