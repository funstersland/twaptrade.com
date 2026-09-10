import pg from "pg";

// Match the existing integer-money API while rejecting unsafe numeric values.
for (const oid of [20, 1700]) pg.types.setTypeParser(oid, (value: string) => {
  const number = Number(value);
  if (!Number.isFinite(number) || (Number.isInteger(number) && !Number.isSafeInteger(number)))
    throw new Error("Database value exceeds supported precision");
  return number;
});
let pool: pg.Pool | undefined;
export function postgresPool() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  if (process.env.TWAP_DB_SCHEMA && !/^[a-z][a-z0-9_]*$/.test(process.env.TWAP_DB_SCHEMA)) throw new Error("Invalid database schema");
  return pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL,
    max: 10, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000,
    ...(process.env.TWAP_DB_SCHEMA ? { options: `-c search_path=${process.env.TWAP_DB_SCHEMA},public` } : {}),
  });
}

export function postgresSQL(source: string) {
  let index = 0;
  // Only unquoted positional markers are translated; quoted user data is always bound.
  let sql = source.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|\?/g, (part) => part === "?" ? `$${++index}` : part);
  if (/^\s*INSERT OR IGNORE\b/i.test(sql)) sql = sql.replace(/INSERT OR IGNORE/i, "INSERT") + " ON CONFLICT DO NOTHING";
  sql = sql.replace(/\bjson_each\(/g, "twap_json_each(")
    .replace(/\bjson_array_length\(/g, "twap_json_array_length(")
    .replace(/printf\('%.2f',([^)]*)\)/g, "to_char($1, 'FM999999999999990.00')")
    .replace(/\bJOIN twap_json_each\(([^)]*)\) r(?= WHERE| JOIN)/g, "CROSS JOIN twap_json_each($1) r")
    .replace(/\bLIKE\b/g, "ILIKE");
  return sql;
}
type Executor = Pick<pg.PoolClient, "query">;
class Statement {
  constructor(readonly sql: string, readonly values: unknown[] = []) {}
  bind(...values: unknown[]) { return new Statement(this.sql, values); }
  async execute(client: Executor) {
    const r = await client.query(postgresSQL(this.sql), this.values);
    return { results: r.rows, success: true, meta: { changes: r.command === "SELECT" ? 0 : (r.rowCount ?? 0) } };
  }
  async all<T = Record<string, unknown>>() {
    const result = /^\s*(SELECT|WITH)\b/i.test(this.sql)
      ? await this.execute(postgresPool()) : (await transaction([this]))[0];
    return result as {results: T[]; success: boolean; meta: {changes: number}};
  }
  async first<T = Record<string, unknown>>(column?: string) {
    const row = (await this.all<T>()).results[0];
    return column ? (row as Record<string, unknown> | undefined)?.[column] ?? null : row ?? null;
  }
  async run() { return (await transaction([this]))[0]; }
}
async function transaction(statements: Statement[]) {
  const client = await postgresPool().connect();
  try {
    await client.query("BEGIN");
    // All financial writes share this transaction lock, preserving D1's serial
    // write semantics across web replicas and concurrent ledger/deploy requests.
    await client.query("SELECT pg_advisory_xact_lock(847291104)");
    const results = [];
    for (const statement of statements) results.push(await statement.execute(client));
    await client.query("COMMIT");
    return results;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
export const postgresDatabase = {
  prepare(sql: string) { return new Statement(sql); },
  batch(statements: Statement[]) { return transaction(statements); },
};
