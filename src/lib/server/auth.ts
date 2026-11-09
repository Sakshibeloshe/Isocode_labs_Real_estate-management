import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { db } from "./db";
import { sessionSecret } from "./env";

const COOKIE = "la_session";
const TTL_S = 12 * 60 * 60; // one working day

export type SessionUser = { id: string; name: string; email: string; role: Role };

export async function createSession(user: { id: string; role: Role }) {
  const jwt = await new SignJWT({ role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${TTL_S}s`)
    .sign(sessionSecret());
  (await cookies()).set(COOKIE, jwt, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: TTL_S,
  });
}

export async function destroySession() {
  (await cookies()).delete(COOKIE);
}

/** verified session + fresh user row (so deactivating someone takes effect immediately) */
export async function currentUser(): Promise<SessionUser | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  try {
    const { payload } = await jwtVerify(raw, sessionSecret(), { algorithms: ["HS256"] });
    if (!payload.sub) return null;
    const user = await db.user.findFirst({ where: { id: payload.sub, active: true }, select: { id: true, name: true, email: true, role: true } });
    return user;
  } catch {
    return null;
  }
}

/** pages: redirect to login / home if not allowed */
export async function requireUser(roles?: Role[]): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (roles && !roles.includes(user.role)) redirect("/staff/leads?denied=1");
  return user;
}

export class AuthError extends Error {
  constructor(public status: 401 | 403) {
    super(status === 401 ? "Please sign in" : "You don't have access to this");
  }
}

/** actions + API: throw instead of redirecting */
export async function assertUser(roles?: Role[]): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) throw new AuthError(401);
  if (roles && !roles.includes(user.role)) throw new AuthError(403);
  return user;
}

/** executives see their own leads; the sales head sees everyone */
export function leadScope(user: SessionUser) {
  return user.role === "SALES_HEAD" ? {} : { ownerId: user.id };
}
