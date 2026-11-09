import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/server/db";
import { handleBuyerMessage, startConversation } from "@/lib/server/chat";
import { LLMError, type ChatMessage, type LLM, type LLMReply } from "@/lib/server/ai/llm";
import type { Card } from "@/lib/cards";
import { NOW, baseFixture, resetDb, DAY } from "./helpers";

/** scripted model: each step sees the conversation so far and returns a reply */
type Step = (msgs: ChatMessage[]) => LLMReply;
function fakeLLM(steps: Step[]): LLM & { calls: number } {
  const llm = {
    calls: 0,
    async chat({ messages }: { messages: ChatMessage[] }) {
      const step = steps[llm.calls++];
      if (!step) throw new Error("Model called more times than scripted");
      return step(messages);
    },
  };
  return llm;
}
const call = (name: string, args: unknown, id = name): LLMReply => ({ content: null, toolCalls: [{ id, name, arguments: JSON.stringify(args) }] });
const say = (text: string): LLMReply => ({ content: text, toolCalls: [] });
const lastTool = (m: ChatMessage[]) => JSON.parse((m.at(-1) as { content: string }).content);
const neverCalled: LLM = {
  chat: async () => {
    throw new Error("model must not be called");
  },
};

async function fixture() {
  await resetDb();
  const fx = await baseFixture();
  await db.project.create({
    data: { id: "P2", name: "Project 2", locality: "T", address: "A", mapUrl: "https://maps.example/p2", reraNumber: "PR/GJ/TEST/P2", bhkOptions: ["2 BHK"] },
  });
  await db.fact.create({
    data: { projectId: "P1", key: "price_range", label: "Price", tag: "MARKETING", valueEn: "Indicative price range: ₹78 lakh to ₹1.2 crore. Final price confirmed by our team." },
  });
  await db.fact.create({ data: { projectId: "P1", key: "possession", label: "Possession", tag: "RERA_REGISTERED", valueEn: "December 2027" } });
  await db.slot.create({ data: { projectId: "P1", startsAt: new Date(NOW.getTime() + 2 * DAY), capacity: 2 } });
  return fx;
}

const cards = (msgs: { card: Card | null }[]) => msgs.map((m) => m.card).filter(Boolean) as Card[];

