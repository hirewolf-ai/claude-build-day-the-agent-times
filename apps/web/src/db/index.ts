import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url =
  process.env.DATABASE_URL ??
  "postgresql://agenttimes:agenttimes@localhost:5433/agenttimes";

// Reuse the client across hot reloads in dev (avoid exhausting connections).
const globalForDb = globalThis as unknown as { _atSql?: ReturnType<typeof postgres> };
const sql = globalForDb._atSql ?? postgres(url);
if (process.env.NODE_ENV !== "production") globalForDb._atSql = sql;

export const db = drizzle(sql, { schema });
export { schema };
