import { randomBytes } from "node:crypto";
import type { DbOrTx } from "./db";

export function token(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

/** next lead id: LD-58225, LD-58226 ... atomic counter row */
export async function nextLeadId(db: DbOrTx): Promise<string> {
  const rows = await db.$queryRaw<{ value: number }[]>`
    INSERT INTO "Counter" ("name", "value") VALUES ('lead', 58300)
    ON CONFLICT ("name") DO UPDATE SET "value" = "Counter"."value" + 1
    RETURNING "value"`;
  return `LD-${rows[0].value}`;
}
