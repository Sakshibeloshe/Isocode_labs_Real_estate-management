import type { BookedVia, Slot, Visit } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { db as defaultDb, type DbOrTx, type Tx } from "./db";
import { token } from "./ids";
import { pickExecutive } from "./assign";
import { DAY, HOUR, fmtDateTime, fmtTime, fromIst, istParts, istStartOfDay } from "../time";
import { smsBody, type Lang } from "../i18n";
import { appUrl } from "./env";
import { audit } from "./audit";

// Booking rules (PRD A11)
export const MIN_NOTICE_MS = 2 * HOUR; // nothing inside the next 2 h
export const MAX_AHEAD_MS = 30 * DAY; // nothing beyond 30 days
export const HOLD_MS = 10 * 60_000; // 10 min hold while buyer confirms

export type BookingErrorCode =
  | "SLOT_NOT_FOUND"
  | "SLOT_FULL"
  | "SLOT_UNAVAILABLE"
  | "HOLD_EXPIRED"
  | "ALREADY_BOOKED"
  | "NOT_ACTIVE"
  | "TOO_EARLY"
  | "LEAD_NOT_FOUND";

export class BookingError extends Error {
  constructor(public code: BookingErrorCode, message?: string) {
    super(message ?? code);
  }
}

type Client = typeof defaultDb;

/* ------------------------------------------------------------------ slots */

/** create real slots from the weekly templates for the next 31 days (idempotent) */
export async function ensureSlots(db: DbOrTx, now = new Date(), projectId?: string) {
  const templates = await db.slotTemplate.findMany({ where: projectId ? { projectId } : {} });
  if (!templates.length) return;
  const start = istStartOfDay(now);
  const rows: Prisma.SlotCreateManyInput[] = [];
  for (let d = 0; d <= 31; d++) {
    const day = istParts(new Date(start.getTime() + d * DAY + 12 * HOUR));
    for (const t of templates) {
      if (t.weekday !== day.weekday) continue;
      rows.push({
        projectId: t.projectId,
        startsAt: fromIst(day.year, day.month, day.day, t.startMinute),
        durationMin: t.durationMin,
        capacity: t.capacity,
      });
    }
  }
  if (rows.length) await db.slot.createMany({ data: rows, skipDuplicates: true });
}

/** expire lapsed holds and give their capacity back. Safe to run concurrently. */
export async function releaseExpiredHolds(db: DbOrTx, now = new Date()) {
  const expired = await db.$queryRaw<{ slotId: string }[]>`
    UPDATE "Visit" SET "status" = 'EXPIRED', "updatedAt" = ${now}
    WHERE "status" = 'HELD' AND "holdExpiresAt" < ${now}
    RETURNING "slotId"`;
  for (const { slotId } of expired) {
    await db.$executeRaw`UPDATE "Slot" SET "reserved" = "reserved" - 1 WHERE "id" = ${slotId} AND "reserved" > 0`;
  }
  return expired.length;
}

export type FreeSlot = Pick<Slot, "id" | "projectId" | "startsAt" | "durationMin"> & { left: number };

/**
 * Free slots a buyer may book. Default: the first free time on each of the next 3 days that have space.
 * With a date: up to `limit` free times on that date (or the next day that has any).
 */
