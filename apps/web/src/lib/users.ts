import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, type User } from "@/db/schema";
import { getSessionId, ensureSessionId, clearSessionCookie } from "@/lib/session";

/** The reader for the current session, or null if not onboarded yet. */
export async function getCurrentUser(): Promise<User | null> {
  const sid = await getSessionId();
  if (!sid) return null;
  const [row] = await db.select().from(users).where(eq(users.sessionId, sid)).limit(1);
  return row ?? null;
}

type UpsertInput = {
  name: string;
  location: string;
  xHandle?: string | null;
  xUrl?: string | null;
};

/**
 * Create (or update) the reader for this session. Sets the session cookie if
 * absent. Same name is fine across sessions — sessionId is the identity.
 */
export async function upsertCurrentUser(input: UpsertInput): Promise<User> {
  const sid = await ensureSessionId();
  const values = {
    sessionId: sid,
    name: input.name,
    location: input.location,
    xHandle: input.xHandle ?? null,
    xUrl: input.xUrl ?? null,
  };
  const [row] = await db
    .insert(users)
    .values(values)
    .onConflictDoUpdate({
      target: users.sessionId,
      set: {
        name: values.name,
        location: values.location,
        xHandle: values.xHandle,
        xUrl: values.xUrl,
      },
    })
    .returning();
  return row;
}

/** Clear this reader's session: delete the row and forget the cookie. */
export async function clearCurrentSession() {
  const sid = await getSessionId();
  if (sid) await db.delete(users).where(eq(users.sessionId, sid));
  await clearSessionCookie();
}