describe("AI agent with booking tool", () => {
  beforeEach(fixture);

  it("collects details, shows real slots, holds the one the buyer names", async () => {
    const convo = await startConversation({ projectId: "P1", language: "EN", now: NOW });
    const llm = fakeLLM([
      () => call("save_buyer_details", { name: "Hardik Patel", phone: "+91 98250 12345", project_id: "P1", bhk: "3 BHK" }),
      () => call("find_visit_slots", { project_id: "P1" }),
      (m) => call("book_visit", { slot_id: lastTool(m).slots[0].slot_id }),
      () => say("I've held that time for you. Please check your number and tap Confirm."),
    ]);
    const out = await handleBuyerMessage({ conversationId: convo.id, text: "I'm Hardik, 98250 12345, want to see a 3 BHK tomorrow", llm, now: NOW });
    const cs = cards(out);
    expect(cs.map((c) => c.type)).toEqual(["slots", "hold"]);
    const hold = cs[1] as Extract<Card, { type: "hold" }>;
    expect(hold.visitId).toBeTruthy();

    const lead = await db.lead.findFirstOrThrow({ where: { phoneKey: "9825012345" } });
    expect(lead.source).toBe("WEBSITE");
    expect(lead.consentAt).not.toBeNull();
    expect(lead.firstResponseAt).not.toBeNull();
    expect((await db.visit.findUniqueOrThrow({ where: { id: hold.visitId! } })).status).toBe("HELD");
  });

  it("refuses a slot id the buyer was never shown (hallucinated or injected)", async () => {
    const convo = await startConversation({ projectId: "P1", language: "EN", now: NOW });
    const slot = await db.slot.findFirstOrThrow();
    let toolResult: { ok: boolean; error?: string } = { ok: true };
    const llm = fakeLLM([
      () => call("save_buyer_details", { name: "A B", phone: "9825011111" }),
      () => call("book_visit", { slot_id: slot.id }),
      (m) => {
        toolResult = lastTool(m);
        return say("Let me show you the free times first.");
      },
    ]);
    await handleBuyerMessage({ conversationId: convo.id, text: "book any time", llm, now: NOW });
    expect(toolResult.ok).toBe(false);
    expect(toolResult.error).toMatch(/Unknown slot_id/);
    expect(await db.visit.count()).toBe(0);
  });

  it("an invalid phone is rejected by the tool, not saved", async () => {
    const convo = await startConversation({ projectId: "P1", language: "EN", now: NOW });
    let r: { ok: boolean } = { ok: true };
    const llm = fakeLLM([
      () => call("save_buyer_details", { phone: "12345" }),
      (m) => {
        r = lastTool(m);
        return say("That number looks short. Could you type your 10-digit mobile number?");
      },
    ]);
    await handleBuyerMessage({ conversationId: convo.id, text: "my number is 12345", llm, now: NOW });
    expect(r.ok).toBe(false);
    expect(await db.lead.count()).toBe(0);
  });

  it("malformed tool arguments: model gets an error and recovers", async () => {
    const convo = await startConversation({ projectId: "P1", language: "EN", now: NOW });
    const llm = fakeLLM([
      () => ({ content: null, toolCalls: [{ id: "x", name: "find_visit_slots", arguments: "{project_id: P1" }] }),
      (m) => {
        expect(lastTool(m).ok).toBe(false);
        return call("find_visit_slots", { project_id: "P1" });
      },
      () => say("Here are the free times."),
    ]);
    const out = await handleBuyerMessage({ conversationId: convo.id, text: "when can I visit?", llm, now: NOW });
    expect(cards(out).map((c) => c.type)).toEqual(["slots"]);
  });

  it("a price that isn't on the fact sheet is blocked, flagged and handed off", async () => {
    const convo = await startConversation({ projectId: "P1", language: "EN", now: NOW });
    const llm = fakeLLM([() => say("The 3 BHK on the 12th floor is ₹96 lakh, a great deal.")]);
    const out = await handleBuyerMessage({ conversationId: convo.id, text: "price of 3 BHK 12th floor?", llm, now: NOW });
    const reply = out.at(-1)!;
    expect(reply.content).not.toContain("96");
    expect(reply.content).toMatch(/member of our team/);
    expect(cards(out).at(-1)?.type).toBe("contact"); // no phone yet → ask for it so a person can call
    const flag = await db.flag.findFirstOrThrow();
    expect(flag.reason).toBe("OUTPUT_BLOCKED");
    expect(flag.excerpt).toContain("₹96 lakh");
  });

  it("the published price range passes the check", async () => {
    const convo = await startConversation({ projectId: "P1", language: "EN", now: NOW });
    const llm = fakeLLM([() => say("The indicative range is ₹78 lakh to ₹1.2 crore; the final price is confirmed by our team.")]);
    const out = await handleBuyerMessage({ conversationId: convo.id, text: "price range?", llm, now: NOW });
    expect(out.at(-1)!.content).toContain("₹78 lakh");
    expect(await db.flag.count()).toBe(0);
  });

  it("another project's price is blocked in this project's chat", async () => {
    await db.fact.create({ data: { projectId: "P2", key: "price_range", label: "Price", tag: "MARKETING", valueEn: "Indicative price range: ₹65 lakh to ₹95 lakh." } });
    const convo = await startConversation({ projectId: "P2", language: "EN", now: NOW });
    const llm = fakeLLM([() => say("The indicative range is ₹78 lakh to ₹1.2 crore.")]); // Project 1's numbers
    const out = await handleBuyerMessage({ conversationId: convo.id, text: "price?", llm, now: NOW });
    expect(out.at(-1)!.content).not.toContain("₹78");
    expect(await db.flag.count({ where: { reason: "OUTPUT_BLOCKED" } })).toBe(1);
  });

  it("missing fact → fixed 'a person will confirm' reply, flag, handoff to a named exec", async () => {
    const convo = await startConversation({ projectId: "P1", language: "EN", now: NOW });
    const llm = fakeLLM([
      () => call("save_buyer_details", { name: "Nidhi Shah", phone: "9898012345" }),
      () => call("hand_off_to_person", { reason: "missing_fact", question: "maintenance charges?", summary: "Wants 2 BHK, asked maintenance" }),
      () => say("Maintenance is around ₹3 per sq ft."), // model improvises after handoff; must not reach buyer
    ]);
    const out = await handleBuyerMessage({ conversationId: convo.id, text: "I'm Nidhi 9898012345. Maintenance charges?", llm, now: NOW });
    const reply = out.at(-1)!;
    expect(reply.content).toMatch(/A member of our team will confirm this for you\. I've shared your question with (Asha|Bharat)\./);
    expect(reply.card?.type).toBe("handoff");
    expect(await db.flag.count({ where: { reason: "MISSING_FACT" } })).toBe(1);
    const h = await db.handoff.findFirstOrThrow({ include: { executive: true } });
    expect(h.summary).toMatch(/Handed off because: Question not in fact sheet/);
    expect(h.executive.role).toBe("EXECUTIVE");
  });

  it("model down (timeout) → fallback form, flagged, no crash", async () => {
    const convo = await startConversation({ projectId: "P1", language: "EN", now: NOW });
    const llm: LLM = { chat: async () => { throw new LLMError("timeout", "slow"); } };
    const out = await handleBuyerMessage({ conversationId: convo.id, text: "is there a pool?", llm, now: NOW });
    expect(out.at(-1)!.card?.type).toBe("fallback");
    expect(await db.flag.count({ where: { reason: "AI_ERROR" } })).toBe(1);
  });

  it("rate limit → one retry, then succeeds", async () => {
    const convo = await startConversation({ projectId: "P1", language: "EN", now: NOW });
    let n = 0;
    const llm: LLM = {
      chat: async () => {
        if (n++ === 0) throw new LLMError("rate_limit", "429");
        return say("Possession is December 2027.");
      },
    };
    const out = await handleBuyerMessage({ conversationId: convo.id, text: "possession?", llm, now: NOW });
    expect(out.at(-1)!.content).toBe("Possession is December 2027.");
  });
});

describe("checks that run before the model", () => {
  beforeEach(fixture);

  it("'talk to a person' never reaches the model", async () => {
    const convo = await startConversation({ projectId: "P1", language: "EN", now: NOW });
    const out = await handleBuyerMessage({ conversationId: convo.id, text: "can I speak to a real person", llm: neverCalled, now: NOW });
    expect(out.at(-1)!.card?.type).toBe("contact");
  });

  it("discount request in Gujarati → fixed reply in Gujarati + flag", async () => {
    const convo = await startConversation({ projectId: "P1", language: "EN", now: NOW });
    const out = await handleBuyerMessage({ conversationId: convo.id, text: "3 BHK પર કોઈ ડિસ્કાઉન્ટ મળશે?", llm: neverCalled, now: NOW });
    expect(out.at(-1)!.content).toMatch(/ઓફર અને અંતિમ કિંમત/);
    expect((await db.conversation.findUniqueOrThrow({ where: { id: convo.id } })).language).toBe("GU");
    expect(await db.flag.count({ where: { reason: "DISCOUNT_REQUEST" } })).toBe(1);
  });

  it("STOP opts the buyer out and cancels pending reminders", async () => {
    const convo = await startConversation({ projectId: "P1", language: "EN", now: NOW });
    const lead = await db.lead.create({
      data: { id: "LD-1", name: "X Y", phoneKey: "9825000000", source: "WEBSITE", projectId: "P1", consentAt: NOW },
    });
    await db.conversation.update({ where: { id: convo.id }, data: { leadId: lead.id } });
    await db.outbox.create({ data: { leadId: lead.id, channel: "SMS", kind: "REMINDER_24H", to: "9825000000", body: "x", sendAt: new Date(NOW.getTime() + DAY) } });
    await handleBuyerMessage({ conversationId: convo.id, text: "STOP", llm: neverCalled, now: NOW });
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).optedOutAt).not.toBeNull();
    expect(await db.outbox.count({ where: { status: "SCHEDULED" } })).toBe(0);
  });
});
