import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/server/db";
import type { Lang } from "@/lib/i18n";
import ManageVisit from "./manage";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your site visit", robots: { index: false } };

export default async function VisitPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const visit = await db.visit.findUnique({
    where: { manageToken: token },
    include: { slot: { include: { project: true } }, executive: true, lead: { select: { language: true, optedOutAt: true } } },
  });
  if (!visit) notFound();
  const p = visit.slot.project;
  return (
    <ManageVisit
      token={token}
      lang={visit.lead.language as Lang}
      optedOut={!!visit.lead.optedOutAt}
      upcoming={visit.slot.startsAt > new Date()}
      visit={{
        status: visit.status,
        startsAt: visit.slot.startsAt.toISOString(),
        projectId: p.id,
        projectName: p.name,
        address: p.address,
        mapUrl: p.mapUrl,
        rera: p.reraNumber,
        exec: visit.executive?.name.split(" ")[0] ?? null,
      }}
    />
  );
}