export async function listFreeSlots(
  db: DbOrTx,
  opts: {
    projectId: string;
    now?: Date;
    date?: string;
    timeOfDay?: "morning" | "afternoon" | "evening";
    limit?: number;
    excludeDays?: string[];
    /** staff view: simply the earliest free times */
    earliest?: boolean;
  },
): Promise<FreeSlot[]> {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? 3;
  await ensureSlots(db, now, opts.projectId);
  await releaseExpiredHolds(db, now);

  let from = new Date(now.getTime() + MIN_NOTICE_MS);
  if (opts.date && /^\d{4}-\d{2}-\d{2}$/.test(opts.date)) {
    const [y, m, d] = opts.date.split("-").map(Number);
    const dayStart = fromIst(y, m, d);
    if (dayStart > from) from = dayStart;
  }
  const to = new Date(now.getTime() + MAX_AHEAD_MS);

  const rows = await db.$queryRaw<FreeSlot[]>`
    SELECT "id", "projectId", "startsAt", "durationMin", ("capacity" - "reserved")::int AS "left"
    FROM "Slot"
    WHERE "projectId" = ${opts.projectId} AND "closed" = false AND "reserved" < "capacity"
      AND "startsAt" >= ${from} AND "startsAt" <= ${to}
    ORDER BY "startsAt" ASC
    LIMIT 200`;

  const inBand = (s: FreeSlot) => {
    if (!opts.timeOfDay) return true;
    const m = istParts(s.startsAt).minutes;
    return opts.timeOfDay === "morning" ? m < 12 * 60 : opts.timeOfDay === "afternoon" ? m >= 12 * 60 && m < 16 * 60 : m >= 16 * 60;
  };
  const candidates = rows.filter(inBand);
  const dayKey = (s: FreeSlot) => {
    const p = istParts(s.startsAt);
    return `${p.year}-${p.month}-${p.day}`;
  };

  if (opts.earliest) return candidates.slice(0, limit);
  if (opts.date) {
    // all on the first day that has any free time (from the requested date onwards)
    const firstDay = candidates[0] && dayKey(candidates[0]);
    return candidates.filter((s) => dayKey(s) === firstDay).slice(0, limit);
  }
  // one per day, rotating morning → midday → late afternoon, so the buyer sees a real spread of choices
  const skip = new Set(opts.excludeDays ?? []);
  const byDay = new Map<string, FreeSlot[]>();
  for (const s of candidates) {
    const k = dayKey(s);
    if (skip.has(k)) continue;
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(s);
  }
  const targets = [10 * 60, 12 * 60, 16 * 60];
  const out: FreeSlot[] = [];
  for (const day of byDay.values()) {
    const want = targets[out.length % targets.length];
    const best = opts.timeOfDay
      ? day[0]
      : day.reduce((a, b) => (Math.abs(istParts(b.startsAt).minutes - want) < Math.abs(istParts(a.startsAt).minutes - want) ? b : a));
    out.push(best);
    if (out.length >= limit) break;
  }
  return out;
}

/* ------------------------------------------------------------------ hold */

/**
 * Hold a slot for 10 min. The capacity check and increment are ONE conditional UPDATE,
 * so two buyers can never take the last place, even at the same millisecond.
 * The CHECK constraint (reserved <= capacity) and the one-active-visit-per-lead index back this up.
 */
export async function holdSlot(
  opts: { leadId: string; slotId: string; via: BookedVia; now?: Date },
  client: Client = defaultDb,
): Promise<Visit> {
  const now = opts.now ?? new Date();
  return client.$transaction(async (tx) => {
    await releaseExpiredHolds(tx, now);

    const lead = await tx.lead.findUnique({ where: { id: opts.leadId }, select: { id: true } });
    if (!lead) throw new BookingError("LEAD_NOT_FOUND");

    const active = await tx.visit.findFirst({
      where: { leadId: opts.leadId, status: { in: ["HELD", "BOOKED"] } },
      include: { slot: true },
    });
    if (active?.status === "BOOKED") throw new BookingError("ALREADY_BOOKED", active.id);
    if (active?.status === "HELD") {
      // buyer changed their mind before confirming: drop the old hold
      await tx.visit.update({ where: { id: active.id }, data: { status: "CANCELLED", holdExpiresAt: null } });
      await tx.$executeRaw`UPDATE "Slot" SET "reserved" = "reserved" - 1 WHERE "id" = ${active.slotId} AND "reserved" > 0`;
    }

    const slot = await takePlace(tx, opts.slotId, now);
    const visit = await tx.visit.create({
      data: {
        leadId: opts.leadId,
        slotId: slot.id,
        projectId: slot.projectId,
        status: "HELD",
        holdExpiresAt: new Date(now.getTime() + HOLD_MS),
        manageToken: token(),
        bookedVia: opts.via,
        createdAt: now,
        updatedAt: now,
      },
    });
    return visit;
  });
}

