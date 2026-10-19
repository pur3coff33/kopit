import type { Env } from "./env";
import { toDateInput } from "./lib/time";

export const BACKUP_PREFIX = "backups/";
export const KEEP_BACKUPS = 30;

// Parents before children so the dump replays cleanly into a fresh, migrated database.
const TABLES = ["households", "profiles", "categories", "entries"] as const;
const ORDER_BY: Record<(typeof TABLES)[number], string> = {
  households: "id",
  profiles: "id",
  categories: "id",
  entries: "created_at, id",
};

function literal(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  if (typeof v === "boolean") return v ? "1" : "0";
  return `'${String(v).replace(/'/g, "''")}'`;
}

/** Every table except sessions as INSERT statements, one per line. */
export async function dumpToSql(env: Env): Promise<string> {
  const results = await env.DB.batch(TABLES.map((t) => env.DB.prepare(`SELECT * FROM "${t}" ORDER BY ${ORDER_BY[t]}`)));
  const lines = [`-- kopit backup ${new Date().toISOString()}`];
  TABLES.forEach((table, i) => {
    for (const row of results[i].results as Record<string, unknown>[]) {
      const cols = Object.keys(row);
      lines.push(`INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map((c) => literal(row[c])).join(", ")});`);
    }
  });
  return lines.join("\n") + "\n";
}

export async function runBackup(env: Env, now: number): Promise<string> {
  const key = `${BACKUP_PREFIX}kopit-${toDateInput(now)}.sql`;
  await env.BACKUPS.put(key, await dumpToSql(env), { httpMetadata: { contentType: "application/sql" } });
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.BACKUPS.list({ prefix: BACKUP_PREFIX, cursor });
    keys.push(...page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  keys.sort();
  const old = keys.slice(0, Math.max(0, keys.length - KEEP_BACKUPS));
  if (old.length) await env.BACKUPS.delete(old);
  return key;
}
