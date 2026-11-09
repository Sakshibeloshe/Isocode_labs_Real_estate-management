"use server";
// Every staff mutation: auth + role check, zod validation, audit, then revalidate.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z, ZodError } from "zod";
import type { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { headers } from "next/headers";
import { db } from "@/lib/server/db";
import { AuthError, assertUser, createSession, destroySession, type SessionUser } from "@/lib/server/auth";
import { audit } from "@/lib/server/audit";
import { BookingError, cancelVisit, confirmVisit, dispatchDueMessages, ensureSlots, holdSlot, markOutcome } from "@/lib/server/booking";
import { IntakeError, intakeLead, logContact, resolveDuplicate } from "@/lib/server/leads";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";

export type Result = { ok: true; message?: string } | { ok: false; error: string };

const BOOKING_MSG: Record<string, string> = {
  SLOT_FULL: "That slot just filled up. Pick another.",
  SLOT_UNAVAILABLE: "That slot can't be booked (closed, too soon, or too far ahead).",
  ALREADY_BOOKED: "This buyer already has a visit booked. Cancel or move it first.",
  TOO_EARLY: "You can mark the outcome once the visit time has arrived.",
  NOT_ACTIVE: "This visit isn't active any more.",
  HOLD_EXPIRED: "The hold expired. Try again.",
};

async function guard(fn: () => Promise<Result | void>): Promise<Result> {
  try {
    return (await fn()) ?? { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    if (e instanceof ZodError) return { ok: false, error: e.issues[0]?.message ?? "Check the form" };
    if (e instanceof BookingError) return { ok: false, error: BOOKING_MSG[e.code] ?? "Booking failed" };
    if (e instanceof IntakeError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Something went wrong. Try again." };
  }
}

/** exec may only act on leads they own; sales head on all */
async function ownLead(user: SessionUser, leadId: string) {
  const lead = await db.lead.findUnique({ where: { id: leadId } });
  if (!lead || (user.role !== "SALES_HEAD" && lead.ownerId !== user.id)) throw new AuthError(403);
  return lead;
}

/* ---------------- auth ---------------- */

const loginSchema = z.object({ email: z.string().trim().toLowerCase().email("Enter your work email"), password: z.string().min(1, "Enter your password").max(200) });

export async function login(_: Result | null, form: FormData): Promise<Result> {
  const parsed = loginSchema.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const ip = clientIp(await headers());
  if (!rateLimit(`login:${ip}:${parsed.data.email}`, 8, 10 * 60_000)) return { ok: false, error: "Too many attempts. Wait 10 minutes and try again." };
  const user = await db.user.findUnique({ where: { email: parsed.data.email } });
  // same message and similar timing whether or not the email exists
  const ok = await bcrypt.compare(parsed.data.password, user?.passwordHash ?? "$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv");
  if (!user || !user.active || !ok) return { ok: false, error: "Email or password is incorrect." };
  await createSession(user);
  await audit(db, user.id, "auth.login", "User", user.id);
  const next = String(form.get("next") || "");
  redirect(next.startsWith("/staff") ? next : "/staff/leads");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}

/* ---------------- leads ---------------- */

const newLead = z.object({
  name: z.string().trim().min(2, "Enter the buyer's name").max(80),
  phone: z.string().trim().max(20).optional().or(z.literal("")),
  email: z.string().trim().max(120).optional().or(z.literal("")),
  source: z.enum(["PORTAL", "SOCIAL_AD", "WEBSITE", "HOARDING"]),
  projectId: z.enum(["P1", "P2"]),
  bhk: z.enum(["2 BHK", "3 BHK", ""]).optional(),
  language: z.enum(["EN", "HI", "GU"]),
  campaign: z.string().trim().max(80).optional(),
  note: z.string().trim().max(500).optional(),
  consent: z.literal("on").optional(),
  contacted: z.literal("on").optional(),
});

export type AddLeadResult = Result & { leadId?: string; outcome?: string; matched?: string };

export async function addLead(_: AddLeadResult | null, form: FormData): Promise<AddLeadResult> {
  let res: AddLeadResult = { ok: false, error: "" };
  const r = await guard(async () => {
    const user = await assertUser();
    const d = newLead.parse(Object.fromEntries(form));
    const out = await intakeLead(
      {
        name: d.name,
        phone: d.phone || null,
        email: d.email || null,
        source: d.source,
        projectId: d.projectId,
        bhk: d.bhk || null,
        language: d.language,
        campaign: d.campaign,
        note: d.note,
        consent: d.consent === "on",
        alreadyContacted: d.contacted === "on",
        sendFirstTouch: true,
      },
      { actorId: user.id },
    );
    res = { ok: true, leadId: out.leadId, outcome: out.outcome, matched: out.matchedLeadId };
  });
  revalidatePath("/staff/leads");
  return r.ok ? res : r;
}

export async function logContactAction(leadId: string): Promise<Result> {
  return guard(async () => {
    const user = await assertUser();
    await ownLead(user, leadId);
    await logContact(leadId, user.id);
    revalidatePath(`/staff/leads/${leadId}`);
    return { ok: true, message: "Contact logged" };
  });
}

export async function resolveDuplicateAction(leadId: string, action: "LINK" | "DISMISS"): Promise<Result> {
  return guard(async () => {
    const user = await assertUser();
    await ownLead(user, leadId);
    await resolveDuplicate(leadId, action, user.id);
    revalidatePath(`/staff/leads/${leadId}`);
    revalidatePath("/staff/leads");
    return { ok: true, message: action === "LINK" ? "Linked as the same buyer" : "Marked as a different buyer" };
  });
}

export async function acknowledgeHandoff(handoffId: string): Promise<Result> {
  return guard(async () => {
    const user = await assertUser();
    const h = await db.handoff.findUniqueOrThrow({ where: { id: handoffId } });
    if (user.role !== "SALES_HEAD" && h.executiveId !== user.id) throw new AuthError(403);
    await db.handoff.update({ where: { id: h.id }, data: { acknowledgedAt: new Date() } });
    await audit(db, user.id, "handoff.acknowledged", "Lead", h.leadId);
    revalidatePath(`/staff/leads/${h.leadId}`);
    revalidatePath("/staff/leads");
  });
}

const closeSchema = z.object({ reason: z.string().trim().min(3, "Give a reason").max(120) });
export async function closeLead(leadId: string, reason: string): Promise<Result> {
  return guard(async () => {
    const user = await assertUser();
    await ownLead(user, leadId);
    const d = closeSchema.parse({ reason });
    await db.lead.update({ where: { id: leadId }, data: { status: "CLOSED", closedReason: d.reason } });
    await audit(db, user.id, "lead.closed", "Lead", leadId, { reason: d.reason });
    revalidatePath(`/staff/leads/${leadId}`);
  });
}

export async function reassignLead(leadId: string, ownerId: string): Promise<Result> {
  return guard(async () => {
    const user = await assertUser(["SALES_HEAD"]);
    const exec = await db.user.findFirst({ where: { id: ownerId, active: true } });
    if (!exec) return { ok: false, error: "Pick an active executive" };
    await db.lead.update({ where: { id: leadId }, data: { ownerId } });
    await audit(db, user.id, "lead.reassigned", "Lead", leadId, { to: ownerId });
    revalidatePath(`/staff/leads/${leadId}`);
    return { ok: true, message: `Assigned to ${exec.name}` };
  });
}

/** the buyer asked us to forget them (DPDP): wipe personal fields, keep anonymous counts */
export async function eraseLead(leadId: string): Promise<Result> {
  return guard(async () => {
    const user = await assertUser(["SALES_HEAD"]);
    await db.$transaction(async (tx) => {
      await tx.message.deleteMany({ where: { conversation: { leadId } } });
      await tx.outbox.updateMany({ where: { leadId }, data: { body: "[erased on request]", to: "[erased]" } });
      await tx.outbox.updateMany({ where: { leadId, status: "SCHEDULED" }, data: { status: "CANCELLED", note: "Erased on request" } });
      await tx.flag.updateMany({ where: { leadId }, data: { excerpt: null } });
      await tx.handoff.updateMany({ where: { leadId }, data: { summary: "[erased on request]" } });
      await tx.lead.update({
        where: { id: leadId },
        data: { name: "[erased]", phone: null, phoneKey: null, email: null, budget: null, timeline: null, summary: null, optedOutAt: new Date(), status: "CLOSED", closedReason: "Erased on buyer request" },
      });
    });
    await audit(db, user.id, "lead.erased", "Lead", leadId);
    revalidatePath(`/staff/leads/${leadId}`);
    return { ok: true, message: "Personal data erased" };
  });
}

/* ---------------- visits ---------------- */

export async function markOutcomeAction(visitId: string, outcome: "VISITED" | "NO_SHOW"): Promise<Result> {
  return guard(async () => {
    const user = await assertUser();
    const v = await db.visit.findUniqueOrThrow({ where: { id: visitId } });
    if (user.role !== "SALES_HEAD" && v.executiveId !== user.id) await ownLead(user, v.leadId);
    await markOutcome({ visitId, outcome, actorId: user.id });
    revalidatePath("/staff/visits");
    revalidatePath(`/staff/leads/${v.leadId}`);
    return { ok: true, message: outcome === "VISITED" ? "Marked as visited" : "Marked as no-show" };
  });
}

export async function cancelVisitAction(visitId: string): Promise<Result> {
  return guard(async () => {
    const user = await assertUser();
    const v = await db.visit.findUniqueOrThrow({ where: { id: visitId } });
    if (user.role !== "SALES_HEAD" && v.executiveId !== user.id) await ownLead(user, v.leadId);
    await cancelVisit({ visitId, actorId: user.id });
    revalidatePath("/staff/visits");
    revalidatePath(`/staff/leads/${v.leadId}`);
    return { ok: true, message: "Visit cancelled, buyer informed" };
  });
}

/** staff books for a buyer on the phone: same engine, same capacity rules */
export async function bookForLead(leadId: string, slotId: string): Promise<Result> {
  return guard(async () => {
    const user = await assertUser();
    await ownLead(user, leadId);
    const v = await holdSlot({ leadId, slotId, via: "STAFF" });
    await confirmVisit({ visitId: v.id });
    await audit(db, user.id, "visit.booked_by_staff", "Visit", v.id);
    revalidatePath(`/staff/leads/${leadId}`);
    revalidatePath("/staff/visits");
    return { ok: true, message: "Visit booked, confirmation sent" };
  });
}

export async function sendDueReminders(): Promise<Result> {
  return guard(async () => {
    await assertUser();
    const r = await dispatchDueMessages();
    revalidatePath("/staff/messages");
    return { ok: true, message: r.sent ? `${r.sent} reminder${r.sent > 1 ? "s" : ""} sent` : "Nothing due right now" };
  });
}

/* ---------------- sales head: fact sheet, slots, review, spend ---------------- */

const factSchema = z.object({
  id: z.string().optional(),
  projectId: z.enum(["P1", "P2", ""]),
  key: z.string().trim().regex(/^[a-z0-9_]{2,40}$/, "Key: lowercase letters, numbers, underscores"),
  label: z.string().trim().min(2).max(80),
  valueEn: z.string().trim().min(2, "English text is required").max(600),
  valueHi: z.string().trim().max(600).optional(),
  valueGu: z.string().trim().max(600).optional(),
  tag: z.enum(["RERA_REGISTERED", "MARKETING"]),
  published: z.literal("on").optional(),
});

export async function saveFact(_: Result | null, form: FormData): Promise<Result> {
  return guard(async () => {
    const user = await assertUser(["SALES_HEAD"]);
    const d = factSchema.parse(Object.fromEntries(form));
    const data = {
      projectId: d.projectId || null,
      key: d.key,
      label: d.label,
      valueEn: d.valueEn,
      valueHi: d.valueHi || null,
      valueGu: d.valueGu || null,
      tag: d.tag,
      published: d.published === "on",
      updatedById: user.id,
    };
    if (d.id) {
      const prev = await db.fact.findUniqueOrThrow({ where: { id: d.id } });
      const changed = prev.valueEn !== data.valueEn || prev.valueHi !== data.valueHi || prev.valueGu !== data.valueGu;
      await db.fact.update({
        where: { id: d.id },
        data: {
          ...data,
          version: changed ? prev.version + 1 : prev.version,
          revisions: changed ? { create: { version: prev.version + 1, valueEn: data.valueEn, valueHi: data.valueHi, valueGu: data.valueGu, editedById: user.id } } : undefined,
        },
      });
      await audit(db, user.id, "fact.updated", "Fact", d.id, { key: d.key, published: data.published });
    } else {
      const exists = await db.fact.findFirst({ where: { projectId: data.projectId, key: data.key } });
      if (exists) return { ok: false, error: "A fact with this key already exists for this project" };
      const f = await db.fact.create({ data: { ...data, revisions: { create: { version: 1, valueEn: data.valueEn, valueHi: data.valueHi, valueGu: data.valueGu, editedById: user.id } } } });
      await audit(db, user.id, "fact.created", "Fact", f.id, { key: d.key });
    }
    revalidatePath("/staff/admin/facts");
    return { ok: true, message: data.published ? "Saved and live in the chat" : "Saved as draft (not used by the assistant)" };
  });
}

const slotEdit = z.object({ capacity: z.coerce.number().int().min(0).max(20), closed: z.boolean() });
export async function updateSlot(slotId: string, capacity: number, closed: boolean): Promise<Result> {
  return guard(async () => {
    const user = await assertUser(["SALES_HEAD"]);
    const d = slotEdit.parse({ capacity, closed });
    const slot = await db.slot.findUniqueOrThrow({ where: { id: slotId } });
    // never below what's already held/booked: those buyers keep their visit
    if (d.capacity < slot.reserved) return { ok: false, error: `${slot.reserved} visit(s) already booked in this slot. Capacity can't go below that.` };
    await db.slot.update({ where: { id: slotId }, data: { capacity: d.capacity, closed: d.closed } });
    await audit(db, user.id, "slot.updated", "Slot", slotId, d);
    revalidatePath("/staff/admin/slots");
  });
}

const tplSchema = z.object({
  projectId: z.enum(["P1", "P2"]),
  weekdays: z.array(z.coerce.number().int().min(0).max(6)).min(1, "Pick at least one day"),
  time: z.string().regex(/^\d{2}:\d{2}$/, "Time like 10:00"),
  capacity: z.coerce.number().int().min(1).max(20),
});
export async function addTemplate(_: Result | null, form: FormData): Promise<Result> {
  return guard(async () => {
    const user = await assertUser(["SALES_HEAD"]);
    const d = tplSchema.parse({ projectId: form.get("projectId"), weekdays: form.getAll("weekday"), time: form.get("time"), capacity: form.get("capacity") });
    const [h, m] = d.time.split(":").map(Number);
    if (h < 7 || h > 20) return { ok: false, error: "Visits run between 07:00 and 20:00" };
    for (const wd of d.weekdays) {
      await db.slotTemplate.upsert({
        where: { projectId_weekday_startMinute: { projectId: d.projectId, weekday: wd, startMinute: h * 60 + m } },
        create: { projectId: d.projectId, weekday: wd, startMinute: h * 60 + m, capacity: d.capacity },
        update: { capacity: d.capacity },
      });
    }
    await ensureSlots(db, new Date(), d.projectId);
    await audit(db, user.id, "slot_template.saved", "Project", d.projectId, d as unknown as Prisma.InputJsonValue);
    revalidatePath("/staff/admin/slots");
    return { ok: true, message: "Weekly times saved; new slots created for the next 30 days" };
  });
}

export async function removeTemplate(id: string): Promise<Result> {
  return guard(async () => {
    const user = await assertUser(["SALES_HEAD"]);
    await db.slotTemplate.delete({ where: { id } });
    await audit(db, user.id, "slot_template.removed", "SlotTemplate", id);
    revalidatePath("/staff/admin/slots");
    return { ok: true, message: "Removed from the weekly pattern. Slots already created stay; close them below if needed." };
  });
}

export async function reviewFlag(flagId: string, verdict: "FINE" | "FIX_FACT_SHEET" | "FIX_BEHAVIOUR"): Promise<Result> {
  return guard(async () => {
    const user = await assertUser(["SALES_HEAD"]);
    await db.flag.update({ where: { id: flagId }, data: { verdict, reviewedById: user.id, reviewedAt: new Date() } });
    await audit(db, user.id, "flag.reviewed", "Flag", flagId, { verdict });
    revalidatePath("/staff/review");
  });
}

const spendSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  source: z.enum(["PORTAL", "SOCIAL_AD", "WEBSITE", "HOARDING"]),
  amount: z.coerce.number().int("Whole rupees").min(0).max(100_000_000),
});
export async function saveSpend(_: Result | null, form: FormData): Promise<Result> {
  return guard(async () => {
    const user = await assertUser(["SALES_HEAD"]);
    const d = spendSchema.parse(Object.fromEntries(form));
    await db.spendEntry.upsert({
      where: { source_month: { source: d.source, month: d.month } },
      create: { source: d.source, month: d.month, amountInr: d.amount },
      update: { amountInr: d.amount },
    });
    await audit(db, user.id, "spend.saved", "SpendEntry", `${d.source}:${d.month}`, { amount: d.amount });
    revalidatePath("/staff/dashboard");
    return { ok: true, message: "Spend saved" };
  });
}
