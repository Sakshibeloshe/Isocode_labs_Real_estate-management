import type { Metadata } from "next";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { DAY, fmtDate, fmtDateLong, fmtTime, istStartOfDay } from "@/lib/time";
import { LANGUAGE } from "@/lib/labels";
import { Empty, Panel, Tag } from "@/components/ui";
import { ActionButton } from "@/components/staff";
import { markOutcomeAction } from "../actions";

export const metadata: Metadata = { title: "Visits" };

export default async function VisitsPage() {
  const user = await requireUser();
  const now = new Date();
  const today = istStartOfDay(now);
  const mine: Prisma.VisitWhereInput = user.role === "SALES_HEAD" ? {} : { OR: [{ executiveId: user.id }, { lead: { ownerId: user.id } }] };

  const visits = await db.visit.findMany({
    where: { ...mine, status: "BOOKED", slot: { startsAt: { lt: new Date(today.getTime() + 8 * DAY) } } },
    include: { slot: { include: { project: true } }, lead: true, executive: true },
    orderBy: { slot: { startsAt: "asc" } },
  });

  const groups: { title: string; note?: string; items: typeof visits; past?: boolean }[] = [
    { title: "Needs an outcome", note: "These visits have happened. Mark who came so show-up rate and cost per visit stay true.", items: visits.filter((v) => v.slot.startsAt < now && v.slot.startsAt < today), past: true },
    { title: `Today, ${fmtDateLong(now)}`, items: visits.filter((v) => v.slot.startsAt >= today && v.slot.startsAt < new Date(today.getTime() + DAY)) },
    { title: "Tomorrow", items: visits.filter((v) => v.slot.startsAt >= new Date(today.getTime() + DAY) && v.slot.startsAt < new Date(today.getTime() + 2 * DAY)) },
    { title: "Later this week", items: visits.filter((v) => v.slot.startsAt >= new Date(today.getTime() + 2 * DAY)) },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="wide text-3xl font-semibold">Visits</h1>
        <p className="mt-1 text-ink-2">{user.role === "SALES_HEAD" ? "Every booked site visit for the next week." : "Visits you're hosting or whose buyer you own."}</p>
      </div>

      {visits.length === 0 && (
        <Panel>
          <Empty title="No visits in the next week">When a buyer books from the chat, or you book for them from a lead, it shows up here.</Empty>
        </Panel>
      )}

      {groups
        .filter((g) => g.items.length)
        .map((g) => (
          <section key={g.title}>
            <h2 className="text-lg font-semibold">
              {g.title} <span className="num font-normal text-ink-3">{g.items.length}</span>
            </h2>
            {g.note && <p className="mt-1 text-sm text-ink-3">{g.note}</p>}
            <Panel className="mt-3 divide-y divide-line-2">
              {g.items.map((v) => {
                const started = v.slot.startsAt.getTime() - 30 * 60_000 <= now.getTime();
                return (
                  <div key={v.id} className="grid gap-3 px-5 py-4 sm:grid-cols-[110px_minmax(0,1fr)_auto] sm:items-center">
                    <div className="num">
                      <div className="text-lg font-semibold">{fmtTime(v.slot.startsAt)}</div>
                      {g.past && <div className="text-sm text-ink-3">{fmtDate(v.slot.startsAt)}</div>}
                    </div>
                    <div className="min-w-0">
                      <Link href={`/staff/leads/${v.leadId}`} className="font-medium hover:underline">
                        {v.lead.name ?? v.leadId}
                      </Link>
                      <p className="text-sm text-ink-3">
                        {v.slot.project.name} · {v.lead.bhk ?? "BHK not given"} · {LANGUAGE[v.lead.language]}
                        {user.role === "SALES_HEAD" && ` · host ${v.executive?.name.split(" ")[0] ?? "—"}`}
                      </p>
                      {v.lead.budget && <p className="text-sm text-ink-3">Budget {v.lead.budget}</p>}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {v.lead.phoneKey && (
                        <a href={`tel:+91${v.lead.phoneKey}`} className="text-sm font-medium text-indigo">
                          Call
                        </a>
                      )}
                      {started ? (
                        <>
                          <ActionButton action={markOutcomeAction.bind(null, v.id, "VISITED")} variant="primary">
                            Visited
                          </ActionButton>
                          <ActionButton action={markOutcomeAction.bind(null, v.id, "NO_SHOW")}>No-show</ActionButton>
                        </>
                      ) : (
                        <Tag tone={v.lead.consentAt && !v.lead.optedOutAt ? "indigo" : "neutral"}>{v.lead.consentAt && !v.lead.optedOutAt ? "Reminders on" : "No reminders"}</Tag>
                      )}
                    </div>
                  </div>
                );
              })}
            </Panel>
          </section>
        ))}
    </div>
  );
}
