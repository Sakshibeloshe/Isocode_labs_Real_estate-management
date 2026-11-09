import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { ensureSlots, releaseExpiredHolds } from "@/lib/server/booking";
import { DAY, fmtDate, istDateKey, istStartOfDay } from "@/lib/time";
import { Panel, cx } from "@/components/ui";
import { ActionButton } from "@/components/staff";
import { removeTemplate } from "../../actions";
import { SlotChip, TemplateForm } from "./controls";

export const metadata: Metadata = { title: "Visit slots" };
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export default async function SlotsPage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  await requireUser(["SALES_HEAD"]);
  const { p } = await searchParams;
  const projects = await db.project.findMany({ orderBy: { id: "asc" } });
  const project = projects.find((x) => x.id === p) ?? projects[0];
  const now = new Date();
  await ensureSlots(db, now, project.id);
  await releaseExpiredHolds(db, now);

  const [templates, slots] = await Promise.all([
    db.slotTemplate.findMany({ where: { projectId: project.id }, orderBy: [{ startMinute: "asc" }, { weekday: "asc" }] }),
    db.slot.findMany({
      where: { projectId: project.id, startsAt: { gte: istStartOfDay(now), lt: new Date(istStartOfDay(now).getTime() + 14 * DAY) } },
      orderBy: { startsAt: "asc" },
    }),
  ]);
  const times = [...new Set(templates.map((t) => t.startMinute))];
  const days = [...new Set(slots.map((s) => istDateKey(s.startsAt)))];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="wide text-3xl font-semibold">Visit slots</h1>
          <p className="mt-1 max-w-2xl text-ink-2">Capacity is how many buyers can visit at once, usually the number of executives on site. Buyers only ever see slots with a free place.</p>
        </div>
        <nav className="flex gap-1.5">
          {projects.map((x) => (
            <Link key={x.id} href={`/staff/admin/slots?p=${x.id}`} className={cx("rounded-full border px-3.5 py-1.5 text-sm", x.id === project.id ? "border-ink bg-ink text-white" : "border-line text-ink-2")}>
              {x.name}
            </Link>
          ))}
        </nav>
      </div>

      <section>
        <h2 className="text-lg font-semibold">Weekly pattern</h2>
        <p className="mt-1 text-sm text-ink-3">New slots are created from this pattern for 30 days ahead.</p>
        <Panel className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-center text-[15px]">
            <thead className="border-b border-line text-sm text-ink-3">
              <tr>
                <th className="px-4 py-2.5 text-left font-normal">Time</th>
                {WD.map((d) => (
                  <th key={d} className="px-2 py-2.5 font-normal">
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="num divide-y divide-line-2">
              {times.map((m) => (
                <tr key={m}>
                  <td className="px-4 py-2 text-left font-medium">{hhmm(m)}</td>
                  {WD.map((_, wd) => {
                    const t = templates.find((x) => x.startMinute === m && x.weekday === wd);
                    return (
                      <td key={wd} className="px-2 py-2">
                        {t ? (
                          <span className="inline-flex items-center gap-1">
                            <span title="places">{t.capacity}</span>
                            <ActionButton action={removeTemplate.bind(null, t.id)} variant="quiet" confirm="Remove?">
                              <span className="sr-only">Remove {WD[wd]} {hhmm(m)}</span>
                              <span aria-hidden className="text-ink-3">×</span>
                            </ActionButton>
                          </span>
                        ) : (
                          <span className="text-line">·</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <TemplateForm projectId={project.id} />
      </section>

      <section>
        <h2 className="text-lg font-semibold">Next two weeks</h2>
        <p className="mt-1 text-sm text-ink-3">Booked / places. Tap a slot to change its places or close it, for example on a holiday.</p>
        <div className="mt-3 space-y-2">
          {days.map((d) => {
            const daySlots = slots.filter((s) => istDateKey(s.startsAt) === d);
            return (
              <div key={d} className="grid items-start gap-2 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3 sm:grid-cols-[120px_minmax(0,1fr)]">
                <p className="num pt-1.5 font-medium">{fmtDate(daySlots[0].startsAt)}</p>
                <div className="flex flex-wrap gap-1.5">
                  {daySlots.map((s) => (
                    <SlotChip key={s.id} slot={{ id: s.id, startsAt: s.startsAt.toISOString(), capacity: s.capacity, reserved: s.reserved, closed: s.closed, past: s.startsAt < now }} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
