import type { Metadata } from "next";
import { requireUser } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { relativeTime } from "@/lib/time";
import { Notice } from "@/components/ui";
import FactEditor from "./editor";

export const metadata: Metadata = { title: "Fact sheet" };

export default async function FactsPage() {
  await requireUser(["SALES_HEAD"]);
  const [facts, projects] = await Promise.all([
    db.fact.findMany({ orderBy: [{ projectId: "asc" }, { key: "asc" }], include: { revisions: { orderBy: { version: "desc" }, take: 3 } } }),
    db.project.findMany({ orderBy: { id: "asc" } }),
  ]);
  const groups = [{ id: "", name: "All projects" }, ...projects.map((p) => ({ id: p.id, name: `${p.name} · RERA ${p.reraNumber}` }))];
  const now = new Date();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="wide text-3xl font-semibold">Fact sheet</h1>
        <p className="mt-1 max-w-2xl text-ink-2">
          The assistant can only say what is published here. Anything else, it hands to a person. Hindi and Gujarati text, where given, is used word for word instead of a machine translation.
        </p>
      </div>
      <Notice tone="amber">
        Mark a fact &ldquo;RERA registered&rdquo; only if it matches the registered project details. Price is always shown as indicative, and the assistant never quotes discounts or a final price.
      </Notice>

      {groups.map((g) => {
        const list = facts.filter((f) => (f.projectId ?? "") === g.id);
        return (
          <section key={g.id || "all"}>
            <h2 className="text-lg font-semibold">{g.name}</h2>
            <div className="mt-3 divide-y divide-line-2 rounded-[var(--radius-card)] border border-line bg-surface">
              {list.map((f) => (
                <FactEditor
                  key={f.id}
                  fact={{
                    id: f.id,
                    projectId: f.projectId ?? "",
                    key: f.key,
                    label: f.label,
                    valueEn: f.valueEn,
                    valueHi: f.valueHi ?? "",
                    valueGu: f.valueGu ?? "",
                    tag: f.tag,
                    published: f.published,
                    meta: `v${f.version} · edited ${relativeTime(f.updatedAt, now)}`,
                  }}
                />
              ))}
              <FactEditor fact={{ id: "", projectId: g.id, key: "", label: "", valueEn: "", valueHi: "", valueGu: "", tag: "MARKETING", published: true, meta: "" }} isNew />
            </div>
          </section>
        );
      })}
    </div>
  );
}