/** atomic: increment reserved only if a place is free and the slot is bookable now */
async function takePlace(tx: Tx, slotId: string, now: Date) {
  const minStart = new Date(now.getTime() + MIN_NOTICE_MS);
  const maxStart = new Date(now.getTime() + MAX_AHEAD_MS);
  const updated = await tx.$queryRaw<{ id: string; projectId: string; startsAt: Date }[]>`
    UPDATE "Slot" SET "reserved" = "reserved" + 1
    WHERE "id" = ${slotId} AND "closed" = false AND "reserved" < "capacity"
      AND "startsAt" >= ${minStart} AND "startsAt" <= ${maxStart}
    RETURNING "id", "projectId", "startsAt"`;
  if (updated.length) return updated[0];

  const slot = await tx.slot.findUnique({ where: { id: slotId } });
  if (!slot) throw new BookingError("SLOT_NOT_FOUND");
  if (slot.reserved >= slot.capacity) throw new BookingError("SLOT_FULL");
  throw new BookingError("SLOT_UNAVAILABLE");
}

/* ------------------------------------------------------------------ confirm */

export async function confirmVisit(
  opts: { visitId: string; now?: Date; name?: string },
  client: Client = defaultDb,
): Promise<Visit> {
  const now = opts.now ?? new Date();
  const result = await client.$transaction(async (tx) => {
    const visit = await tx.visit.findUnique({ where: { id: opts.visitId } });
    if (!visit) throw new BookingError("NOT_ACTIVE");
    if (visit.status === "BOOKED") return { visit, expired: false }; // idempotent double-tap
    if (visit.status !== "HELD") throw new BookingError("HOLD_EXPIRED");
    if (!visit.holdExpiresAt || visit.holdExpiresAt < now) {
      // lapsed: release in this same transaction and commit the release
      const n = await tx.visit.updateMany({ where: { id: visit.id, status: "HELD" }, data: { status: "EXPIRED", holdExpiresAt: null } });
      if (n.count) await tx.$executeRaw`UPDATE "Slot" SET "reserved" = "reserved" - 1 WHERE "id" = ${visit.slotId} AND "reserved" > 0`;
      return { visit, expired: true };
    }

    const lead = await tx.lead.findUniqueOrThrow({ where: { id: visit.leadId } });
    const executiveId = lead.ownerId ?? (await pickExecutive(tx, { projectId: visit.projectId, language: lead.language, now }));

    const n = await tx.visit.updateMany({
      where: { id: visit.id, status: "HELD" },
      data: { status: "BOOKED", holdExpiresAt: null, executiveId, updatedAt: now },
    });
    if (!n.count) throw new BookingError("HOLD_EXPIRED");

    await tx.lead.update({
      where: { id: lead.id },
      data: {
        name: lead.name ?? (opts.name?.trim() || undefined),
        ownerId: executiveId,
        status: ["VISITED", "CLOSED"].includes(lead.status) ? undefined : "VISIT_BOOKED",
      },
    });
    const booked = await tx.visit.findUniqueOrThrow({ where: { id: visit.id } });
    await queueVisitMessages(tx, booked.id, now, "CONFIRMATION");
    await audit(tx, null, "visit.booked", "Visit", visit.id, { via: visit.bookedVia });
    return { visit: booked, expired: false };
  });
  if (result.expired) throw new BookingError("HOLD_EXPIRED");
  return result.visit;
}

/* ------------------------------------------------------------------ cancel / reschedule / outcome */

