import type { Fact, Project } from "@prisma/client";
import type { DbOrTx } from "../db";
import type { Lang } from "../../i18n";

export type FactSheet = { projects: Project[]; facts: Fact[] };

export async function loadFactSheet(db: DbOrTx): Promise<FactSheet> {
  const [projects, facts] = await Promise.all([
    db.project.findMany({ orderBy: { id: "asc" } }),
    db.fact.findMany({ where: { published: true }, orderBy: [{ projectId: "asc" }, { key: "asc" }] }),
  ]);
  return { projects, facts };
}

/**
 * Approved text in every language: the only place money amounts may come from.
 * Scoped to the buyer's project so Project 1's price can't be quoted in a Project 2 chat.
 */
export function factCorpus(sheet: FactSheet, projectId?: string | null): string {
  return sheet.facts
    .filter((f) => !projectId || !f.projectId || f.projectId === projectId)
    .flatMap((f) => [f.valueEn, f.valueHi ?? "", f.valueGu ?? ""])
    .join("\n");
}

const LANG_NAME: Record<Lang, string> = { EN: "English", HI: "Hindi", GU: "Gujarati" };

/** fact sheet rendered for the system prompt; stored translations included so the model copies them */
export function factsForPrompt(sheet: FactSheet, lang: Lang): string {
  const lines: string[] = [];
  const general = sheet.facts.filter((f) => !f.projectId);
  if (general.length) {
    lines.push("## Company A (all projects)");
    for (const f of general) lines.push(factLine(f, lang));
  }
  for (const p of sheet.projects) {
    lines.push(`\n## ${p.name} (project_id: ${p.id}) — RERA ${p.reraNumber}`);
    lines.push(`- Configurations: ${p.bhkOptions.join(", ")}`);
    for (const f of sheet.facts.filter((x) => x.projectId === p.id)) lines.push(factLine(f, lang));
  }
  return lines.join("\n");
}

function factLine(f: Fact, lang: Lang) {
  const tag = f.tag === "RERA_REGISTERED" ? "registered" : "marketing";
  let line = `- [${f.key}] ${f.label} (${tag}): ${f.valueEn}`;
  const local = lang === "HI" ? f.valueHi : lang === "GU" ? f.valueGu : null;
  if (local) line += `\n  ${LANG_NAME[lang]} approved text (use exactly): ${local}`;
  return line;
}
