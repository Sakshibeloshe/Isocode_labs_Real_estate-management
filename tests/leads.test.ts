import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/server/db";
import { intakeLead, resolveDuplicate } from "@/lib/server/leads";
import { pickExecutive } from "@/lib/server/assign";
import { phoneKey, similarNames } from "@/lib/phone";
import { NOW, baseFixture, resetDb } from "./helpers";

describe("phone + name normalisation", () => {
  it("normalises Indian mobile formats to the same key", () => {
    for (const raw of ["+91 98250 12345", "098250-12345", "9825012345", "91 9825012345", "+91-98250 12345"]) {
      expect(phoneKey(raw)).toBe("9825012345");
    }
  });
  it("rejects landlines, short numbers and foreign prefixes", () => {
    expect(phoneKey("2658 1234")).toBeNull(); // landline without STD code
    expect(phoneKey("5825012345")).toBeNull(); // mobiles start 6-9
    expect(phoneKey("98250")).toBeNull();
    expect(phoneKey("+44 7700 900123")).toBeNull();
    expect(phoneKey("")).toBeNull();
  });
  it("matches names ignoring order, honorifics and small typos", () => {
    expect(similarNames("Hardik Patel", "Patel Hardik")).toBe(true);
    expect(similarNames("Mr. Hardik Patel", "hardik  patel")).toBe(true);
    expect(similarNames("Hardik Patel", "Hardik Patil")).toBe(true);
    expect(similarNames("Hardik Patel", "Hiren Patel")).toBe(false);
    expect(similarNames("Hardik", "Hardik")).toBe(true);
    expect(similarNames("Hardik", "Hardika")).toBe(false); // single names: exact only
  });
});

describe("lead intake + duplicate check", () => {
  beforeEach(async () => {
    await resetDb();
    await baseFixture();
  });

  it("same phone from a second source links to the first lead with both source tags", async () => {
    const first = await intakeLead({ name: "Hardik Patel", phone: "+91 98250 12345", source: "PORTAL", projectId: "P1", consent: true }, { now: NOW });
    const second = await intakeLead({ name: "Hardik", phone: "098250 12345", source: "WEBSITE", projectId: "P1", consent: true }, { now: NOW });
    expect(first.outcome).toBe("CREATED");
    expect(second.outcome).toBe("LINKED");
    expect(second.leadId).toBe(first.leadId);
    expect(await db.lead.count()).toBe(1);
    const touches = await db.leadTouch.findMany({ where: { leadId: first.leadId } });
    expect(touches.map((t) => t.source).sort()).toEqual(["PORTAL", "WEBSITE"]);
    // first source keeps the credit for cost per visit
    expect((await db.lead.findUniqueOrThrow({ where: { id: first.leadId } })).source).toBe("PORTAL");
  });

  it("same email links even with no phone", async () => {
    const a = await intakeLead({ name: "Nidhi Shah", email: "Nidhi@Example.com", source: "SOCIAL_AD", projectId: "P1", consent: true }, { now: NOW });
    const b = await intakeLead({ email: "nidhi@example.com ", source: "WEBSITE", consent: true }, { now: NOW });
    expect(b).toMatchObject({ outcome: "LINKED", leadId: a.leadId });
  });

  it("similar name + same project + different phone → possible duplicate for an exec, not auto-merged", async () => {
    const a = await intakeLead({ name: "Kavita Joshi", phone: "9898011111", source: "HOARDING", projectId: "P1", consent: true }, { now: NOW });
    const b = await intakeLead({ name: "Joshi Kavita", phone: "9898022222", source: "PORTAL", projectId: "P1", consent: true }, { now: NOW });
    expect(b.outcome).toBe("POSSIBLE_DUPLICATE");
    expect(b.matchedLeadId).toBe(a.leadId);
    expect(await db.lead.count()).toBe(2);

    const head = await db.user.findFirstOrThrow({ where: { role: "SALES_HEAD" } });
    await resolveDuplicate(b.leadId, "LINK", head.id);
    const linked = await db.lead.findUniqueOrThrow({ where: { id: b.leadId } });
    expect(linked.dupStatus).toBe("LINKED");
    expect(linked.status).toBe("CLOSED");
    // never deleted
    expect(await db.lead.count()).toBe(2);
  });

  it("rejects a lead with no usable contact", async () => {
    await expect(intakeLead({ name: "X", phone: "12345", source: "PORTAL", consent: true }, { now: NOW })).rejects.toThrow();
  });

  it("first-touch message only with consent, and it counts as first response", async () => {
    const withConsent = await intakeLead(
      { name: "A B", phone: "9000000001", source: "PORTAL", projectId: "P1", consent: true, sendFirstTouch: true },
      { now: NOW },
    );
    const without = await intakeLead(
      { name: "C D", phone: "9000000002", source: "PORTAL", projectId: "P1", consent: false, sendFirstTouch: true },
      { now: NOW },
    );
    const l1 = await db.lead.findUniqueOrThrow({ where: { id: withConsent.leadId }, include: { outbox: true } });
    const l2 = await db.lead.findUniqueOrThrow({ where: { id: without.leadId }, include: { outbox: true } });
    expect(l1.outbox).toHaveLength(1);
    expect(l1.outbox[0].body).toContain("PR/GJ/TEST/P1");
    expect(l1.firstResponseAt).toEqual(NOW);
    expect(l2.outbox).toHaveLength(0);
    expect(l2.firstResponseAt).toBeNull();
  });

  it("assignment prefers the buyer's language, then the lighter load", async () => {
    const gu = await pickExecutive(db, { projectId: "P1", language: "GU", now: NOW });
    const hi = await pickExecutive(db, { projectId: "P1", language: "HI", now: NOW });
    expect((await db.user.findUniqueOrThrow({ where: { id: gu } })).name).toBe("Asha Exec");
    expect((await db.user.findUniqueOrThrow({ where: { id: hi } })).name).toBe("Bharat Exec");
    // nobody on an unknown project → sales head
    const none = await pickExecutive(db, { projectId: "P9", language: "EN", now: NOW });
    expect((await db.user.findUniqueOrThrow({ where: { id: none } })).role).toBe("SALES_HEAD");
  });
});