export async function cancelVisit(
  opts: { visitId: string; actorId?: string; now?: Date },
  client: Client = defaultDb,
) {
  const now = opts.now ?? new Date();
  return client.$transaction(async (tx) => {
    const visit = await tx.visit.findUnique({ where: { id: opts.visitId } });
    if (!visit) throw new BookingError("NOT_ACTIVE");
    const n = await tx.visit.updateMany({
      where: { id: visit.id, status: { in: ["HELD", "BOOKED"] } },
      data: { status: "CANCELLED", holdExpiresAt: null, updatedAt: now },
    });
    if (!n.count) throw new BookingError("NOT_ACTIVE");
    await tx.$executeRaw`UPDATE "Slot" SET "reserved" = "reserved" - 1 WHERE "id" = ${visit.slotId} AND "reserved" > 0`;
    await tx.outbox.updateMany({ where: { visitId: visit.id, status: "SCHEDULED" }, data: { status: "CANCELLED", note: "Visit cancelled" } });
    if (visit.status === "BOOKED") {
      await queueVisitMessages(tx, visit.id, now, "CANCELLATION");
      await tx.lead.updateMany({ where: { id: visit.leadId, status: "VISIT_BOOKED" }, data: { status: "ENGAGED" } });
    }
    await audit(tx, opts.actorId, "visit.cancelled", "Visit", visit.id);
  });
}

/** move a booked visit to another slot in one transaction: old place freed only if new place is taken */
export async function rescheduleVisit(
  opts: { visitId: string; newSlotId: string; actorId?: string; now?: Date },
  client: Client = defaultDb,
): Promise<Visit> {
  const now = opts.now ?? new Date();
  return client.$transaction(async (tx) => {
    const old = await tx.visit.findUnique({ where: { id: opts.visitId } });
    if (!old || old.status !== "BOOKED") throw new BookingError("NOT_ACTIVE");
    if (old.slotId === opts.newSlotId) return old;

    // take the new place first: if it fails the whole tx rolls back and the old booking stands
    const slot = await takePlace(tx, opts.newSlotId, now);
    if (slot.projectId !== old.projectId) throw new BookingError("SLOT_UNAVAILABLE", "Different project");
    await tx.$executeRaw`UPDATE "Slot" SET "reserved" = "reserved" - 1 WHERE "id" = ${old.slotId} AND "reserved" > 0`;
    await tx.outbox.updateMany({ where: { visitId: old.id, status: "SCHEDULED" }, data: { status: "CANCELLED", note: "Visit rescheduled" } });
    // same visit row moves, so the buyer's manage link keeps working
    const moved = await tx.visit.update({ where: { id: old.id }, data: { slotId: slot.id, updatedAt: now } });
    await queueVisitMessages(tx, moved.id, now, "CONFIRMATION");
    await audit(tx, opts.actorId, "visit.rescheduled", "Visit", moved.id, { fromSlot: old.slotId, toSlot: slot.id });
    return moved;
  });
}

export async function markOutcome(
  opts: { visitId: string; outcome: "VISITED" | "NO_SHOW"; actorId: string; now?: Date },
  client: Client = defaultDb,
) {
  const now = opts.now ?? new Date();
  return client.$transaction(async (tx) => {
    const visit = await tx.visit.findUnique({ where: { id: opts.visitId }, include: { slot: true } });
    if (!visit || !["BOOKED", "VISITED", "NO_SHOW"].includes(visit.status)) throw new BookingError("NOT_ACTIVE");
    // can't mark a visit that hasn't started yet (allow 30 min early arrival)
    if (visit.slot.startsAt.getTime() - 30 * 60_000 > now.getTime()) throw new BookingError("TOO_EARLY");
    await tx.visit.update({ where: { id: visit.id }, data: { status: opts.outcome, outcomeAt: now } });
    await tx.outbox.updateMany({ where: { visitId: visit.id, status: "SCHEDULED" }, data: { status: "CANCELLED", note: "Visit already happened" } });
    const lead = await tx.lead.findUniqueOrThrow({ where: { id: visit.leadId } });
    if (opts.outcome === "VISITED") {
      await tx.lead.update({
        where: { id: lead.id },
        data: { status: lead.status === "CLOSED" ? undefined : "VISITED", reachedAt: lead.reachedAt ?? now },
      });
    } else if (lead.status === "VISIT_BOOKED") {
      await tx.lead.update({ where: { id: lead.id }, data: { status: "ENGAGED" } });
    }
    await audit(tx, opts.actorId, `visit.${opts.outcome.toLowerCase()}`, "Visit", visit.id);
  });
}

