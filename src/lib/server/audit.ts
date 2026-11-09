import type { Prisma } from "@prisma/client";
import type { DbOrTx } from "./db";

// who viewed/changed what (DPDP: log of access to personal data)
export async function audit(
  db: DbOrTx,
  userId: string | undefined | null,
  action: string,
  entity: string,
  entityId: string,
  detail?: Prisma.InputJsonValue,
) {
  await db.auditLog.create({ data: { userId: userId ?? null, action, entity, entityId, detail } });
}
