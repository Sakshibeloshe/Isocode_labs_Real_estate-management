import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { chatFromCookie, publicConvo } from "@/lib/server/chat-session";
import { ChatError, confirmFromCard, handleBuyerMessage, pickSlot, requestPerson, setLanguage, showSlots, submitContact } from "@/lib/server/chat";
import { openAICompatibleLLM } from "@/lib/server/ai/llm";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";
import { db } from "@/lib/server/db";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const schemas = {
  message: z.object({ text: z.string().trim().min(1).max(1000) }),
  slots: z.object({ projectId: z.enum(["P1", "P2"]).optional(), excludeDays: z.array(z.string().max(12)).max(40).optional() }),
  pick: z.object({ slotId: z.string().min(1).max(40) }),
  confirm: z.object({
    messageId: z.string().min(1).max(40),
    slotId: z.string().min(1).max(40),
    visitId: z.string().max(40).nullable().optional(),
    name: z.string().trim().min(2, "Please enter your name").max(80),
    phone: z.string().trim().max(20).optional(),
  }),
  person: z.object({}),
  contact: z.object({
    messageId: z.string().min(1).max(40),
    name: z.string().trim().min(2, "Please enter your name").max(80),
    phone: z.string().trim().min(10, "Please enter a 10-digit mobile number").max(20),
    preferredTime: z.string().trim().max(60).optional(),
  }),
  language: z.object({ language: z.enum(["EN", "HI", "GU"]) }),
  project: z.object({ projectId: z.enum(["P1", "P2"]) }),
} as const;
type Action = keyof typeof schemas;

export async function POST(req: Request, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  if (!(action in schemas)) return NextResponse.json({ error: "Unknown action" }, { status: 404 });

  const convo = await chatFromCookie();
  if (!convo) return NextResponse.json({ error: "Your chat has ended. Please start again." }, { status: 401 });

  // per chat + per network limits keep AI cost bounded and stop scripted abuse
  const ip = clientIp(req.headers);
  if (!rateLimit(`chat:${convo.id}`, 20, 60_000) || !rateLimit(`ip:${ip}`, 60, 60_000)) {
    return NextResponse.json({ error: "You're sending messages very fast. Please wait a moment." }, { status: 429 });
  }

  try {
    const body = schemas[action as Action].parse(await req.json().catch(() => ({})));
    const id = convo.id;
    let messages: unknown[] = [];
    switch (action as Action) {
      case "message":
        messages = await handleBuyerMessage({ conversationId: id, text: (body as { text: string }).text, llm: openAICompatibleLLM() });
        break;
      case "slots": {
        const b = body as z.infer<typeof schemas.slots>;
        messages = await showSlots({ conversationId: id, projectId: b.projectId, afterDays: b.excludeDays });
        break;
      }
      case "pick":
        messages = await pickSlot({ conversationId: id, slotId: (body as { slotId: string }).slotId });
        break;
      case "confirm":
        messages = await confirmFromCard({ ...(body as z.infer<typeof schemas.confirm>), conversationId: id });
        break;
      case "person":
        messages = await requestPerson({ conversationId: id });
        break;
      case "contact":
        messages = await submitContact({ ...(body as z.infer<typeof schemas.contact>), conversationId: id });
        break;
      case "language":
        await setLanguage(id, (body as { language: "EN" | "HI" | "GU" }).language);
        messages = [];
        break;
      case "project":
        await db.conversation.update({ where: { id }, data: { projectId: (body as { projectId: string }).projectId } });
        messages = [];
        break;
    }
    const fresh = await db.conversation.findUniqueOrThrow({ where: { id } });
    return NextResponse.json({ conversation: await publicConvo(fresh), messages });
  } catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: e.issues[0]?.message ?? "Please check the details" }, { status: 422 });
    if (e instanceof ChatError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("chat action failed", action, e);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
