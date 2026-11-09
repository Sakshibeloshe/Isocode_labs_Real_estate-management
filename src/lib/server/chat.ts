import type { Conversation, Message, Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "./db";
import { token as newToken } from "./ids";
import type { Card, ChatMessageDTO } from "../cards";
import { t, type Lang } from "../i18n";
import { fmtDateTime } from "../time";
import { maskPhone, phoneKey } from "../phone";
import { detectIntents, detectLanguage } from "./ai/guardrails";
import { runAgent } from "./ai/agent";
import type { LLM } from "./ai/llm";
import { createHandoff, raiseFlag } from "./handoff";
import { attachLeadToConversation } from "./leads";
import { BookingError, confirmVisit, holdSlot, listFreeSlots } from "./booking";
import { appUrl } from "./env";

export const MAX_BUYER_MESSAGES = 60; // per chat: cost cap + abuse guard

export class ChatError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function toDTO(m: Message): ChatMessageDTO {
  return { id: m.id, role: m.role, content: m.content, card: (m.card as Card | null) ?? null, createdAt: m.createdAt.toISOString() };
}

async function say(conversationId: string, content: string, card?: Card | null, role: "ASSISTANT" | "BUYER" | "SYSTEM" = "ASSISTANT") {
  return db.message.create({
    data: { conversationId, role, content, card: (card ?? undefined) as Prisma.InputJsonValue | undefined },
  });
}

async function loadConvo(id: string) {
  return db.conversation.findUniqueOrThrow({ where: { id }, include: { lead: { include: { owner: true, project: true } } } });
}
type LoadedConvo = Awaited<ReturnType<typeof loadConvo>>;

/* ---------------- start / resume ---------------- */

export async function startConversation(opts: { projectId?: string | null; language: Lang; now?: Date }) {
  const now = opts.now ?? new Date();
  const project = opts.projectId ? await db.project.findUnique({ where: { id: opts.projectId } }) : null;
  const convo = await db.conversation.create({
    data: {
      token: newToken(),
      projectId: project?.id ?? null,
      language: opts.language,
      consentAt: now, // buyer pressed "Start chat" under the consent notice
      createdAt: now,
      lastActivityAt: now,
    },
  });
  await say(convo.id, project ? t(opts.language, "greeting", { project: project.name }) : t(opts.language, "greetingNoProject"));
  return convo;
}

/** first-touch SMS link: the conversation exists, greet once */
export async function ensureGreeting(convo: Conversation) {
  const count = await db.message.count({ where: { conversationId: convo.id } });
  if (count) return;
  const lead = convo.leadId ? await db.lead.findUnique({ where: { id: convo.leadId }, include: { project: true } }) : null;
  const lang = convo.language as Lang;
  const base = lead?.project ? t(lang, "greeting", { project: lead.project.name }) : t(lang, "greetingNoProject");
  await say(convo.id, base);
}

export async function messagesFor(conversationId: string) {
  const rows = await db.message.findMany({ where: { conversationId }, orderBy: { createdAt: "asc" } });
  return rows.map(toDTO);
}

/* ---------------- free text from the buyer ---------------- */

export const buyerText = z.string().trim().min(1).max(1000);

export async function handleBuyerMessage(opts: { conversationId: string; text: string; llm: LLM; now?: Date }): Promise<ChatMessageDTO[]> {
  const now = opts.now ?? new Date();
  let convo = await loadConvo(opts.conversationId);
  const text = buyerText.parse(opts.text);

  // language follows the script the buyer writes in
  const detected = detectLanguage(text);
  if (detected && detected !== convo.language) {
    await db.conversation.update({ where: { id: convo.id }, data: { language: detected } });
    if (convo.leadId) await db.lead.update({ where: { id: convo.leadId }, data: { language: detected } });
    convo = await loadConvo(convo.id);
  }
  const lang = convo.language as Lang;

  const out: Message[] = [await say(convo.id, text, null, "BUYER")];
  await db.conversation.update({ where: { id: convo.id }, data: { lastActivityAt: now } });
  if (convo.lead && !convo.lead.reachedAt) {
    await db.lead.update({ where: { id: convo.lead.id }, data: { reachedAt: now, status: convo.lead.status === "NEW" ? "ENGAGED" : undefined } });
  }

  const buyerCount = await db.message.count({ where: { conversationId: convo.id, role: "BUYER" } });
  if (buyerCount > MAX_BUYER_MESSAGES) {
    out.push(...(await handoffOrAskContact(convo, "Long chat: message limit reached", lang, now)));
    return out.map(toDTO);
  }

  // ---- deterministic checks before any AI ----
  const intents = detectIntents(text);
  if (intents.has("OPT_OUT")) {
    if (convo.lead) {
      await db.lead.update({ where: { id: convo.lead.id }, data: { optedOutAt: now } });
      await db.outbox.updateMany({ where: { leadId: convo.lead.id, status: "SCHEDULED" }, data: { status: "CANCELLED", note: "Buyer opted out" } });
    }
    out.push(await say(convo.id, t(lang, convo.lead ? "replyOptOut" : "replyOptOutNoLead")));
    return out.map(toDTO);
  }
  if (intents.has("DISTRESS")) {
    await raiseFlag({ conversationId: convo.id, leadId: convo.leadId, reason: "DISTRESS", detail: "Complaint or distress in buyer message", excerpt: text });
    if (convo.lead?.phoneKey) {
      await createHandoff({ leadId: convo.lead.id, conversationId: convo.id, reason: "Complaint or distress", toSalesHead: true, now });
      out.push(await say(convo.id, t(lang, "replyDistress"), { type: "handoff", exec: t(lang, "ourTeam") }));
    } else {
      out.push(await say(convo.id, t(lang, "replyDistress"), { type: "contact", reason: "Complaint or distress" }));
    }
    return out.map(toDTO);
  }
  if (intents.has("DISCOUNT")) {
    await raiseFlag({ conversationId: convo.id, leadId: convo.leadId, reason: "DISCOUNT_REQUEST", detail: "Buyer asked about discount or final price", excerpt: text });
    out.push(...(await handoffOrAskContact(convo, "Asked about discount or final price", lang, now, "replyDiscount")));
    return out.map(toDTO);
  }
  if (intents.has("HUMAN")) {
    out.push(...(await handoffOrAskContact(convo, "Buyer asked for a person", lang, now)));
    return out.map(toDTO);
  }
  if (intents.has("INJECTION")) {
    // answered normally by the rule-bound model, but the sales head sees it
    await raiseFlag({ conversationId: convo.id, leadId: convo.leadId, reason: "INJECTION", detail: "Possible prompt-injection attempt", excerpt: text });
  }

  // ---- the model ----
  const res = await runAgent({ conversationId: convo.id, llm: opts.llm, now });
  if (res.kind === "fallback") {
    await raiseFlag({ conversationId: convo.id, leadId: convo.leadId, reason: "AI_ERROR", detail: `Assistant unavailable (${res.error}); fallback form shown` });
    out.push(await say(convo.id, t(lang, "fallbackBody"), { type: "fallback" }));
    return out.map(toDTO);
  }
  const [first, ...rest] = res.cards;
  if (res.text || first) out.push(await say(convo.id, res.text, first ?? null));
  for (const c of rest) out.push(await say(convo.id, "", c));
  return out.map(toDTO);
}

async function handoffOrAskContact(convo: LoadedConvo, reason: string, lang: Lang, now: Date, replyKey = "replyHandoff"): Promise<Message[]> {
  if (convo.lead?.phoneKey) {
    const h = await createHandoff({ leadId: convo.lead.id, conversationId: convo.id, reason, now });
    return [await say(convo.id, t(lang, replyKey, { exec: h.execFirstName }), { type: "handoff", exec: h.execFirstName })];
  }
  // nobody can call back without a number: ask for it, handoff happens on submit
  return [await say(convo.id, t(lang, replyKey, { exec: t(lang, "ourTeam") }), { type: "contact", reason })];
}

/* ---------------- buttons ---------------- */

/** "Book a site visit" chip / "Show other days": real free slots, no AI needed */
export async function showSlots(opts: { conversationId: string; projectId?: string; afterDays?: string[]; now?: Date }) {
  const now = opts.now ?? new Date();
  const convo = await loadConvo(opts.conversationId);
  const projectId = opts.projectId ?? convo.projectId ?? convo.lead?.projectId;
  if (!projectId) throw new ChatError(400, "Pick a project first");
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  const slots = await listFreeSlots(db, { projectId, now, excludeDays: opts.afterDays });
  await db.conversation.update({ where: { id: convo.id }, data: { projectId, offeredSlotIds: { push: slots.map((s) => s.id) } } });
  const lang = convo.language as Lang;
  const msg = slots.length
    ? await say(convo.id, t(lang, "pickTime"), { type: "slots", projectId, projectName: project.name, slots: slots.map((s) => ({ id: s.id, startsAt: s.startsAt.toISOString() })) })
    : await say(convo.id, t(lang, "noSlots"), { type: "noSlots" });
  return [toDTO(msg)];
}

export async function pickSlot(opts: { conversationId: string; slotId: string; now?: Date }): Promise<ChatMessageDTO[]> {
  const now = opts.now ?? new Date();
  const convo = await loadConvo(opts.conversationId);
  if (!convo.offeredSlotIds.includes(opts.slotId)) throw new ChatError(400, "That time was not offered in this chat");
  const lang = convo.language as Lang;
  const slot = await db.slot.findUniqueOrThrow({ where: { id: opts.slotId }, include: { project: true } });
  const out: Message[] = [await say(convo.id, fmtDateTime(slot.startsAt, lang), null, "BUYER")];

  const lead = convo.lead;
  if (!lead?.phoneKey) {
    out.push(
      await say(convo.id, "", {
        type: "hold",
        slotId: slot.id,
        visitId: null,
        startsAt: slot.startsAt.toISOString(),
        expiresAt: null,
        projectName: slot.project.name,
        name: lead?.name ?? null,
        phone: null,
        state: "open",
      }),
    );
    return out.map(toDTO);
  }
  try {
    const visit = await holdSlot({ leadId: lead.id, slotId: slot.id, via: "SLOT_PICKER", now });
    out.push(
      await say(convo.id, "", {
        type: "hold",
        slotId: slot.id,
        visitId: visit.id,
        startsAt: slot.startsAt.toISOString(),
        expiresAt: visit.holdExpiresAt!.toISOString(),
        projectName: slot.project.name,
        name: lead.name,
        phone: maskPhone(lead.phoneKey),
        state: "open",
      }),
    );
  } catch (e) {
    out.push(...(await bookingProblem(convo, e, lang, now)));
  }
  return out.map(toDTO);
}

const confirmSchema = z.object({
  messageId: z.string().min(1),
  slotId: z.string().min(1),
  visitId: z.string().nullable().optional(),
  name: z.string().trim().min(2).max(80),
  phone: z.string().trim().max(20).optional(),
});

export async function confirmFromCard(input: z.infer<typeof confirmSchema> & { conversationId: string; now?: Date }): Promise<ChatMessageDTO[]> {
  const now = input.now ?? new Date();
  const data = confirmSchema.parse(input);
  let convo = await loadConvo(input.conversationId);
  const lang = convo.language as Lang;
  if (!convo.offeredSlotIds.includes(data.slotId)) throw new ChatError(400, "That time was not offered in this chat");
  const cardMsg = await db.message.findFirst({ where: { id: data.messageId, conversationId: convo.id } });
  if (!cardMsg) throw new ChatError(404, "Card not found");

  // new or corrected number: updates this chat's lead in place, never a second lead (PRD §6)
  if (data.phone) {
    if (!phoneKey(data.phone)) throw new ChatError(422, "Please enter a valid 10-digit mobile number");
    await attachLeadToConversation(convo.id, { name: data.name, phone: data.phone }, now);
  } else if (convo.lead) {
    await attachLeadToConversation(convo.id, { name: data.name }, now);
  }
  convo = await loadConvo(convo.id);
  const lead = convo.lead;
  if (!lead?.phoneKey) throw new ChatError(422, "Please enter your mobile number");

  let visitId = data.visitId ?? null;
  if (visitId) {
    const v = await db.visit.findUnique({ where: { id: visitId } });
    if (!v || v.leadId !== lead.id) throw new ChatError(403, "Not your booking");
  }

  const out: Message[] = [];
  try {
    try {
      if (!visitId) visitId = (await holdSlot({ leadId: lead.id, slotId: data.slotId, via: "SLOT_PICKER", now })).id;
      await confirmVisit({ visitId, now, name: data.name });
    } catch (e) {
      // hold lapsed while they typed: try once to re-take the same time
      if (e instanceof BookingError && e.code === "HOLD_EXPIRED") {
        visitId = (await holdSlot({ leadId: lead.id, slotId: data.slotId, via: "SLOT_PICKER", now })).id;
        await confirmVisit({ visitId, now, name: data.name });
      } else throw e;
    }
  } catch (e) {
    await markCard(cardMsg, "expired");
    out.push(...(await bookingProblem(convo, e, lang, now)));
    return out.map(toDTO);
  }

  await markCard(cardMsg, "done");
  const visit = await db.visit.findUniqueOrThrow({ where: { id: visitId! }, include: { slot: true, executive: true } });
  const project = await db.project.findUniqueOrThrow({ where: { id: visit.projectId } });
  out.push(
    await say(convo.id, t(lang, "remindersNote"), {
      type: "confirmed",
      manageToken: visit.manageToken,
      startsAt: visit.slot.startsAt.toISOString(),
      projectName: project.name,
      address: project.address,
      mapUrl: project.mapUrl,
      exec: visit.executive?.name.split(" ")[0] ?? t(lang, "ourTeam"),
      rera: project.reraNumber,
    }),
  );
  return out.map(toDTO);
}

async function markCard(msg: Message, state: "done" | "expired") {
  const card = msg.card as Card | null;
  if (card?.type !== "hold") return;
  await db.message.update({ where: { id: msg.id }, data: { card: { ...card, state } as Prisma.InputJsonValue } });
}

async function bookingProblem(convo: LoadedConvo, e: unknown, lang: Lang, now: Date): Promise<Message[]> {
  if (!(e instanceof BookingError)) throw e;
  if (e.code === "ALREADY_BOOKED") {
    const v = await db.visit.findFirst({
      where: { leadId: convo.lead!.id, status: "BOOKED" },
      include: { slot: true, executive: true },
    });
    if (v) {
      const project = await db.project.findUniqueOrThrow({ where: { id: v.projectId } });
      return [
        await say(convo.id, "", {
          type: "confirmed",
          manageToken: v.manageToken,
          startsAt: v.slot.startsAt.toISOString(),
          projectName: project.name,
          address: project.address,
          mapUrl: project.mapUrl,
          exec: v.executive?.name.split(" ")[0] ?? t(lang, "ourTeam"),
          rera: project.reraNumber,
        }),
      ];
    }
  }
  // taken / unavailable / expired → fresh real slots
  const projectId = convo.projectId ?? convo.lead?.projectId;
  const out: Message[] = [];
  if (projectId) {
    const project = await db.project.findUniqueOrThrow({ where: { id: projectId } });
    const slots = await listFreeSlots(db, { projectId, now });
    await db.conversation.update({ where: { id: convo.id }, data: { offeredSlotIds: { push: slots.map((s) => s.id) } } });
    out.push(
      await say(
        convo.id,
        t(lang, e.code === "HOLD_EXPIRED" ? "holdExpired" : "slotTaken"),
        slots.length ? { type: "slots", projectId, projectName: project.name, slots: slots.map((s) => ({ id: s.id, startsAt: s.startsAt.toISOString() })) } : { type: "noSlots" },
      ),
    );
  } else out.push(await say(convo.id, t(lang, "error")));
  return out;
}

/** "Talk to a person" button: always available, never goes through the AI */
export async function requestPerson(opts: { conversationId: string; now?: Date }) {
  const now = opts.now ?? new Date();
  const convo = await loadConvo(opts.conversationId);
  const lang = convo.language as Lang;
  const out = [await say(convo.id, t(lang, "talkToPerson"), null, "BUYER")];
  out.push(...(await handoffOrAskContact(convo, "Buyer asked for a person", lang, now)));
  return out.map(toDTO);
}

const contactSchema = z.object({
  messageId: z.string().min(1),
  name: z.string().trim().min(2).max(80),
  phone: z.string().trim().max(20),
  preferredTime: z.string().trim().max(60).optional(),
});

/** contact card (before handoff) and fallback form (AI down) both land here */
export async function submitContact(input: z.infer<typeof contactSchema> & { conversationId: string; now?: Date }) {
  const now = input.now ?? new Date();
  const data = contactSchema.parse(input);
  if (!phoneKey(data.phone)) throw new ChatError(422, "Please enter a valid 10-digit mobile number");
  const convo = await loadConvo(input.conversationId);
  const lang = convo.language as Lang;
  const msg = await db.message.findFirst({ where: { id: data.messageId, conversationId: convo.id } });
  const card = msg?.card as Card | null;
  if (!msg || !card || (card.type !== "contact" && card.type !== "fallback")) throw new ChatError(404, "Form not found");

  const { leadId } = await attachLeadToConversation(convo.id, { name: data.name, phone: data.phone }, now);
  if (!leadId) throw new ChatError(422, "Could not save your details");
  const reason =
    card.type === "fallback"
      ? `Assistant unavailable, buyer left details${data.preferredTime ? `; call ${data.preferredTime}` : ""}`
      : card.reason + (data.preferredTime ? `; call ${data.preferredTime}` : "");
  const h = await createHandoff({ leadId, conversationId: convo.id, reason, now, toSalesHead: card.type === "contact" && card.reason.startsWith("Complaint") });
  await db.message.update({ where: { id: msg.id }, data: { card: { ...card, done: true } as Prisma.InputJsonValue } });
  const reply = await say(convo.id, t(lang, card.type === "fallback" ? "fallbackDone" : "replyHandoff", { exec: h.execFirstName }), {
    type: "handoff",
    exec: h.execFirstName,
  });
  return [toDTO(reply)];
}

export async function setLanguage(conversationId: string, lang: Lang) {
  const convo = await db.conversation.update({ where: { id: conversationId }, data: { language: lang } });
  if (convo.leadId) await db.lead.update({ where: { id: convo.leadId }, data: { language: lang } });
}

export function chatLink(token: string) {
  return `${appUrl()}/chat?c=${token}`;
}
