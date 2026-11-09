import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/server/db";
import { chatFromCookie, publicConvo, setChatCookie } from "@/lib/server/chat-session";
import { ensureGreeting, messagesFor, startConversation } from "@/lib/server/chat";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";

export const dynamic = "force-dynamic";

/** current chat (from cookie), or resume one from a first-touch link token */
export async function GET(req: Request) {
  const resume = new URL(req.url).searchParams.get("c");
  let convo = await chatFromCookie();
  if (resume && /^[\w-]{10,64}$/.test(resume) && resume !== convo?.token) {
    const linked = await db.conversation.findUnique({ where: { token: resume } });
    if (linked) {
      await setChatCookie(linked.token);
      await ensureGreeting(linked);
      convo = linked;
    }
  }
  if (!convo) return NextResponse.json({ conversation: null, messages: [] });
  return NextResponse.json({ conversation: await publicConvo(convo), messages: await messagesFor(convo.id) });
}

const startSchema = z.object({
  projectId: z.enum(["P1", "P2"]).nullable().optional(),
  language: z.enum(["EN", "HI", "GU"]),
  consent: z.literal(true),
});

/** start a new chat; requires the buyer to accept the consent notice */
export async function POST(req: Request) {
  if (!rateLimit(`start:${clientIp(req.headers)}`, 10, 60 * 60_000)) {
    return NextResponse.json({ error: "Too many new chats from this network. Please try again later." }, { status: 429 });
  }
  const body = startSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Please accept the notice to start" }, { status: 400 });
  const convo = await startConversation({ projectId: body.data.projectId ?? null, language: body.data.language });
  await setChatCookie(convo.token);
  return NextResponse.json({ conversation: await publicConvo(convo), messages: await messagesFor(convo.id) });
}
