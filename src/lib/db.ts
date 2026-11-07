import { Pool, type PoolClient, type QueryResultRow } from "pg";

const DEFAULT_URL = "postgres://quoteflow:quoteflow@localhost:54329/quoteflow";

const globalForPool = globalThis as unknown as { __pool?: Pool };

export function pool(): Pool {
  if (!globalForPool.__pool) {
    globalForPool.__pool = new Pool({
      connectionString: process.env.DATABASE_URL ?? DEFAULT_URL,
      max: 5,
    });
  }
  return globalForPool.__pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await pool().query<T>(text, params);
  return res.rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | undefined> {
  return (await query<T>(text, params))[0];
}

export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("begin");
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}
