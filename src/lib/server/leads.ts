import type { Language, LeadSource, Prisma } from "@prisma/client";
import { db as defaultDb, type DbOrTx } from "./db";
import { nextLeadId, token } from "./ids";
import { pickExecutive } from "./assign";
import { normaliseEmail, phoneKey, similarNames } from "../phone";
import { smsBody, type Lang } from "../i18n";
import { DAY } from "../time";
import { appUrl } from "./env";
import { audit } from "./audit";

export type IntakeInput = {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  source: LeadSource;
  projectId?: string | null;
  bhk?: string | null;
  budget?: string | null;
  language?: Language;
  campaign?: string | null;
  note?: string | null;
  consent: boolean;
  /** exec already spoke to the buyer (e.g. hoarding call) */
  alreadyContacted?: boolean;
  /** send automatic first message with chat link (portal / ads / manual) */
  sendFirstTouch?: boolean;
};

export type IntakeResult = {
  leadId: string;
  outcome: "CREATED" | "LINKED" | "POSSIBLE_DUPLICATE";
  matchedLeadId?: string;
  matchReason?: string;
};

/**
 * One entry point for every source. Duplicate rules (PRD A9):
 *  same phone (last 10 digits) → same person, add a touch to the existing lead
 *  same email                 → same person, add a touch
 *  similar name + same project but different phone → new lead marked POSSIBLE duplicate for an exec
 * Leads are never deleted or overwritten; only blank fields get filled.
 */
export async function intakeLead(input: IntakeInput, opts: { now?: Date; actorId?: string; db?: typeof defaultDb } = {}): Promise<IntakeResult> {
  const now = opts.now ?? new Date();
  const client = opts.db ?? defaultDb;
  const pk = phoneKey(input.phone);
  const email = normaliseEmail(input.email);
  if (!pk && !email) throw new IntakeError("A valid Indian mobile number or email is required");

  return client.$transaction(async (tx) => {
    const match =
      (pk && (await tx.lead.findFirst({ where: { phoneKey: pk, dupStatus: { not: "LINKED" } }, orderBy: { createdAt: "asc" } }))) ||
      (email && (await tx.lead.findFirst({ where: { email, dupStatus: { not: "LINKED" } }, orderBy: { createdAt: "asc" } }))) ||
      null;

    if (match) {
      const reason = pk && match.phoneKey === pk ? "Same phone number" : "Same email";
      await tx.leadTouch.create({ data: { leadId: match.id, source: input.source, campaign: input.campaign, note: input.note, createdAt: now } });
      await tx.lead.update({
        where: { id: match.id },
        data: fillBlanks(match, input, pk, email, now),
      });
      await audit(tx, opts.actorId, "lead.linked_touch", "Lead", match.id, { source: input.source, reason });
      return { leadId: match.id, outcome: "LINKED", matchedLeadId: match.id, matchReason: reason };
    }

    const id = await nextLeadId(tx);
    const ownerId = await pickExecutive(tx, { projectId: input.projectId, language: input.language, now });

    // possible duplicate: similar name on same project, phone differs
    let dup: { id: string } | undefined;
    if (input.name && input.projectId) {
      const recent = await tx.lead.findMany({
        where: { projectId: input.projectId, createdAt: { gte: new Date(now.getTime() - 90 * DAY) }, dupStatus: { not: "LINKED" } },
        select: { id: true, name: true },
      });
      dup = recent.find((l) => similarNames(l.name, input.name));
    }

    await tx.lead.create({
      data: {
        id,
        name: input.name?.trim() || null,
        phone: input.phone?.trim() || null,
        phoneKey: pk,
        email,
        language: input.language ?? "EN",
        source: input.source,
        projectId: input.projectId || null,
        bhk: input.bhk || null,
        budget: input.budget || null,
        ownerId,
        consentAt: input.consent ? now : null,
        createdAt: now,
        firstResponseAt: input.alreadyContacted ? now : null,
        reachedAt: input.alreadyContacted ? now : null,
        status: input.alreadyContacted ? "ENGAGED" : "NEW",
        duplicateOfId: dup?.id ?? null,
        dupStatus: dup ? "POSSIBLE" : "NONE",
        dupReason: dup ? "Similar name, same project, different phone" : null,
        touches: { create: { source: input.source, campaign: input.campaign, note: input.note, createdAt: now } },
      },
    });

    if (input.sendFirstTouch && input.consent && pk && !input.alreadyContacted) {
      await sendFirstTouch(tx, id, now);
    }
    await audit(tx, opts.actorId, "lead.created", "Lead", id, { source: input.source, possibleDuplicateOf: dup?.id });
    return dup
      ? { leadId: id, outcome: "POSSIBLE_DUPLICATE", matchedLeadId: dup.id, matchReason: "Similar name, same project, different phone" }
      : { leadId: id, outcome: "CREATED" };
  });
}

function fillBlanks(
  lead: Prisma.LeadGetPayload<object>,
  input: IntakeInput,
  pk: string | null,
  email: string | null,
  now: Date,
): Prisma.LeadUpdateInput {
  return {
    name: lead.name ?? (input.name?.trim() || undefined),
    phone: lead.phone ?? (input.phone?.trim() || undefined),
    phoneKey: lead.phoneKey ?? pk ?? undefined,
    email: lead.email ?? email ?? undefined,
    project: !lead.projectId && input.projectId ? { connect: { id: input.projectId } } : undefined,
    bhk: lead.bhk ?? (input.bhk || undefined),
    budget: lead.budget ?? (input.budget || undefined),
    consentAt: lead.consentAt ?? (input.consent ? now : undefined),
  };
}

