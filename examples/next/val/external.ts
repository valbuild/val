import "server-only";
import {
  defineExternal,
  err,
  ok,
  type ExternalKeyPage,
  type ExternalSearchPage,
  type Returns,
} from "@valbuild/next/server";
import type { DatabaseSync } from "node:sqlite";
import documentsVal from "../content/documents.val";
import productsVal from "../content/products.val";
import { getDb, type Tx } from "./db";

/**
 * The adapters for this app's external records.
 *
 * `server-only`, and imported by `val/server.ts` and `val/rsc.ts` — never by a
 * `.val.ts`. That separation is the point: a `.val.ts` is evaluated by the CLI
 * inside a `node:vm` sandbox and its schema is bundled into the browser, and a
 * database driver survives neither.
 */

/**
 * One transaction per request.
 *
 * Driven with explicit statements because `node:sqlite`'s own
 * `db.transaction()` is SYNCHRONOUS: it takes a synchronous function, and the
 * callback here is async. Most async drivers do the same thing underneath, so
 * this is what porting to one looks like — `around: (run) => sql.begin(run)` for
 * postgres.js, `around: (run) => prisma.$transaction(run)` for Prisma.
 *
 * A 50-key read is therefore one transaction, not fifty: `around` wraps the
 * whole scope, chunking included.
 */
const { entry, modules } = defineExternal<Tx>({
  around: async (run) => {
    const db = getDb();
    db.exec("BEGIN");
    try {
      const result = await run({ db });
      db.exec("COMMIT");
      return result;
    } catch (e) {
      // A rollback that itself throws must not replace the real error: the
      // original is what says why the work failed.
      try {
        db.exec("ROLLBACK");
      } catch {
        // Already rolled back, or the connection is gone.
      }
      throw e;
    }
  },
  /**
   * SQLite locks the whole database for a write, so a concurrent writer shows up
   * as SQLITE_BUSY — transient, and worth another go. Everything else is not.
   */
  retry: {
    attempts: 3,
    backoff: (attempt) => 50 * attempt,
  },
});

type ProductRow = {
  key: string;
  title: string;
  description: string;
  price: number;
  in_stock: number;
};

const productItem = (row: ProductRow) => ({
  title: row.title,
  description: row.description,
  price: row.price,
  // SQLite has no boolean type. The schema does, so the adapter converts —
  // which is the ordinary shape of this work: the store's types are the store's.
  inStock: row.in_stock !== 0,
});

/**
 * Keyset paging: `WHERE key > ?`, not `OFFSET`.
 *
 * An offset re-counts every row it skips, so page 500 costs five hundred pages
 * of work; and a row inserted while an editor pages makes every later page skip
 * or repeat an entry. The cursor is the last key of the previous page, which is
 * both cheap and stable.
 */
const listProductKeys = (
  db: DatabaseSync,
  cursor: string | null,
  limit: number,
): ExternalKeyPage => {
  const rows = db
    .prepare("SELECT key FROM products WHERE key > ? ORDER BY key ASC LIMIT ?")
    .all(cursor ?? "", limit) as { key: string }[];
  return {
    keys: rows.map((row) => row.key),
    cursor: rows.length < limit ? null : rows[rows.length - 1].key,
  };
};

