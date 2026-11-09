import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { db } from "@/lib/server/db";
import { BookingError, cancelVisit, listFreeSlots, rescheduleVisit } from "@/lib/server/booking";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";

export const dynamic = "force-dynamic";

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("slots"), excludeDays: z.array(z.string().max(12)).max(40).optional() }),
  z.object({ action: z.literal("reschedule"), slotId: z.string().min(1).max(40) }),
  z.object({ action: z.literal("cancel") }),
  z.object({ action: z.literal("optout") }),
]);

const ERR: Record<string, string> = {
  SLOT_FULL: "That time was just taken. Please pick another.",
  SLOT_UNAVAILABLE: "That time can't be booked any more. Please pick another.",
  NOT_ACTIVE: "This visit can't be changed any more.",
};

/** buyer manages their visit with the secret link from the SMS; no login needed */
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!rateLimit(`visit:${clientIp(req.headers)}`, 30, 60_000)) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const visit = await db.visit.findUnique({ where: { manageToken: token } });
  if (!visit) return NextResponse.json({ error: "This link isn't valid any more." }, { status: 404 });

  try {
    const b = body.parse(await req.json().catch(() => null));
    if (b.action === "slots") {
      const slots = await listFreeSlots(db, { projectId: visit.projectId, excludeDays: b.excludeDays, limit: 6 });
      return NextResponse.json({ slots: slots.map((s) => ({ id: s.id, startsAt: s.startsAt.toISOString() })) });
    }
    if (b.action === "reschedule") {
      await rescheduleVisit({ visitId: visit.id, newSlotId: b.slotId });
      return NextResponse.json({ ok: true });
    }
    if (b.action === "cancel") {
      await cancelVisit({ visitId: visit.id });
      return NextResponse.json({ ok: true });
    }
    await db.lead.update({ where: { id: visit.leadId }, data: { optedOutAt: new Date() } });
    await db.outbox.updateMany({ where: { leadId: visit.leadId, status: "SCHEDULED" }, data: { status: "CANCELLED", note: "Buyer opted out" } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    if (e instanceof BookingError) return NextResponse.json({ error: ERR[e.code] ?? "Please try again." }, { status: 409 });
    console.error(e);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
