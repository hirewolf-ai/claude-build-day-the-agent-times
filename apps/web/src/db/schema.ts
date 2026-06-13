import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Readers. No login — identity is a random session id carried in an httpOnly
 * cookie. Multiple rows may share a name; the session id is what's unique.
 * "Clearing your session" = deleting the row (and the cookie).
 */
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionId: text("session_id").notNull().unique(),
  name: text("name").notNull(),
  location: text("location").notNull(), // LOCATIONS id, e.g. "sf"
  // Optional X profile, used by the agents to personalize the edition.
  xHandle: text("x_handle"), // clean handle, e.g. "aykut"
  xUrl: text("x_url"), // canonical link, e.g. "https://x.com/aykut"
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

/**
 * One newspaper edition per reader request. The collected news lives as a folder
 * of markdown files on disk (workspaceDir, e.g. /tmp/read-<datetime>/) — that
 * folder IS the warehouse. Collection agents write the beat files there; the
 * writer/columnist agents (Step 2) read them via the folder's CLAUDE.md index.
 */
export const editions = pgTable("editions", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionId: text("session_id"), // reader who asked (nullable for demo/manual runs)
  prompt: text("prompt").notNull().default(""), // "" = general edition
  status: text("status").notNull().default("collecting"), // collecting | printing | ready | failed
  workspaceDir: text("workspace_dir"), // /tmp/read-<datetime>/ — the news folder
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Edition = typeof editions.$inferSelect;
