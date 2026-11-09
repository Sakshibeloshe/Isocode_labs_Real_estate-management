import type { FlagReason } from "@prisma/client";
import { db, type DbOrTx } from "./db";
import { pickExecutive, salesHeadId } from "./assign";
import { fmtDateTime } from "../time";
import { DAY } from "../time";

const LANG_NAME = { EN: "English", HI: "Hindi", GU: "Gujarati" } as const;

/** what the executive reads first: facts about the buyer, not the transcript */
export async function buildSummary(client: DbOrTx, leadId: string, conversationId: string | null, reason: string, aiNote?: string) {
  const lead = await client.lead.findUniqueOrThrow({
    where: { id: leadId },
    include: { project: true, visits: { where: { status: { in: ["BOOKED", "HELD"] } }, include: { slot: true } } },
  });
  const asked = conversationId
    ? await client.message.findMany({
        where: { conversationId, role: "BUYER" },
        orderBy: { createdAt: "desc" },
        take: 3,
        select: { content: true },
      })
    : [];
  const want = [lead.bhk, lead.project?.name].filter(Boolean).join(" · ") || "Not given yet";
  const lines = [
    `Wants: ${want}`,
    `Budget: ${lead.budget ?? "Not given"} · Timeline: ${lead.timeline ?? "Not given"}`,
    `Language: ${LANG_NAME[lead.language]}`,
    `Visit: ${lead.visits[0] ? `${lead.visits[0].status === "HELD" ? "held" : "booked"} ${fmtDateTime(lead.visits[0].slot.startsAt)}` : "none booked"}`,
    asked.length ? `Recent questions: ${asked.reverse().map((m) => `“${m.content.slice(0, 120)}”`).join(" · ")}` : null,
    `Handed off because: ${reason}`,
    aiNote ? `Assistant note: ${aiNote.slice(0, 400)}` : null,
  ];
  return lines.filter(Boolean).join("\n");
}

/**
 * Hand a lead to a named person. Re-uses an open handoff from the last 24 h instead of creating noise.
 * Distress/complaints go to the sales head.
 */
export async function createHandoff(opts: {
  leadId: string;
  conversationId?: string | null;
  reason: string;
  aiNote?: string;
  toSalesHead?: boolean;
  now?: Date;
}) {
  const now = opts.now ?? new Date();
  return db.$transaction(async (tx) => {
    const lead = await tx.lead.findUniqueOrThrow({ where: { id: opts.leadId } });
    const executiveId = opts.toSalesHead
      ? await salesHeadId(tx)
      : lead.ownerId ?? (await pickExecutive(tx, { projectId: lead.projectId, language: lead.language, now }));
    const summary = await buildSummary(tx, lead.id, opts.conversationId ?? null, opts.reason, opts.aiNote);

    const open = await tx.handoff.findFirst({
      where: { leadId: lead.id, executiveId, acknowledgedAt: null, createdAt: { gte: new Date(now.getTime() - DAY) } },
    });
    const handoff = open
      ? await tx.handoff.update({ where: { id: open.id }, data: { summary, reason: `${open.reason}; ${opts.reason}` } })
      : await tx.handoff.create({
          data: { leadId: lead.id, conversationId: opts.conversationId ?? null, executiveId, reason: opts.reason, summary, createdAt: now },
        });

    await tx.lead.update({
      where: { id: lead.id },
      data: {
        ownerId: lead.ownerId ?? executiveId,
        status: ["NEW", "ENGAGED"].includes(lead.status) ? "HANDED_OFF" : undefined,
        summary,
      },
    });
    if (opts.conversationId) await tx.conversation.update({ where: { id: opts.conversationId }, data: { status: "HANDED_OFF" } });
    if (!open) {
      const exec = await tx.user.findUniqueOrThrow({ where: { id: executiveId } });
      await tx.outbox.create({
        data: {
          leadId: lead.id,
          channel: "INTERNAL",
          kind: "HANDOFF_ALERT",
          to: exec.email,
          body: `New handoff: ${lead.name ?? lead.id} (${lead.id}). ${opts.reason}. Open the lead to see the chat summary.`,
          sendAt: now,
          sentAt: now,
          status: "SENT",
        },
      });
    }
    const exec = await tx.user.findUniqueOrThrow({ where: { id: executiveId }, select: { name: true } });
    return { handoff, execFirstName: exec.name.split(" ")[0] };
  });
}

export async function raiseFlag(opts: { conversationId: string; leadId?: string | null; reason: FlagReason; detail: string; excerpt?: string }) {
  await db.flag.create({
    data: {
      conversationId: opts.conversationId,
      leadId: opts.leadId ?? null,
      reason: opts.reason,
      detail: opts.detail.slice(0, 500),
      excerpt: opts.excerpt?.slice(0, 1000),
    },
  });
}
