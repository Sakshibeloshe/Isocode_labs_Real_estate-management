import Link from "next/link";
import { requireUser } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { dispatchDueMessages } from "@/lib/server/booking";
import { logout } from "./actions";
import Nav from "./nav";

export const dynamic = "force-dynamic";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // reminders also go out on cron; this keeps the demo correct without one
  await dispatchDueMessages();
  const [handoffs, flags] = await Promise.all([
    db.handoff.count({ where: { acknowledgedAt: null, ...(user.role === "SALES_HEAD" ? {} : { executiveId: user.id }) } }),
    user.role === "SALES_HEAD" ? db.flag.count({ where: { verdict: "PENDING" } }) : Promise.resolve(0),
  ]);
  const items = [
    { href: "/staff/leads", label: "Leads", count: handoffs },
    { href: "/staff/visits", label: "Visits" },
    { href: "/staff/dashboard", label: "Dashboard" },
    ...(user.role === "SALES_HEAD"
      ? [
          { href: "/staff/review", label: "Review chats", count: flags },
          { href: "/staff/admin/facts", label: "Fact sheet" },
          { href: "/staff/admin/slots", label: "Visit slots" },
        ]
      : []),
    { href: "/staff/messages", label: "Messages" },
  ];

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-line bg-paper/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 pt-3 sm:px-6 lg:pb-0">
          <Link href="/staff/leads" className="shrink-0 py-1 text-[15px] font-semibold tracking-tight">
            Company A <span className="font-normal text-ink-3">Sales</span>
          </Link>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="hidden text-ink-2 sm:inline">
              {user.name} <span className="text-ink-3">· {user.role === "SALES_HEAD" ? "Sales head" : "Executive"}</span>
            </span>
            <form action={logout}>
              <button className="text-ink-3 hover:text-ink">Sign out</button>
            </form>
          </div>
        </div>
        <Nav items={items} />
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
