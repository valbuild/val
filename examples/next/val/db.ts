import "server-only";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

/**
 * The example's stand-in for a production database.
 *
 * `node:sqlite` because it ships with Node and needs no install step: the point
 * of this example is the ADAPTER, and a reader should be able to run it without
 * standing up Postgres first. Everything here would be the same shape against a
 * real database — a connection, a transaction seam, and some queries.
 *
 * Two things about `node:sqlite` are worth knowing before copying this:
 *
 * - **`db.transaction()` is synchronous.** It takes a synchronous function, so
 *   it cannot wrap the async callback `around` hands over. The transaction is
 *   therefore driven with explicit `BEGIN` / `COMMIT` / `ROLLBACK`, which is
 *   also what most async drivers do underneath.
 * - **It is still flagged experimental**, so Node prints a warning on first use.
 */

/**
 * Opened lazily, and never at module load.
 *
 * A build must not read the store — that is the whole point of the two clocks:
 * the repository's content is committed and built, and the store's content is
 * live. Opening a connection here would run at import time, which for a Next
 * build means during collection, and the store would then be a build
 * dependency.
 */
let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db === null) {
    // `cwd` is right HERE, unlike in the seed script: a Next server runs from
    // the app root, and that is where the store belongs. `VAL_EXAMPLE_DB` is the
    // override for anything that does not.
    const file =
      process.env.VAL_EXAMPLE_DB ??
      path.join(process.cwd(), ".val-example-store.db");
    db = new DatabaseSync(file);
    db.exec("PRAGMA journal_mode = WAL");
    migrate(db);
  }
  return db;
}

/**
 * The tables, created on demand.
 *
 * On demand rather than by a migration step so that a fresh checkout works:
 * `pnpm dev` and `pnpm build` both succeed against a database that does not
 * exist yet, and an empty store is a legitimate state — an external record with
 * no rows is an empty record, not a broken one.
 */
function migrate(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS products (
      key TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      price INTEGER NOT NULL DEFAULT 0,
      in_stock INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  // Full-text search, so the adapter can DELEGATE search instead of leaving Val
  // to answer from whatever it has already paged. FTS5 is compiled into the
  // SQLite that ships with Node.
  database.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS products_fts USING fts5(
      key UNINDEXED, title, description, content='products', content_rowid='rowid'
    )
  `);
  database.exec(`
    CREATE TRIGGER IF NOT EXISTS products_ai AFTER INSERT ON products BEGIN
      INSERT INTO products_fts(rowid, key, title, description)
      VALUES (new.rowid, new.key, new.title, new.description);
    END
  `);
  database.exec(`
    CREATE TRIGGER IF NOT EXISTS products_ad AFTER DELETE ON products BEGIN
      INSERT INTO products_fts(products_fts, rowid, key, title, description)
      VALUES ('delete', old.rowid, old.key, old.title, old.description);
    END
  `);
  database.exec(`
    CREATE TRIGGER IF NOT EXISTS products_au AFTER UPDATE ON products BEGIN
      INSERT INTO products_fts(products_fts, rowid, key, title, description)
      VALUES ('delete', old.rowid, old.key, old.title, old.description);
      INSERT INTO products_fts(rowid, key, title, description)
      VALUES (new.rowid, new.key, new.title, new.description);
    END
  `);
  // The documents gallery: metadata in one table, bytes in another. Separate so
  // that listing a gallery never reads a blob — the same reason Val keeps a
  // gallery's metadata out of its files.
  database.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      path TEXT PRIMARY KEY,
      mime_type TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  database.exec(`
    CREATE TABLE IF NOT EXISTS document_bytes (
      path TEXT PRIMARY KEY,
      sha256 TEXT NOT NULL,
      bytes BLOB NOT NULL
    )
  `);
}

/** The transaction handle an adapter method is given. */
export type Tx = { db: DatabaseSync };
