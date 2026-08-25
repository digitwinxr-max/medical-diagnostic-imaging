import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

let pool: Pool;
let db: ReturnType<typeof drizzle>;

function createMockDrizzle(): ReturnType<typeof drizzle> {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void) => resolve([]);
      }
      if (prop === "catch") {
        return () => Promise.resolve([]);
      }
      if (prop === "finally") {
        return (cb: () => void) => {
          cb?.();
          return Promise.resolve([]);
        };
      }
      if (prop === "query") {
        return new Proxy({}, {
          get: () => ({
            findMany: async () => [],
            findFirst: async () => null,
            findUnique: async () => null,
            create: async (d: { data?: unknown }) => d?.data ?? {},
            update: async (d: { data?: unknown }) => d?.data ?? {},
            delete: async () => ({}),
          }),
        });
      }
      return (..._args: unknown[]) => new Proxy(() => {}, handler);
    },
    apply() {
      return new Proxy(() => {}, handler);
    },
  };
  return new Proxy(() => {}, handler) as unknown as ReturnType<typeof drizzle>;
}

if (!databaseUrl) {
  console.warn("[AI Studio] DATABASE_URL is not set — using in-memory database mock");
  pool = {
    query: async () => ({ rows: [] }),
    connect: async () => ({ query: async () => ({ rows: [] }), release: () => {} }),
    end: async () => {},
  } as unknown as Pool;
  db = createMockDrizzle();
} else {
  try {
    pool =
      globalForDb.__arenaNextJsPostgresqlPool ??
      new Pool({
        connectionString: databaseUrl,
      });

    if (process.env.NODE_ENV !== "production") {
      globalForDb.__arenaNextJsPostgresqlPool = pool;
    }

    db = drizzle(pool);
  } catch (e) {
    console.warn("[AI Studio] Database connection initialization failed — using mock:", e);
    pool = {
      query: async () => ({ rows: [] }),
      connect: async () => ({ query: async () => ({ rows: [] }), release: () => {} }),
      end: async () => {},
    } as unknown as Pool;
    db = createMockDrizzle();
  }
}

export { pool, db };

