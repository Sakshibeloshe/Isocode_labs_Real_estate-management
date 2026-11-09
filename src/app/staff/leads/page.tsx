import type { Metadata } from "next";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireUser, leadScope } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { phoneKey, formatPhone } from "@/lib/phone";
import { fmtDuration, relativeTime } from "@/lib/time";
import { LANGUAGE, LEAD_STATUS, SOURCE } from "@/lib/labels";
import { Empty, Notice, Panel, Tag, cx } from "@/components/ui";
import Filters from "./filters";

export const metadata: Metadata = { title: "Leads" };

type SP = { view?: string; q?: string; source?: string; project?: string; status?: string; denied?: string };

export default async function LeadsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const view = sp.view === "all" || sp.view === "duplicates" ? sp.view : "action";
  const scope = leadScope(user);

  const actionWhere: Prisma.LeadWhereInput = {
    ...scope,
    OR: [
      { handoffs: { some: { acknowledgedAt: null } } },
      { status: "NEW" },
      { dupStatus: "POSSIBLE" },
      { visits: { some: { status: "BOOKED", slot: { startsAt: { lt: new Date() } } } } },
    ],
  };
  const where: Prisma.LeadWhereInput = view === "action" ? actionWhere : view === "duplicates" ? { ...scope, dupStatus: "POSSIBLE" } : { ...scope };

  const and: Prisma.LeadWhereInput[] = [];
  if (sp.q?.trim()) {
    const q = sp.q.trim();
    const pk = phoneKey(q) ?? (q.replace(/\D/g, "").length >= 4 ? q.replace(/\D/g, "") : null);
    and.push({
      OR: [{ name: { contains: q, mode: "insensitive" } }, { id: { contains: q.toUpperCase() } }, { email: { contains: q.toLowerCase() } }, ...(pk ? [{ phoneKey: { contains: pk } }] : [])],
    });
  }
  if (sp.source && sp.source in SOURCE) and.push({ touches: { some: { source: sp.source as never } } });
  if (sp.project === "P1" || sp.project === "P2") and.push({ projectId: sp.project });
  if (sp.status && sp.status in LEAD_STATUS) and.push({ status: sp.status as never });
  if (and.length) where.AND = and;

  const [leads, total, counts] = await Promise.all([
    db.lead.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        project: { select: { name: true } },
        owner: { select: { name: true } },
        touches: { select: { source: true } },
        handoffs: { where: { acknowledgedAt: null }, select: { id: true } },
        visits: { where: { status: { in: ["BOOKED", "HELD"] } }, include: { slot: { select: { startsAt: true } } } },
      },
    }),
    db.lead.count({ where }),
    Promise.all([db.lead.count({ where: actionWhere }), db.lead.count({ where: { ...scope, dupStatus: "POSSIBLE" } }), db.lead.count({ where: scope })]),
  ]);
  const [nAction, nDup, nAll] = counts;
  const now = new Date();

  const tabs = [
    { id: "action", label: "Needs action", n: nAction },
    { id: "all", label: "All leads", n: nAll },
    { id: "duplicates", label: "Possible duplicates", n: nDup },
  ];

  return (
    <div className="space-y-6">
      {sp.denied && <Notice tone="amber">That page is for the sales head.</Notice>}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="wide text-3xl font-semibold">Leads</h1>
          <p className="mt-1 text-ink-2">{user.role === "SALES_HEAD" ? "Every enquiry from every source, in one list." : "Leads assigned to you."}</p>
        </div>
        <Link href="/staff/leads/new" className="inline-flex h-11 items-center rounded-[var(--radius-ctl)] bg-indigo px-4 text-[15px] font-medium text-white hover:bg-indigo-2">
          Add a lead
        </Link>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist">
        {tabs.map((t) => (
          <Link
            key={t.id}
            role="tab"
            aria-selected={view === t.id}
            href={`/staff/leads?view=${t.id}`}
            className={cx(
              "inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm transition-colors",
              view === t.id ? "border-ink bg-ink text-white" : "border-line text-ink-2 hover:border-ink-3",
            )}
          >
            {t.label} <span className={cx("num", view === t.id ? "text-white/70" : "text-ink-3")}>{t.n}</span>
          </Link>
        ))}
      </div>

      <Filters view={view} />

      <Panel className="overflow-hidden">
        {leads.length === 0 ? (
          view === "action" && !and.length ? (
            <Empty title="Nothing waiting on you">New enquiries, handoffs and visits that need an outcome will show up here.</Empty>
          ) : (
            <Empty title="No leads match these filters" action={<Link className="font-medium text-indigo" href={`/staff/leads?view=${view}`}>Clear filters</Link>} />
          )
        ) : (
          <>
            {/* desktop table */}
            <table className="hidden w-full text-left text-[15px] md:table">
              <thead className="border-b border-line text-sm text-ink-3">
                <tr>
                  <th className="px-5 py-3 font-normal">Buyer</th>
                  <th className="px-3 py-3 font-normal">Source</th>
                  <th className="px-3 py-3 font-normal">Wants</th>
                  <th className="px-3 py-3 font-normal">Status</th>
                  <th className="px-3 py-3 font-normal">First reply</th>
                  {user.role === "SALES_HEAD" && <th className="px-3 py-3 font-normal">Owner</th>}
                  <th className="px-5 py-3 text-right font-normal">Arrived</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-2">
                {leads.map((l) => {
                  const sources = [...new Set([l.source, ...l.touches.map((t) => t.source)])];
                  const [label, tone] = LEAD_STATUS[l.status];
                  const overdue = !l.firstResponseAt && now.getTime() - l.createdAt.getTime() > 30 * 60_000;
                  return (
                    <tr key={l.id} className="group relative hover:bg-paper">
                      <td className="px-5 py-3.5">
                        <Link href={`/staff/leads/${l.id}`} className="font-medium after:absolute after:inset-0">
                          {l.name ?? "Unnamed"}
                        </Link>
                        <div className="num text-sm text-ink-3">
                          {l.id} · {formatPhone(l.phoneKey)}
                        </div>
                      </td>
                      <td className="px-3 py-3.5">
                        <div className="flex flex-wrap gap-1">
                          {sources.map((s) => (
                            <Tag key={s}>{SOURCE[s]}</Tag>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-3.5 text-ink-2">
                        {[l.project?.name, l.bhk].filter(Boolean).join(", ") || "—"}
                        <div className="text-sm text-ink-3">{LANGUAGE[l.language]}</div>
                      </td>
                      <td className="px-3 py-3.5">
                        <div className="flex flex-wrap gap-1">
                          <Tag tone={tone}>{label}</Tag>
                          {l.handoffs.length > 0 && <Tag tone="indigo">Handoff waiting</Tag>}
                          {l.dupStatus === "POSSIBLE" && <Tag tone="amber">Possible duplicate</Tag>}
                          {l.visits[0] && l.visits[0].slot.startsAt < now && l.visits[0].status === "BOOKED" && <Tag tone="amber">Outcome needed</Tag>}
                        </div>
                      </td>
                      <td className={cx("num px-3 py-3.5", overdue ? "text-rose" : "text-ink-2")}>
                        {l.firstResponseAt ? fmtDuration(l.firstResponseAt.getTime() - l.createdAt.getTime()) : overdue ? "Not yet" : "Pending"}
                      </td>
                      {user.role === "SALES_HEAD" && <td className="px-3 py-3.5 text-ink-2">{l.owner?.name.split(" ")[0] ?? "—"}</td>}
                      <td className="num px-5 py-3.5 text-right text-ink-3">{relativeTime(l.createdAt, now)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* phone list */}
            <ul className="divide-y divide-line-2 md:hidden">
              {leads.map((l) => {
                const [label, tone] = LEAD_STATUS[l.status];
                return (
                  <li key={l.id}>
                    <Link href={`/staff/leads/${l.id}`} className="block px-4 py-3.5 active:bg-paper">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-medium">{l.name ?? "Unnamed"}</span>
                        <span className="num shrink-0 text-sm text-ink-3">{relativeTime(l.createdAt, now)}</span>
                      </div>
                      <div className="mt-0.5 text-sm text-ink-3">
                        {SOURCE[l.source]} · {[l.project?.name, l.bhk].filter(Boolean).join(", ") || "—"}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        <Tag tone={tone}>{label}</Tag>
                        {l.handoffs.length > 0 && <Tag tone="indigo">Handoff waiting</Tag>}
                        {l.dupStatus === "POSSIBLE" && <Tag tone="amber">Possible duplicate</Tag>}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
            {total > leads.length && <p className="border-t border-line-2 px-5 py-3 text-sm text-ink-3">Showing the newest {leads.length} of {total}. Search or filter to narrow down.</p>}
          </>
        )}
      </Panel>
    </div>
  );
}
