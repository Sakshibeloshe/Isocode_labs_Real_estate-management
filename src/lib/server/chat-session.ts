import "server-only";
import { cookies } from "next/headers";
import { db } from "./db";

const COOKIE = "la_chat";

export async function setChatCookie(token: string) {
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

/** the buyer's conversation, identified only by the secret in their cookie */
export async function chatFromCookie() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  return db.conversation.findUnique({ where: { token } });
}

export async function publicConvo(c: { id: string; language: string; projectId: string | null; status: string; leadId: string | null }) {
  const project = c.projectId ? await db.project.findUnique({ where: { id: c.projectId } }) : null;
  return {
    language: c.language,
    status: c.status,
    hasContact: !!(c.leadId && (await db.lead.findUnique({ where: { id: c.leadId }, select: { phoneKey: true } }))?.phoneKey),
    project: project ? { id: project.id, name: project.name, locality: project.locality, rera: project.reraNumber } : null,
  };
}
