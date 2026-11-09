import type { Metadata } from "next";
import { db } from "@/lib/server/db";
import ChatApp from "./chat-app";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ask us · Book a visit" };

export default async function ChatPage({ searchParams }: { searchParams: Promise<{ project?: string; c?: string }> }) {
  const sp = await searchParams;
  const projects = await db.project.findMany({ orderBy: { id: "asc" } });
  const initial = projects.find((p) => p.id === sp.project)?.id ?? null;
  return (
    <ChatApp
      projects={projects.map((p) => ({ id: p.id, name: p.name, locality: p.locality, rera: p.reraNumber, bhk: p.bhkOptions }))}
      initialProjectId={initial}
      resumeToken={sp.c && /^[\w-]{10,64}$/.test(sp.c) ? sp.c : null}
    />
  );
}
