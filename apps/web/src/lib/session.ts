import "server-only";
import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";

export const SESSION_COOKIE = "at_session";

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 365, // a year
};

/** The current session id from the cookie, or null if none yet. */
export async function getSessionId(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

/** Ensure a session id exists; sets the cookie if missing. Returns the id. */
export async function ensureSessionId(): Promise<string> {
  const store = await cookies();
  const existing = store.get(SESSION_COOKIE)?.value;
  if (existing) return existing;
  const id = randomUUID();
  store.set(SESSION_COOKIE, id, COOKIE_OPTS);
  return id;
}

/** Forget this session (used by "clear session"). */
export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
