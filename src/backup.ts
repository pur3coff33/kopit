import { getTableColumns, getTableName, type Table } from "drizzle-orm";
import { categories, deletedEntries, entries, households, profiles } from "./db/schema";
import type { Env } from "./env";
import { toDateInput } from "./lib/time";

export const BACKUP_PREFIX = "backups/";
export const KEEP_BACKUPS = 30;

// Parents before children so the dump replays cleanly into a fresh, migrated database.
// Sessions are left out on purpose: after a restore everyone logs in again.
const TABLES: Array<[Table, string]> = [
  [households, "id"],
  [profiles, "id"],
  [categories, "id"],
  [entries, "created_at, id"],
  [deletedEntries, "deleted_at, id"],
];

/**
 * SQLite builds each INSERT line itself (quote() handles escaping and NULL), so the Worker
 * only joins strings — this keeps the nightly job inside the Free plan's CPU budget as data grows.
 */
function insertLinesQuery([table, orderBy]: [Table, string]): string {
  const name = getTableName(table);
  const cols = Object.values(getTableColumns(table)).map((c) => c.name);
  const head = `INSERT INTO "${name}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (`;
  const values = cols.map((c) => `quote("${c}")`).join(" || ', ' || ");
  return `SELECT '${head}' || ${values} || ');' FROM "${name}" ORDER BY ${orderBy}`;
}

/** Every table except sessions as INSERT statements, one per line. */
export async function dumpToSql(env: Env): Promise<string> {
  const results = await Promise.all(TABLES.map((t) => env.DB.prepare(insertLinesQuery(t)).raw<[string]>()));
  const lines = [`-- kopit backup ${new Date().toISOString()}`];
  for (const rows of results) for (const [line] of rows) lines.push(line);
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
