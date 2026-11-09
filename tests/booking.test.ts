import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/server/db";
import {
  BookingError,
  cancelVisit,
  confirmVisit,
  dispatchDueMessages,
  holdSlot,
  listFreeSlots,
  markOutcome,
  rescheduleVisit,
} from "@/lib/server/booking";
import { NOW, at, baseFixture, makeLead, resetDb, HOUR, DAY } from "./helpers";

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "OK";
  } catch (e) {
    return e instanceof BookingError ? e.code : `UNEXPECTED: ${String(e)}`;
  }
};

describe("booking engine", () => {
  let fx: Awaited<ReturnType<typeof baseFixture>>;
  beforeEach(async () => {
    await resetDb();
    fx = await baseFixture();
  });

  it("never overbooks: 20 buyers race for a slot with 2 places, exactly 2 win", async () => {
    const leads = await Promise.all(Array.from({ length: 20 }, () => makeLead()));
    const results = await Promise.all(
      leads.map((l) => code(holdSlot({ leadId: l.id, slotId: fx.slot.id, via: "SLOT_PICKER", now: NOW }))),
    );
    expect(results.filter((r) => r === "OK")).toHaveLength(2);
    expect(results.filter((r) => r === "SLOT_FULL")).toHaveLength(18);
    const slot = await db.slot.findUniqueOrThrow({ where: { id: fx.slot.id } });
    expect(slot.reserved).toBe(2);
    expect(await db.visit.count({ where: { slotId: fx.slot.id, status: "HELD" } })).toBe(2);
  });

  it("database CHECK refuses reserved > capacity even if app logic were bypassed", async () => {
    await expect(db.$executeRaw`UPDATE "Slot" SET "reserved" = 3 WHERE "id" = ${fx.slot.id}`).rejects.toThrow();
  });

  it("one buyer double-tapping gets one hold, not two", async () => {
    const lead = await makeLead();
    const r = await Promise.all([1, 2, 3].map(() => code(holdSlot({ leadId: lead.id, slotId: fx.slot.id, via: "SLOT_PICKER", now: NOW }))));
    expect(r.filter((x) => x === "OK").length).toBeGreaterThanOrEqual(1);
    expect(await db.visit.count({ where: { leadId: lead.id, status: { in: ["HELD", "BOOKED"] } } })).toBe(1);
    const slot = await db.slot.findUniqueOrThrow({ where: { id: fx.slot.id } });
    expect(slot.reserved).toBe(1);
  });

  it("an expired hold gives its place back and cannot be confirmed", async () => {
    const [l1, l2, l3] = await Promise.all([makeLead(), makeLead(), makeLead()]);
    const v1 = await holdSlot({ leadId: l1.id, slotId: fx.slot.id, via: "SLOT_PICKER", now: NOW });
    await holdSlot({ leadId: l2.id, slotId: fx.slot.id, via: "SLOT_PICKER", now: at(5 * 60_000) });
    expect(await code(holdSlot({ leadId: l3.id, slotId: fx.slot.id, via: "SLOT_PICKER", now: at(6 * 60_000) }))).toBe("SLOT_FULL");

    // 11 minutes in: first hold lapsed, second (made at 5 min) still live
    const later = at(11 * 60_000);
    expect(await code(holdSlot({ leadId: l3.id, slotId: fx.slot.id, via: "SLOT_PICKER", now: later }))).toBe("OK");
    expect(await code(confirmVisit({ visitId: v1.id, now: later }))).toBe("HOLD_EXPIRED");
    expect((await db.slot.findUniqueOrThrow({ where: { id: fx.slot.id } })).reserved).toBe(2);
  });

  it("confirm is idempotent and assigns the lead owner as host", async () => {
    const lead = await makeLead();
    await db.lead.update({ where: { id: lead.id }, data: { ownerId: fx.b.id } });
    const v = await holdSlot({ leadId: lead.id, slotId: fx.slot.id, via: "AI_CHAT", now: NOW });
    const c1 = await confirmVisit({ visitId: v.id, now: at(60_000) });
    const c2 = await confirmVisit({ visitId: v.id, now: at(90_000) });
    expect(c1.status).toBe("BOOKED");
    expect(c2.status).toBe("BOOKED");
    expect(c1.executiveId).toBe(fx.b.id);
    expect((await db.slot.findUniqueOrThrow({ where: { id: fx.slot.id } })).reserved).toBe(1);
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("VISIT_BOOKED");
  });

  it("refuses slots inside 2 hours, beyond 30 days, or closed", async () => {
    const lead = await makeLead();
    const soon = await db.slot.create({ data: { projectId: "P1", startsAt: at(90 * 60_000), capacity: 2 } });
    const far = await db.slot.create({ data: { projectId: "P1", startsAt: at(31 * DAY), capacity: 2 } });
    const closed = await db.slot.create({ data: { projectId: "P1", startsAt: at(2 * DAY), capacity: 2, closed: true } });
    for (const s of [soon, far, closed]) {
      expect(await code(holdSlot({ leadId: lead.id, slotId: s.id, via: "SLOT_PICKER", now: NOW }))).toBe("SLOT_UNAVAILABLE");
    }
    expect(await code(holdSlot({ leadId: lead.id, slotId: "nope", via: "SLOT_PICKER", now: NOW }))).toBe("SLOT_NOT_FOUND");
  });

  it("a buyer with a booked visit can't book a second one", async () => {
    const lead = await makeLead();
    const other = await db.slot.create({ data: { projectId: "P1", startsAt: at(2 * DAY), capacity: 2 } });
    const v = await holdSlot({ leadId: lead.id, slotId: fx.slot.id, via: "SLOT_PICKER", now: NOW });
    await confirmVisit({ visitId: v.id, now: NOW });
    expect(await code(holdSlot({ leadId: lead.id, slotId: other.id, via: "SLOT_PICKER", now: NOW }))).toBe("ALREADY_BOOKED");
  });

  it("free slot list hides full, past-notice and closed slots", async () => {
    await db.slot.create({ data: { projectId: "P1", startsAt: at(HOUR), capacity: 2 } }); // inside 2 h
    const full = await db.slot.create({ data: { projectId: "P1", startsAt: at(2 * DAY), capacity: 1, reserved: 1 } });
    const ok = await db.slot.create({ data: { projectId: "P1", startsAt: at(3 * DAY), capacity: 1 } });
    const slots = await listFreeSlots(db, { projectId: "P1", now: NOW });
    const ids = slots.map((s) => s.id);
    expect(ids).toContain(fx.slot.id);
    expect(ids).toContain(ok.id);
    expect(ids).not.toContain(full.id);
    expect(slots.every((s) => s.startsAt.getTime() >= NOW.getTime() + 2 * HOUR)).toBe(true);
  });

  it("schedules 24 h + 2 h reminders, skips the 24 h one when booked late", async () => {
    const early = await makeLead();
    const v1 = await holdSlot({ leadId: early.id, slotId: fx.slot.id, via: "SLOT_PICKER", now: NOW });
    await confirmVisit({ visitId: v1.id, now: NOW });
    const m1 = await db.outbox.findMany({ where: { visitId: v1.id }, orderBy: { sendAt: "asc" } });
    expect(m1.map((m) => [m.kind, m.status])).toEqual([
      ["CONFIRMATION", "SENT"],
      ["REMINDER_24H", "SKIPPED"], // slot is exactly 24 h away → reminder time is now → skipped not sent late
      ["REMINDER_2H", "SCHEDULED"],
    ]);

    const s2 = await db.slot.create({ data: { projectId: "P1", startsAt: at(3 * DAY), capacity: 2 } });
    const l2 = await makeLead();
    const v2 = await holdSlot({ leadId: l2.id, slotId: s2.id, via: "SLOT_PICKER", now: NOW });
    await confirmVisit({ visitId: v2.id, now: NOW });
    const m2 = await db.outbox.findMany({ where: { visitId: v2.id } });
    expect(m2.find((m) => m.kind === "REMINDER_24H")?.status).toBe("SCHEDULED");
    expect(m2.every((m) => m.body.includes("PR/GJ/TEST/P1"))).toBe(true); // RERA on every message
    expect(m2.every((m) => m.body.includes("STOP"))).toBe(true); // opt-out line
  });

  it("no consent → nothing is sent, entries recorded as skipped", async () => {
    const lead = await makeLead({ consent: false });
    const v = await holdSlot({ leadId: lead.id, slotId: fx.slot.id, via: "STAFF", now: NOW });
    await confirmVisit({ visitId: v.id, now: NOW });
    const msgs = await db.outbox.findMany({ where: { leadId: lead.id } });
    expect(msgs.every((m) => m.status === "SKIPPED")).toBe(true);
  });

  it("cancel frees the place and cancels pending reminders", async () => {
    const lead = await makeLead();
    const s = await db.slot.create({ data: { projectId: "P1", startsAt: at(3 * DAY), capacity: 1 } });
    const v = await holdSlot({ leadId: lead.id, slotId: s.id, via: "SLOT_PICKER", now: NOW });
    await confirmVisit({ visitId: v.id, now: NOW });
    await cancelVisit({ visitId: v.id, now: NOW });
    expect((await db.slot.findUniqueOrThrow({ where: { id: s.id } })).reserved).toBe(0);
    expect(await db.outbox.count({ where: { visitId: v.id, status: "SCHEDULED" } })).toBe(0);
    expect(await db.outbox.count({ where: { visitId: v.id, kind: "CANCELLATION", status: "SENT" } })).toBe(1);
    expect(await code(cancelVisit({ visitId: v.id, now: NOW }))).toBe("NOT_ACTIVE");
  });

  it("reschedule to a full slot keeps the original booking intact", async () => {
    const lead = await makeLead();
    const full = await db.slot.create({ data: { projectId: "P1", startsAt: at(2 * DAY), capacity: 1, reserved: 1 } });
    const v = await holdSlot({ leadId: lead.id, slotId: fx.slot.id, via: "SLOT_PICKER", now: NOW });
    await confirmVisit({ visitId: v.id, now: NOW });
    expect(await code(rescheduleVisit({ visitId: v.id, newSlotId: full.id, now: NOW }))).toBe("SLOT_FULL");
    const still = await db.visit.findUniqueOrThrow({ where: { id: v.id } });
    expect(still.status).toBe("BOOKED");
    expect(still.slotId).toBe(fx.slot.id);
    expect((await db.slot.findUniqueOrThrow({ where: { id: fx.slot.id } })).reserved).toBe(1);

    const free = await db.slot.create({ data: { projectId: "P1", startsAt: at(4 * DAY), capacity: 1 } });
    const moved = await rescheduleVisit({ visitId: v.id, newSlotId: free.id, now: NOW });
    expect(moved.slotId).toBe(free.id);
    expect(moved.manageToken).toBe(v.manageToken); // buyer's link keeps working
    expect((await db.slot.findUniqueOrThrow({ where: { id: fx.slot.id } })).reserved).toBe(0);
    expect((await db.slot.findUniqueOrThrow({ where: { id: free.id } })).reserved).toBe(1);
  });

  it("outcome can't be marked before the visit; due reminders get sent, stale ones cancelled", async () => {
    const lead = await makeLead();
    const s = await db.slot.create({ data: { projectId: "P1", startsAt: at(3 * DAY), capacity: 2 } });
    const v = await holdSlot({ leadId: lead.id, slotId: s.id, via: "SLOT_PICKER", now: NOW });
    await confirmVisit({ visitId: v.id, now: NOW });
    expect(await code(markOutcome({ visitId: v.id, outcome: "VISITED", actorId: fx.a.id, now: NOW }))).toBe("TOO_EARLY");

    // two days later the 24 h reminder is due
    const r = await dispatchDueMessages(db, at(2 * DAY + HOUR));
    expect(r.sent).toBe(1);
    // buyer opts out before the 2 h reminder
    await db.lead.update({ where: { id: lead.id }, data: { optedOutAt: at(2 * DAY + 2 * HOUR) } });
    const r2 = await dispatchDueMessages(db, at(3 * DAY - HOUR));
    expect(r2.sent).toBe(0);
    expect(await db.outbox.count({ where: { visitId: v.id, kind: "REMINDER_2H", status: "CANCELLED" } })).toBe(1);

    await markOutcome({ visitId: v.id, outcome: "VISITED", actorId: fx.a.id, now: at(3 * DAY + 10 * 60_000) });
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("VISITED");
  });
});
