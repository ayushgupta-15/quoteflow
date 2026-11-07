import { randomBytes } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { queryOne } from "./db";

export type Role = "estimator" | "sales_head";

export interface SessionUser {
  id: number;
  email: string;
  name: string;
  role: Role;
}

const COOKIE = "qf_session";
const MAX_AGE_SECONDS = 60 * 60 * 8;

const globalForSecret = globalThis as unknown as { __devSecret?: Uint8Array };

function secret(): Uint8Array {
  const configured = process.env.SESSION_SECRET;
  if (configured && configured.length >= 32) return new TextEncoder().encode(configured);
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET must be set to a random string of 32+ characters");
  }
  // Dev only: a random per-process secret, so no fallback secret lives in the repository.
  globalForSecret.__devSecret ??= randomBytes(32);
  return globalForSecret.__devSecret;
}

export async function startSession(userId: number): Promise<void> {
  const token = await new SignJWT({ uid: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secret());
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

/** The signed-in user, re-read from the database on every request so removed users lose access. */
export async function getUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    const user = await queryOne<SessionUser>(
      "select id, email, name, role from users where id = $1",
      [payload.uid as number],
    );
    return user ?? null;
  } catch {
    return null;
  }
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

export class ForbiddenError extends Error {
  constructor(message = "You do not have permission to do that") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) throw new ForbiddenError();
  return user;
}
