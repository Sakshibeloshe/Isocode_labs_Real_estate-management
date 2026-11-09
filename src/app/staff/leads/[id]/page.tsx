import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Phone } from "lucide-react";
import { requireUser } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { audit } from "@/lib/server/audit";
import { listFreeSlots } from "@/lib/server/booking";
import type { Card } from "@/lib/cards";
import { formatPhone } from "@/lib/phone";
import { fmtDateTime, fmtDuration, relativeTime } from "@/lib/time";
import { LANGUAGE, LEAD_STATUS, OUTBOX_KIND, SOURCE, VISIT_STATUS } from "@/lib/labels";
import { Notice, Panel, Tag } from "@/components/ui";
import { ActionButton } from "@/components/staff";
import {
  acknowledgeHandoff,
  bookForLead,
  cancelVisitAction,
  eraseLead,
  logContactAction,
  markOutcomeAction,
  resolveDuplicateAction,
} from "../../actions";
import { CloseLead, Reassign } from "./controls";

export const metadata: Metadata = { title: "Lead" };

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const lead = await db.lead.findUnique({
    where: { id },
    include: {
      project: true,
      owner: true,
      touches: { orderBy: { createdAt: "asc" } },
      visits: { orderBy: { createdAt: "desc" }, include: { slot: true, executive: true } },
      handoffs: { orderBy: { createdAt: "desc" }, include: { executive: true } },
      conversations: { orderBy: { createdAt: "desc" }, include: { messages: { orderBy: { createdAt: "asc" } } } },
      outbox: { orderBy: { sendAt: "desc" }, take: 30 },
      duplicateOf: { select: { id: true, name: true, phoneKey: true, source: true, createdAt: true } },
      duplicates: { select: { id: true, name: true, dupStatus: true } },
    },
  });
  if (!lead || (user.role !== "SALES_HEAD" && lead.ownerId !== user.id)) notFound();
  await audit(db, user.id, "lead.viewed", "Lead", lead.id);

  const now = new Date();
  const [statusLabel, statusTone] = LEAD_STATUS[lead.status];
  const openHandoff = lead.handoffs.find((h) => !h.acknowledgedAt);
  const activeVisit = lead.visits.find((v) => v.status === "BOOKED" || v.status === "HELD");
  const freeSlots = !activeVisit && lead.projectId && lead.status !== "CLOSED" ? await listFreeSlots(db, { projectId: lead.projectId, now, limit: 6, earliest: true }) : [];
  const execs = user.role === "SALES_HEAD" ? await db.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, role: true } }) : [];
  const sources = [...new Set(lead.touches.map((t) => t.source))];

  return (
    <div className="space-y-6">
      <Link href="/staff/leads" className="text-sm text-ink-3 hover:text-ink">
        Leads
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="wide text-3xl font-semibold">{lead.name ?? "Unnamed buyer"}</h1>
          <p className="num mt-1 text-ink-2">
            {lead.id} · {formatPhone(lead.phoneKey)} · {LANGUAGE[lead.language]}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Tag tone={statusTone}>{statusLabel}</Tag>
            {sources.map((s) => (
              <Tag key={s}>{SOURCE[s]}</Tag>
            ))}
            {lead.optedOutAt && <Tag tone="rose">Opted out</Tag>}
            {!lead.consentAt && <Tag tone="amber">No consent to message</Tag>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {lead.phoneKey && (
            <a href={`tel:+91${lead.phoneKey}`} className="inline-flex h-9 items-center gap-2 rounded-[var(--radius-ctl)] bg-indigo px-3 text-sm font-medium text-white hover:bg-indigo-2">
              <Phone className="size-4" aria-hidden /> Call
            </a>
          )}
          {!lead.reachedAt && <ActionButton action={logContactAction.bind(null, lead.id)}>Log a connected call</ActionButton>}
        </div>
      </div>

      {openHandoff && (
        <Notice tone="indigo">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>
              <b>Handed to {openHandoff.executiveId === user.id ? "you" : openHandoff.executive.name}</b> {relativeTime(openHandoff.createdAt, now)}: {openHandoff.reason}
            </span>
            <ActionButton action={acknowledgeHandoff.bind(null, openHandoff.id)} variant="primary">
              I&apos;ve picked this up
            </ActionButton>
          </div>
        </Notice>
      )}

      {lead.dupStatus === "POSSIBLE" && lead.duplicateOf && (
        <Panel className="border-amber/30 p-5">
          <p className="font-medium">Is this the same buyer as {lead.duplicateOf.id}?</p>
          <p className="mt-1 text-ink-2">
            {lead.duplicateOf.name} · {formatPhone(lead.duplicateOf.phoneKey)} · {SOURCE[lead.duplicateOf.source]}, {relativeTime(lead.duplicateOf.createdAt, now)}. {lead.dupReason}.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <ActionButton action={resolveDuplicateAction.bind(null, lead.id, "LINK")} variant="primary">
              Same buyer, link them
            </ActionButton>
            <ActionButton action={resolveDuplicateAction.bind(null, lead.id, "DISMISS")}>Different buyer</ActionButton>
          </div>
        </Panel>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          {/* summary first: what an exec needs before calling */}
          <Panel className="p-5">
            <h2 className="text-sm text-ink-3">Summary</h2>
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 text-[15px] sm:grid-cols-4">
              <div>
                <dt className="text-ink-3">Project</dt>
                <dd>{lead.project?.name ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-ink-3">Wants</dt>
                <dd>{lead.bhk ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-ink-3">Budget</dt>
                <dd>{lead.budget ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-ink-3">Timeline</dt>
                <dd>{lead.timeline ?? "—"}</dd>
              </div>
            </dl>
            {(openHandoff?.summary ?? lead.summary) && (
              <p className="mt-4 whitespace-pre-wrap border-t border-line-2 pt-4 text-[15px] leading-relaxed text-ink-2">{openHandoff?.summary ?? lead.summary}</p>
            )}
            <p className="num mt-4 border-t border-line-2 pt-3 text-sm text-ink-3">
              Arrived {fmtDateTime(lead.createdAt)} · first reply {lead.firstResponseAt ? `after ${fmtDuration(lead.firstResponseAt.getTime() - lead.createdAt.getTime())}` : "not yet"} ·{" "}
              {lead.reachedAt ? `reached after ${fmtDuration(lead.reachedAt.getTime() - lead.createdAt.getTime())}` : "not reached yet"}
            </p>
          </Panel>

          <Panel>
            <h2 className="border-b border-line-2 px-5 py-3 text-sm text-ink-3">Chat</h2>
            {lead.conversations.every((c) => !c.messages.length) ? (
              <p className="px-5 py-8 text-ink-3">No chat yet. {lead.consentAt && lead.phoneKey ? "The buyer got a chat link by SMS." : ""}</p>
            ) : (
              <div className="max-h-[560px] space-y-3 overflow-y-auto px-5 py-4">
                {lead.conversations.flatMap((c) => c.messages).map((m) => {
                  const card = m.card as Card | null;
                  return (
                    <div key={m.id} className={m.role === "BUYER" ? "flex justify-end" : ""}>
                      <div className={m.role === "BUYER" ? "max-w-[80%] rounded-2xl rounded-br-md bg-indigo-soft px-3.5 py-2" : "max-w-[90%]"}>
                        {m.content && <p className="whitespace-pre-wrap text-[15px]">{m.content}</p>}
                        {card && <p className="mt-1 text-sm italic text-ink-3">{cardLabel(card)}</p>}
                        <p className="num mt-0.5 text-[12px] text-ink-3">{fmtDateTime(m.createdAt)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>

          <Panel>
            <h2 className="border-b border-line-2 px-5 py-3 text-sm text-ink-3">Messages sent to the buyer</h2>
            {lead.outbox.length === 0 ? (
              <p className="px-5 py-6 text-ink-3">None yet.</p>
            ) : (
              <ul className="divide-y divide-line-2">
                {lead.outbox.map((o) => (
                  <li key={o.id} className="px-5 py-3">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium">{OUTBOX_KIND[o.kind]}</span>
                      <Tag tone={o.status === "SENT" ? "sage" : o.status === "SCHEDULED" ? "indigo" : "neutral"}>{o.status === "SCHEDULED" ? `Due ${fmtDateTime(o.sendAt)}` : o.status.toLowerCase()}</Tag>
                      {o.note && <span className="text-ink-3">{o.note}</span>}
                    </div>
                    <p className="mt-1 text-[14px] text-ink-2">{o.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <aside className="space-y-6">
          <Panel className="p-5">
            <h2 className="text-sm text-ink-3">Site visit</h2>
            {lead.visits.length === 0 && <p className="mt-2 text-ink-2">No visit yet.</p>}
            <ul className="mt-2 divide-y divide-line-2">
              {lead.visits.map((v) => {
                const [l, t] = VISIT_STATUS[v.status];
                const started = v.slot.startsAt.getTime() - 30 * 60_000 <= now.getTime();
                return (
                  <li key={v.id} className="py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="num font-medium">{fmtDateTime(v.slot.startsAt)}</span>
                      <Tag tone={t}>{l}</Tag>
                    </div>
                    <p className="text-sm text-ink-3">
                      Host {v.executive?.name ?? "—"} · booked by {v.bookedVia === "AI_CHAT" ? "assistant" : v.bookedVia === "STAFF" ? "staff" : "buyer"}
                    </p>
                    {v.status === "BOOKED" && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {started ? (
                          <>
                            <ActionButton action={markOutcomeAction.bind(null, v.id, "VISITED")} variant="primary">
                              Visited
                            </ActionButton>
                            <ActionButton action={markOutcomeAction.bind(null, v.id, "NO_SHOW")}>No-show</ActionButton>
                          </>
                        ) : (
                          <ActionButton action={cancelVisitAction.bind(null, v.id)} variant="quiet" confirm="Cancel and tell buyer?">
                            Cancel visit
                          </ActionButton>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {freeSlots.length > 0 && (
              <div className="mt-3 border-t border-line-2 pt-3">
                <p className="text-sm text-ink-3">Book on the buyer&apos;s behalf</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {freeSlots.map((s) => (
                    <ActionButton key={s.id} action={bookForLead.bind(null, lead.id, s.id)} className="[&>button]:w-full">
                      <span className="num">{fmtDateTime(s.startsAt)}</span>
                    </ActionButton>
                  ))}
                </div>
              </div>
            )}
          </Panel>

          <Panel className="p-5">
            <h2 className="text-sm text-ink-3">Where they came from</h2>
            <ul className="mt-2 space-y-2 text-[15px]">
              {lead.touches.map((t) => (
                <li key={t.id} className="flex justify-between gap-3">
                  <span>
                    {SOURCE[t.source]}
                    {t.campaign && <span className="text-ink-3"> · {t.campaign}</span>}
                  </span>
                  <span className="num shrink-0 text-sm text-ink-3">{relativeTime(t.createdAt, now)}</span>
                </li>
              ))}
            </ul>
            {lead.touches.length > 1 && <p className="mt-3 text-sm text-ink-3">Cost per visit credits the first source, {SOURCE[lead.source]}.</p>}
            {lead.duplicates.length > 0 && (
              <p className="mt-3 text-sm text-ink-3">
                Linked records: {lead.duplicates.map((d) => d.id).join(", ")}
              </p>
            )}
          </Panel>

          <Panel className="space-y-4 p-5">
            <h2 className="text-sm text-ink-3">Owner</h2>
            {user.role === "SALES_HEAD" ? <Reassign leadId={lead.id} ownerId={lead.ownerId} execs={execs} /> : <p>{lead.owner?.name ?? "—"}</p>}
            {lead.status !== "CLOSED" ? <CloseLead leadId={lead.id} /> : <p className="text-ink-2">Closed: {lead.closedReason}</p>}
            {user.role === "SALES_HEAD" && lead.name !== "[erased]" && (
              <div className="border-t border-line-2 pt-4">
                <ActionButton action={eraseLead.bind(null, lead.id)} variant="danger" confirm="Erase personal data for good?">
                  Erase personal data
                </ActionButton>
                <p className="mt-1 text-[13px] text-ink-3">When the buyer asks us to forget them. Counts stay, details go.</p>
              </div>
            )}
          </Panel>
        </aside>
      </div>
    </div>
  );
}

function cardLabel(c: Card): string {
  switch (c.type) {
    case "slots":
      return `Shown ${c.slots.length} free times`;
    case "noSlots":
      return "No free times to show";
    case "hold":
      return `Held ${fmtDateTime(new Date(c.startsAt))} (${c.state === "done" ? "confirmed" : c.state === "expired" ? "lapsed" : "awaiting confirm"})`;
    case "confirmed":
      return `Visit confirmed for ${fmtDateTime(new Date(c.startsAt))}`;
    case "handoff":
      return `Handed to ${c.exec}`;
    case "contact":
      return c.done ? "Left contact details" : "Asked for contact details";
    case "fallback":
      return c.done ? "Assistant was down; buyer left details" : "Assistant was down; showed contact form";
  }
}
