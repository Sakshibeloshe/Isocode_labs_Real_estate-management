import { db } from "@/lib/server/db";
import { HOUR, DAY } from "@/lib/time";

export const NOW = new Date("2026-11-09T06:30:00Z"); // Mon 9 Nov 2026, 12:00 IST

export async function resetDb() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
}

/** one project, two execs, a sales head, one slot tomorrow with capacity 2 */
export async function baseFixture() {
  await db.project.create({
    data: {
      id: "P1",
      name: "Project 1",
      locality: "Test",
      address: "Test address",
      mapUrl: "https://maps.example/p1",
      reraNumber: "PR/GJ/TEST/P1",
      bhkOptions: ["2 BHK", "3 BHK"],
    },
  });
  const head = await db.user.create({ data: { name: "Head Person", email: "head@t.test", passwordHash: "x", role: "SALES_HEAD", languages: ["EN"] } });
  const a = await db.user.create({
    data: { name: "Asha Exec", email: "a@t.test", passwordHash: "x", role: "EXECUTIVE", languages: ["EN", "GU"], projects: { create: { projectId: "P1" } } },
  });
  const b = await db.user.create({
    data: { name: "Bharat Exec", email: "b@t.test", passwordHash: "x", role: "EXECUTIVE", languages: ["EN", "HI"], projects: { create: { projectId: "P1" } } },
  });
  const slot = await db.slot.create({ data: { projectId: "P1", startsAt: new Date(NOW.getTime() + DAY), capacity: 2 } });
  return { head, a, b, slot };
}

let n = 0;
export async function makeLead(over: Partial<{ consent: boolean; phoneKey: string; language: "EN" | "HI" | "GU" }> = {}) {
  n++;
  const key = over.phoneKey ?? `98${String(10000000 + n).slice(-8)}`;
  return db.lead.create({
    data: {
      id: `LD-T${n}-${Math.random().toString(36).slice(2, 6)}`,
      name: `Buyer ${n}`,
      phone: key,
      phoneKey: key,
      source: "WEBSITE",
      projectId: "P1",
      language: over.language ?? "EN",
      consentAt: over.consent === false ? null : NOW,
    },
  });
}

export const at = (ms: number) => new Date(NOW.getTime() + ms);
export { HOUR, DAY };
