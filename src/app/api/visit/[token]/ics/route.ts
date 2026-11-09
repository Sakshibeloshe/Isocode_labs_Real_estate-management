import { db } from "@/lib/server/db";

export const dynamic = "force-dynamic";

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const esc = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");

/** "Add to calendar" file for the buyer */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const visit = await db.visit.findUnique({ where: { manageToken: token }, include: { slot: { include: { project: true } }, executive: true } });
  if (!visit || visit.status !== "BOOKED") return new Response("Not found", { status: 404 });
  const p = visit.slot.project;
  const end = new Date(visit.slot.startsAt.getTime() + visit.slot.durationMin * 60_000);
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Company A//Site visits//EN",
    "BEGIN:VEVENT",
    `UID:${visit.id}@companya`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(visit.slot.startsAt)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(`Site visit: ${p.name}`)}`,
    `LOCATION:${esc(p.address)}`,
    `DESCRIPTION:${esc(`You'll meet ${visit.executive?.name.split(" ")[0] ?? "our team"}. Map: ${p.mapUrl}. Gujarat RERA ${p.reraNumber}.`)}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT2H",
    "ACTION:DISPLAY",
    "DESCRIPTION:Site visit in 2 hours",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  return new Response(ics, {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="site-visit-${p.id.toLowerCase()}.ics"` },
  });
}
