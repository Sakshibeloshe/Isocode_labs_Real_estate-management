import type { LeadSource } from "@prisma/client";
import { db } from "./db";
import { HOUR, fromIst, monthKey } from "../time";

export const SOURCES: LeadSource[] = ["PORTAL", "SOCIAL_AD", "WEBSITE", "HOARDING"];
export const SOURCE_LABEL: Record<LeadSource, string> = { PORTAL: "Property portal", SOCIAL_AD: "Social media ad", WEBSITE: "Website", HOARDING: "Hoarding call" };

export type Row = {
  key: LeadSource | "ALL";
  label: string;
  leads: number;
  medianResponseMs: number | null;
  unreached48Pct: number | null; // of leads at least 48 h old
  booked: number;
  visited: number;
  noShow: number;
  showUpPct: number | null;
  leadToVisitPct: number | null;
  spend: number;
  costPerVisit: number | null;
};

function median(a: number[]): number | null {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** month = "2026-11" or "all". Cohort = leads created in the period (linked duplicates excluded). */
export async function sourceMetrics(month: string, now = new Date()) {
  let from: Date | undefined;
  let to: Date | undefined;
  if (month !== "all") {
    const [y, m] = month.split("-").map(Number);
    from = fromIst(y, m, 1);
    to = m === 12 ? fromIst(y + 1, 1, 1) : fromIst(y, m + 1, 1);
  }
  const leads = await db.lead.findMany({
    where: { dupStatus: { not: "LINKED" }, ...(from ? { createdAt: { gte: from, lt: to } } : {}) },
    select: { source: true, createdAt: true, firstResponseAt: true, reachedAt: true, visits: { select: { status: true } } },
  });
  const spendRows = await db.spendEntry.findMany({ where: month === "all" ? {} : { month } });

  const build = (key: Row["key"], list: typeof leads): Row => {
    const old = list.filter((l) => now.getTime() - l.createdAt.getTime() >= 48 * HOUR);
    const unreached = old.filter((l) => !l.reachedAt || l.reachedAt.getTime() - l.createdAt.getTime() > 48 * HOUR);
    const visits = list.flatMap((l) => l.visits);
    const visited = visits.filter((v) => v.status === "VISITED").length;
    const noShow = visits.filter((v) => v.status === "NO_SHOW").length;
    const booked = list.filter((l) => l.visits.some((v) => ["BOOKED", "VISITED", "NO_SHOW"].includes(v.status))).length;
    const visitedLeads = list.filter((l) => l.visits.some((v) => v.status === "VISITED")).length;
    const spend = spendRows.filter((s) => key === "ALL" || s.source === key).reduce((a, s) => a + s.amountInr, 0);
    return {
      key,
      label: key === "ALL" ? "All sources" : SOURCE_LABEL[key],
      leads: list.length,
      medianResponseMs: median(list.filter((l) => l.firstResponseAt).map((l) => l.firstResponseAt!.getTime() - l.createdAt.getTime())),
      unreached48Pct: old.length ? (unreached.length / old.length) * 100 : null,
      booked,
      visited,
      noShow,
      showUpPct: visited + noShow ? (visited / (visited + noShow)) * 100 : null,
      leadToVisitPct: list.length ? (visitedLeads / list.length) * 100 : null,
      spend,
      costPerVisit: visited ? spend / visited : null,
    };
  };

  return {
    total: build("ALL", leads),
    rows: SOURCES.map((s) => build(s, leads.filter((l) => l.source === s))),
  };
}

export async function availableMonths(): Promise<string[]> {
  const first = await db.lead.findFirst({ orderBy: { createdAt: "asc" }, select: { createdAt: true } });
  if (!first) return [];
  const out: string[] = [];
  const now = new Date();
  let k = monthKey(first.createdAt);
  while (k <= monthKey(now)) {
    out.push(k);
    const [y, m] = k.split("-").map(Number);
    k = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  }
  return out.reverse();
}
