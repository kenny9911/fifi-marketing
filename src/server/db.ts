import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { runSeeds } from "./seeds";

/**
 * better-sqlite3 singleton. Cached on globalThis so Next dev hot-reload does
 * not stack up duplicate connections. Schema (src/server/schema.sql) is
 * idempotent and executed on first open, then seeds run (also idempotent).
 */

const globalForDb = globalThis as unknown as { __fifiDb?: Database.Database };

function openDatabase(): Database.Database {
  const file = process.env.FIFI_DB_PATH ?? path.join(process.cwd(), "data", "fifi.db");
  if (file !== ":memory:") {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  // `timeout` + busy_timeout: when several processes (dev server + tests, or
  // build workers) touch the same file, writers wait instead of throwing
  // SQLITE_BUSY immediately.
  const conn = new Database(file, { timeout: 10_000 });
  conn.pragma("busy_timeout = 10000");
  conn.pragma("journal_mode = WAL");
  conn.pragma("foreign_keys = ON");
  const schemaPath = path.join(process.cwd(), "src", "server", "schema.sql");
  conn.exec(fs.readFileSync(schemaPath, "utf8"));
  runSeeds(conn);
  return conn;
}

function getDb(): Database.Database {
  return (globalForDb.__fifiDb ??= openDatabase());
}

/**
 * Lazy proxy: the connection opens on first *use*, not at import time.
 * `next build` page-data collection imports every route module across many
 * parallel workers; opening (and migrating/seeding) the database during
 * module evaluation makes those workers race on the file (SQLITE_BUSY).
 */
export const db: Database.Database = new Proxy({} as Database.Database, {
  get(_target, prop) {
    const real = getDb();
    const value = Reflect.get(real, prop, real) as unknown;
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(real)
      : value;
  },
  set(_target, prop, value) {
    Reflect.set(getDb(), prop, value);
    return true;
  },
});

export function uid(): string {
  return randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}