/** first automatic message with a personal chat link; counts as first response */
export async function sendFirstTouch(tx: DbOrTx, leadId: string, now: Date) {
  const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId }, include: { project: true } });
  if (!lead.phoneKey || !lead.consentAt || lead.optedOutAt) return;
  const convo = await tx.conversation.create({
    data: { token: token(), leadId, projectId: lead.projectId, language: lead.language, consentAt: lead.consentAt, createdAt: now, lastActivityAt: now },
  });
  const projectName = lead.project?.name ?? "our homes";
  await tx.outbox.create({
    data: {
      leadId,
      channel: "SMS",
      kind: "FIRST_TOUCH",
      to: lead.phoneKey,
      body: smsBody("FIRST_TOUCH", lead.language as Lang, {
        project: projectName,
        link: `${appUrl()}/chat?c=${convo.token}`,
        rera: lead.project?.reraNumber ?? "see project page",
      }),
      sendAt: now,
      sentAt: now,
      status: "SENT",
    },
  });
  await tx.lead.update({ where: { id: leadId }, data: { firstResponseAt: lead.firstResponseAt ?? now } });
}

/** exec logs a connected call / message → counts as reached (PRD A2) */
export async function logContact(leadId: string, actorId: string, now = new Date()) {
  const lead = await defaultDb.lead.findUniqueOrThrow({ where: { id: leadId } });
  await defaultDb.lead.update({
    where: { id: leadId },
    data: {
      reachedAt: lead.reachedAt ?? now,
      firstResponseAt: lead.firstResponseAt ?? now,
      status: lead.status === "NEW" ? "ENGAGED" : undefined,
    },
  });
  await audit(defaultDb, actorId, "lead.contact_logged", "Lead", leadId);
}

export async function resolveDuplicate(leadId: string, action: "LINK" | "DISMISS", actorId: string) {
  const lead = await defaultDb.lead.findUniqueOrThrow({ where: { id: leadId } });
  if (lead.dupStatus !== "POSSIBLE" || !lead.duplicateOfId) throw new IntakeError("This lead has no open duplicate question");
  await defaultDb.lead.update({
    where: { id: leadId },
    data:
      action === "LINK"
        ? { dupStatus: "LINKED", status: "CLOSED", closedReason: `Duplicate of ${lead.duplicateOfId}` }
        : { dupStatus: "DISMISSED", duplicateOfId: null },
  });
  await audit(defaultDb, actorId, action === "LINK" ? "lead.duplicate_linked" : "lead.duplicate_dismissed", "Lead", leadId, {
    other: lead.duplicateOfId,
  });
}

export class IntakeError extends Error {}

/** used by the chat when the buyer gives contact details: create or attach a lead */
export async function attachLeadToConversation(
  conversationId: string,
  details: { name?: string; phone?: string; email?: string; bhk?: string; budget?: string; timeline?: string; projectId?: string },
  now = new Date(),
): Promise<{ leadId: string | null; linkedExisting: boolean }> {
  const convo = await defaultDb.conversation.findUniqueOrThrow({ where: { id: conversationId } });
  const lead = convo.leadId ? await defaultDb.lead.findUnique({ where: { id: convo.leadId } }) : null;

  if (lead) {
    // update in place, never create a second lead for the same chat
    const pk = phoneKey(details.phone);
    await defaultDb.lead.update({
      where: { id: lead.id },
      data: {
        name: details.name?.trim() || undefined,
        phone: pk ? details.phone : undefined,
        phoneKey: pk ?? undefined,
        email: normaliseEmail(details.email) ?? undefined,
        bhk: details.bhk || undefined,
        budget: details.budget || undefined,
        timeline: details.timeline || undefined,
        projectId: details.projectId || undefined,
        reachedAt: lead.reachedAt ?? now,
        status: lead.status === "NEW" ? "ENGAGED" : undefined,
      },
    });
    return { leadId: lead.id, linkedExisting: false };
  }

  if (!phoneKey(details.phone) && !normaliseEmail(details.email)) return { leadId: null, linkedExisting: false };

  const res = await intakeLead(
    {
      name: details.name,
      phone: details.phone,
      email: details.email,
      source: "WEBSITE",
      projectId: details.projectId ?? convo.projectId,
      bhk: details.bhk,
      budget: details.budget,
      language: convo.language,
      consent: !!convo.consentAt,
      campaign: "Website chat",
    },
    { now },
  );
  await defaultDb.conversation.update({ where: { id: conversationId }, data: { leadId: res.leadId } });
  const created = await defaultDb.lead.findUniqueOrThrow({ where: { id: res.leadId } });
  await defaultDb.lead.update({
    where: { id: res.leadId },
    data: {
      timeline: details.timeline || undefined,
      // chat leads: the assistant replied at the start of the chat, buyer is talking to us
      firstResponseAt: created.firstResponseAt ?? convo.createdAt,
      reachedAt: created.reachedAt ?? now,
      status: created.status === "NEW" ? "ENGAGED" : undefined,
      language: convo.language,
    },
  });
  return { leadId: res.leadId, linkedExisting: res.outcome === "LINKED" };
}