/* ------------------------------------------------------------------ messages */

/**
 * Confirmation / cancellation now, reminders 24 h and 2 h before (PRD).
 * Only to buyers with consent who haven't opted out. Reminder that would fall in the past is SKIPPED, not sent late.
 */
export async function queueVisitMessages(tx: DbOrTx, visitId: string, now: Date, kind: "CONFIRMATION" | "CANCELLATION") {
  const visit = await tx.visit.findUniqueOrThrow({
    where: { id: visitId },
    include: { slot: true, lead: { include: { project: true } }, executive: true },
  });
  const { lead, slot } = visit;
  const project = lead.project ?? (await tx.project.findUniqueOrThrow({ where: { id: visit.projectId } }));
  const lang = lead.language as Lang;
  const canMessage = !!lead.consentAt && !lead.optedOutAt && !!lead.phoneKey;
  const to = lead.phoneKey ?? lead.email ?? "unknown";
  const vars = {
    project: project.name,
    when: fmtDateTime(slot.startsAt, lang),
    time: fmtTime(slot.startsAt, lang),
    exec: visit.executive?.name.split(" ")[0] ?? "our team",
    map: project.mapUrl,
    link: `${appUrl()}/visit/${visit.manageToken}`,
    rera: project.reraNumber,
  };
  const base = { leadId: lead.id, visitId: visit.id, channel: "SMS" as const, to };

  if (!canMessage) {
    await tx.outbox.create({
      data: { ...base, kind, body: smsBody(kind, lang, vars), sendAt: now, status: "SKIPPED", note: lead.optedOutAt ? "Buyer opted out" : "No consent or phone" },
    });
    return;
  }
  await tx.outbox.create({ data: { ...base, kind, body: smsBody(kind, lang, vars), sendAt: now, sentAt: now, status: "SENT" } });
  if (kind === "CANCELLATION") return;

  for (const [k, before] of [
    ["REMINDER_24H", 24 * HOUR],
    ["REMINDER_2H", 2 * HOUR],
  ] as const) {
    const sendAt = new Date(slot.startsAt.getTime() - before);
    const late = sendAt <= now;
    await tx.outbox.create({
      data: {
        ...base,
        kind: k,
        body: smsBody(k, lang, vars),
        sendAt,
        status: late ? "SKIPPED" : "SCHEDULED",
        note: late ? `Booked less than ${k === "REMINDER_24H" ? "24" : "2"} h ahead` : null,
      },
    });
  }
}

/** send (mock) every reminder that is due. Called by cron + lazily on staff pages. */
export async function dispatchDueMessages(client: DbOrTx = defaultDb, now = new Date()) {
  const due = await client.outbox.findMany({
    where: { status: "SCHEDULED", sendAt: { lte: now } },
    include: { lead: true, visit: true },
    take: 500,
  });
  let sent = 0;
  for (const m of due) {
    // re-check at send time: opt-out or cancellation may have happened after scheduling
    const stale = m.lead.optedOutAt || (m.visit && m.visit.status !== "BOOKED");
    await client.outbox.updateMany({
      where: { id: m.id, status: "SCHEDULED" },
      data: stale
        ? { status: "CANCELLED", note: m.lead.optedOutAt ? "Buyer opted out" : "Visit no longer booked" }
        : { status: "SENT", sentAt: now },
    });
    if (!stale) sent++;
  }
  return { checked: due.length, sent };
}

export function isBookingError(e: unknown): e is BookingError {
  return e instanceof BookingError;
}

export function isUniqueViolation(e: unknown) {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}
