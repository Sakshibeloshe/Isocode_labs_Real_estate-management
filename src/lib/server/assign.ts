import type { Language } from "@prisma/client";
import type { DbOrTx } from "./db";
import { DAY } from "../time";

/**
 * Pick the executive for a lead (PRD A10):
 * active execs on the project → prefer ones who speak the buyer's language
 * → fewest leads assigned in the last 7 days (load-balanced round robin)
 * → falls back to the sales head if nobody is on the project.
 */
export async function pickExecutive(
  db: DbOrTx,
  opts: { projectId?: string | null; language?: Language | null; now?: Date },
): Promise<string> {
  const now = opts.now ?? new Date();
  const execs = await db.user.findMany({
    where: {
      role: "EXECUTIVE",
      active: true,
      ...(opts.projectId ? { projects: { some: { projectId: opts.projectId } } } : {}),
    },
    select: { id: true, name: true, languages: true },
    orderBy: { name: "asc" },
  });

  if (execs.length === 0) {
    const head = await db.user.findFirst({ where: { role: "SALES_HEAD", active: true }, select: { id: true } });
    if (!head) throw new Error("No executive or sales head available");
    return head.id;
  }

  const speakers = opts.language ? execs.filter((e) => e.languages.includes(opts.language!)) : [];
  const pool = speakers.length ? speakers : execs;

  const loads = await db.lead.groupBy({
    by: ["ownerId"],
    where: { ownerId: { in: pool.map((e) => e.id) }, createdAt: { gte: new Date(now.getTime() - 7 * DAY) } },
    _count: { _all: true },
  });
  const load = new Map(loads.map((l) => [l.ownerId, l._count._all]));
  // stable: lowest load, then alphabetical
  return pool.reduce((best, e) => ((load.get(e.id) ?? 0) < (load.get(best.id) ?? 0) ? e : best), pool[0]).id;
}

export async function salesHeadId(db: DbOrTx): Promise<string> {
  const head = await db.user.findFirst({ where: { role: "SALES_HEAD", active: true }, select: { id: true } });
  if (!head) throw new Error("No sales head configured");
  return head.id;
}