export default modules({
  products: entry(productsVal, {
    keys: async ({ cursor, limit }, { tx }) =>
      ok(listProductKeys(tx.db, cursor, limit)),

    get: async (keys, { tx }) => {
      // One statement for the whole batch. The alternative — a query per key —
      // is what `get` taking an array exists to prevent.
      const placeholders = keys.map(() => "?").join(",");
      const rows = tx.db
        .prepare(`SELECT * FROM products WHERE key IN (${placeholders})`)
        .all(...keys) as ProductRow[];
      const byKey = new Map(rows.map((row) => [row.key, row]));
      const out: Record<string, ReturnType<typeof productItem> | null> = {};
      for (const key of keys) {
        const row = byKey.get(key);
        // `null`, not absent: "no such product" and "the adapter forgot it" have
        // to be tellable apart.
        out[key] = row ? productItem(row) : null;
      }
      return ok(out);
    },

    put: async (entries, { tx }) => {
      // An UPSERT, because a publish may be replayed: a retry re-enters the
      // whole scope, so the same write can arrive twice.
      const stmt = tx.db.prepare(`
        INSERT INTO products (key, title, description, price, in_stock, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET
          title = excluded.title,
          description = excluded.description,
          price = excluded.price,
          in_stock = excluded.in_stock,
          updated_at = excluded.updated_at
      `);
      for (const [key, item] of Object.entries(entries)) {
        stmt.run(
          key,
          item.title,
          item.description,
          item.price,
          item.inStock ? 1 : 0,
        );
      }
      return ok(undefined);
    },

    delete: async (keys, { tx }) => {
      // Tolerates an absent key, for the same reason `put` upserts.
      const stmt = tx.db.prepare("DELETE FROM products WHERE key = ?");
      for (const key of keys) {
        stmt.run(key);
      }
      return ok(undefined);
    },

    /**
     * Delegated, because the database can do it and Val's fallback cannot: the
     * fallback answers from the entries Val has already paged, which on a large
     * store is a real answer over an incomplete corpus. FTS5 answers over all of
     * it.
     */
    search: async ({ text, cursor, limit }, { tx }) => {
      if (text.trim() === "") {
        return ok({ hits: [], cursor: null });
      }
      const offset = cursor === null ? 0 : Number(cursor);
      if (!Number.isFinite(offset) || offset < 0) {
        return err({ message: `Invalid search cursor: ${cursor}` });
      }
      let rows: (ProductRow & { key: string })[];
      try {
        rows = tx.db
          .prepare(
            `SELECT p.* FROM products_fts f
             JOIN products p ON p.rowid = f.rowid
             WHERE products_fts MATCH ?
             ORDER BY rank LIMIT ? OFFSET ?`,
          )
          .all(`${escapeFts(text)}*`, limit, offset) as ProductRow[];
      } catch (e) {
        // A malformed FTS query is the user's search box, not a bug: report it
        // rather than throwing, so the editor sees why nothing came back.
        return err({
          message: `Could not search products: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
      const page: ExternalSearchPage<ReturnType<typeof productItem>> = {
        hits: rows.map((row) => ({
          key: row.key,
          // The VALUE, so Val can re-check the hit against unpublished edits: a
          // delegated search sees published content only, and without the value
          // there is no way to drop a hit whose draft edit removed the words.
          value: productItem(row),
        })),
        cursor: rows.length < limit ? null : String(offset + rows.length),
      };
      return ok(page);
    },

    count: async ({ tx }) => {
      const row = tx.db.prepare("SELECT COUNT(*) AS n FROM products").get() as {
        n: number;
      };
      return ok(row.n);
    },

    /**
     * A token that changes when anything in the record changes, so the Studio's
     * existing poll can notice a change made outside it — by another editor, or
     * by the app's own admin screens.
     */
    version: async ({ tx }) => {
      const row = tx.db
        .prepare(
          "SELECT COALESCE(MAX(updated_at), '') AS v, COUNT(*) AS n FROM products",
        )
        .get() as { v: string; n: number };
      return ok(`${row.v}:${row.n}`);
    },
  }),

  documents: entry(documentsVal, {
    keys: async ({ cursor, limit }, { tx }) => {
      const rows = tx.db
        .prepare(
          "SELECT path FROM documents WHERE path > ? ORDER BY path ASC LIMIT ?",
        )
        .all(cursor ?? "", limit) as { path: string }[];
      return ok({
        keys: rows.map((row) => row.path),
        cursor: rows.length < limit ? null : rows[rows.length - 1].path,
      });
    },

    get: async (keys, { tx }) => {
      const placeholders = keys.map(() => "?").join(",");
      const rows = tx.db
        .prepare(`SELECT * FROM documents WHERE path IN (${placeholders})`)
        .all(...keys) as { path: string; mime_type: string }[];
      const byPath = new Map(rows.map((row) => [row.path, row]));
      const out: Record<string, { mimeType: string } | null> = {};
      for (const key of keys) {
        const row = byPath.get(key);
        // A gallery's item is metadata; the file is named by the record's key.
        out[key] = row ? { mimeType: row.mime_type } : null;
      }
      return ok(out);
    },

    put: async (entries, { tx }) => {
      const stmt = tx.db.prepare(`
        INSERT INTO documents (path, mime_type, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(path) DO UPDATE SET
          mime_type = excluded.mime_type,
          updated_at = excluded.updated_at
      `);
      for (const [path, item] of Object.entries(entries)) {
        stmt.run(path, item.mimeType ?? "application/octet-stream");
      }
      return ok(undefined);
    },

    delete: async (keys, { tx }) => {
      const meta = tx.db.prepare("DELETE FROM documents WHERE path = ?");
      const bytes = tx.db.prepare("DELETE FROM document_bytes WHERE path = ?");
      for (const key of keys) {
        meta.run(key);
        // The bytes go with the entry. Leaving them would be a slow leak whose
        // only symptom is a database that grows.
        bytes.run(key);
      }
      return ok(undefined);
    },

    /**
     * Where this record's bytes live.
     *
     * `put` stores them at the path VAL chose — an input, not something to
     * invent: the stored reference embeds it, so the same bytes get the same
     * name under every storage mode and a gallery can be moved back to local
     * files by writing them where the reference already says they belong. It is
     * idempotent on the content hash, so a replayed publish re-uses rather than
     * duplicating.
     */
    files: {
      // "bytes" because the store is a blob column: there is no URL to sign,
      // and this example runs on a local dev server, where routing bytes
      // through it costs nothing. An adapter backed by S3 would be
      // `type: "presigned"` instead — see the startup warning in
      // externalStartup.ts, which says so on a host that caps request bodies.
      type: "bytes",

      put: async (file, { tx }) => {
        tx.db
          .prepare(
            `INSERT INTO document_bytes (path, sha256, bytes) VALUES (?, ?, ?)
             ON CONFLICT(path) DO UPDATE SET sha256 = excluded.sha256, bytes = excluded.bytes`,
          )
          .run(file.path, file.sha256, file.bytes);
        return ok({ data: { storedAt: file.path } });
      },

      get: async (path, { tx }) => {
        const row = tx.db
          .prepare("SELECT bytes FROM document_bytes WHERE path = ?")
          .get(path) as { bytes: Uint8Array } | undefined;
        return ok(row ? new Uint8Array(row.bytes) : null);
      },
    },
  }),
});

/**
 * Make a search box's text safe to hand to FTS5.
 *
 * FTS5's query language has operators — `AND`, `NEAR`, `"`, `*` — and an editor
 * typing `"` into a search box means a quote mark, not a phrase delimiter.
 * Quoting each token turns the whole input into literal terms.
 */
function escapeFts(text: string): string {
  return text
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .map((token) => `"${token.replace(/"/g, '""')}"`)
    .join(" ");
}
