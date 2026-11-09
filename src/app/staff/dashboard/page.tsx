import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/server/auth";
import { availableMonths, sourceMetrics, type Row } from "@/lib/server/metrics";
import { fmtDuration, monthKey } from "@/lib/time";
import { inr, pct } from "@/lib/labels";
import { Panel, cx } from "@/components/ui";
import SpendForm from "./spend-form";

export const metadata: Metadata = { title: "Dashboard" };

const monthName = (k: string) => new Date(`${k}-15T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric" });

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const user = await requireUser();
  const months = await availableMonths();
  const sp = await searchParams;
  const m = sp.m === "all" || (sp.m && months.includes(sp.m)) ? sp.m : (months[0] ?? monthKey(new Date()));
  const { total, rows } = await sourceMetrics(m);
  const maxCpv = Math.max(...rows.map((r) => r.costPerVisit ?? 0), 1);

  // targets from the brief: median first response < 5 min; unreached in 48 h < 5%; lead-to-visit 8%
  const tiles = [
    { label: "Median first reply", value: fmtDuration(total.medianResponseMs), target: "Target under 5 min · was 14 h", good: total.medianResponseMs != null && total.medianResponseMs < 5 * 60_000 },
    { label: "Not reached within 48 h", value: pct(total.unreached48Pct), target: "Target under 5% · was 35%", good: total.unreached48Pct != null && total.unreached48Pct < 5 },
    { label: "Leads who visited", value: pct(total.leadToVisitPct), target: "Target 8% · was 6%", good: total.leadToVisitPct != null && total.leadToVisitPct >= 8 },
    { label: "Show-up rate", value: pct(total.showUpPct), target: `${total.visited} visited of ${total.visited + total.noShow} due`, good: null },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="wide text-3xl font-semibold">Dashboard</h1>
          <p className="mt-1 text-ink-2">Leads arriving in {m === "all" ? "all months" : monthName(m)}, followed to the site.</p>
        </div>
        <nav className="flex flex-wrap gap-1.5" aria-label="Period">
          {[...months.slice(0, 3), "all"].map((k) => (
            <Link
              key={k}
              href={`/staff/dashboard?m=${k}`}
              aria-current={k === m ? "page" : undefined}
              className={cx("rounded-full border px-3.5 py-1.5 text-sm", k === m ? "border-ink bg-ink text-white" : "border-line text-ink-2 hover:border-ink-3")}
            >
              {k === "all" ? "All time" : monthName(k).split(" ")[0]}
            </Link>
          ))}
        </nav>
      </div>

      <div className="grid gap-px overflow-hidden rounded-[var(--radius-card)] border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="bg-surface p-5">
            <p className="text-sm text-ink-3">{t.label}</p>
            <p className="wide num mt-2 text-[34px] font-semibold leading-none">{t.value}</p>
            <p className={cx("mt-3 text-sm", t.good === true ? "text-sage" : t.good === false ? "text-amber" : "text-ink-3")}>{t.target}</p>
          </div>
        ))}
      </div>

      <section>
        <h2 className="text-lg font-semibold">By source</h2>
        <p className="mt-1 text-sm text-ink-3">A lead that came twice counts for its first source. Spend is entered monthly by the sales head.</p>
        <Panel className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-[15px]">
            <thead className="border-b border-line text-sm text-ink-3">
              <tr>
                <th className="px-5 py-3 font-normal">Source</th>
                <th className="px-3 py-3 text-right font-normal">Leads</th>
                <th className="px-3 py-3 text-right font-normal">Median first reply</th>
                <th className="px-3 py-3 text-right font-normal">Not reached 48 h</th>
                <th className="px-3 py-3 text-right font-normal">Visits booked</th>
                <th className="px-3 py-3 text-right font-normal">Visited</th>
                <th className="px-3 py-3 text-right font-normal">Show-up</th>
                <th className="px-3 py-3 text-right font-normal">Spend</th>
                <th className="w-[200px] px-5 py-3 font-normal">Cost per visit</th>
              </tr>
            </thead>
            <tbody className="num divide-y divide-line-2">
              {[...rows, total].map((r: Row) => (
                <tr key={r.key} className={r.key === "ALL" ? "bg-paper font-medium" : ""}>
                  <td className="px-5 py-3 font-sans">{r.label}</td>
                  <td className="px-3 py-3 text-right">{r.leads}</td>
                  <td className="px-3 py-3 text-right">{fmtDuration(r.medianResponseMs)}</td>
                  <td className="px-3 py-3 text-right">{pct(r.unreached48Pct)}</td>
                  <td className="px-3 py-3 text-right">{r.booked}</td>
                  <td className="px-3 py-3 text-right">{r.visited}</td>
                  <td className="px-3 py-3 text-right">{pct(r.showUpPct)}</td>
                  <td className="px-3 py-3 text-right">{r.spend ? inr(r.spend) : "—"}</td>
                  <td className="px-5 py-3">
                    {r.costPerVisit == null ? (
                      <span className="text-ink-3">{r.spend ? "No visits yet" : "—"}</span>
                    ) : (
                      <div className="flex items-center gap-3">
                        {r.key !== "ALL" && (
                          <span className="h-2 flex-1 rounded-full bg-line-2" aria-hidden>
                            <span className="block h-2 rounded-full bg-indigo" style={{ width: `${Math.max(4, ((r.costPerVisit ?? 0) / maxCpv) * 100)}%` }} />
                          </span>
                        )}
                        <span className="w-[76px] text-right">{inr(r.costPerVisit)}</span>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </section>

      {user.role === "SALES_HEAD" && (
        <section>
          <h2 className="text-lg font-semibold">Monthly spend</h2>
          <p className="mt-1 text-sm text-ink-3">Ad platforms and portals aren&apos;t connected, so enter what each source cost this month.</p>
          <SpendForm months={months.slice(0, 3)} />
        </section>
      )}
    </div>
  );
}
