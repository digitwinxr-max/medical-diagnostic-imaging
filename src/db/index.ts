import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

let pool: Pool;
let db: ReturnType<typeof drizzle>;

if (!databaseUrl) {
  console.warn("DATABASE_URL is not set — database features will be unavailable until configured (.env)");
  // Create a proxy that throws only when actually used, so instrumentation hook doesn't crash Next.js startup
  pool = null as unknown as Pool;
  db = new Proxy({} as ReturnType<typeof drizzle>, {
    get(_target, prop) {
      if (prop === "then") return undefined;
      throw new Error("DATABASE_URL is required — configure .env with DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app_db");
    },
  });
} else {
  pool =
    globalForDb.__arenaNextJsPostgresqlPool ??
    new Pool({
      connectionString: databaseUrl,
    });

  if (process.env.NODE_ENV !== "production") {
    globalForDb.__arenaNextJsPostgresqlPool = pool;
  }

  db = drizzle(pool);
}

export { pool, db };
