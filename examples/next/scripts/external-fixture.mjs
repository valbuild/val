// Seeds the SQLite store the external-record example reads from.
//
// Deliberately a SCRIPT, not something the app does on boot: the store is not
// the repository, and content that appears because a process started is content
// nobody wrote. Run it once, then edit in the Studio.
//
//   node scripts/external-fixture.mjs           # seed
//   node scripts/external-fixture.mjs --reset   # drop the rows first
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// Resolved against THIS FILE, not the working directory: run from the repo root
// and a cwd-relative path would quietly create a second, empty store there —
// which then looks like the app losing its content.
const exampleDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const file =
  process.env.VAL_EXAMPLE_DB ?? path.join(exampleDir, ".val-example-store.db");

const db = new DatabaseSync(file);
db.exec("PRAGMA journal_mode = WAL");

// The same DDL the adapter runs on demand — kept here too so the script works
// against a database the app has never opened.
db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    key TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    price INTEGER NOT NULL DEFAULT 0,
    in_stock INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);
db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS products_fts USING fts5(
    key UNINDEXED, title, description, content='products', content_rowid='rowid'
  )
`);
db.exec(`
  CREATE TRIGGER IF NOT EXISTS products_ai AFTER INSERT ON products BEGIN
    INSERT INTO products_fts(rowid, key, title, description)
    VALUES (new.rowid, new.key, new.title, new.description);
  END
`);
db.exec(`
  CREATE TRIGGER IF NOT EXISTS products_ad AFTER DELETE ON products BEGIN
    INSERT INTO products_fts(products_fts, rowid, key, title, description)
    VALUES ('delete', old.rowid, old.key, old.title, old.description);
  END
`);
db.exec(`
  CREATE TRIGGER IF NOT EXISTS products_au AFTER UPDATE ON products BEGIN
    INSERT INTO products_fts(products_fts, rowid, key, title, description)
    VALUES ('delete', old.rowid, old.key, old.title, old.description);
    INSERT INTO products_fts(rowid, key, title, description)
    VALUES (new.rowid, new.key, new.title, new.description);
  END
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS documents (
    path TEXT PRIMARY KEY,
    mime_type TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS document_bytes (
    path TEXT PRIMARY KEY,
    sha256 TEXT NOT NULL,
    bytes BLOB NOT NULL
  )
`);

if (process.argv.includes("--reset")) {
  db.exec("DELETE FROM products");
  db.exec("DELETE FROM documents");
  db.exec("DELETE FROM document_bytes");
}

/**
 * Enough rows to page.
 *
 * 137 rather than 100, so the last page is a partial one — an off-by-one in
 * paging hides completely behind a row count that divides evenly.
 */
const CATEGORIES = ["anvil", "bucket", "crate", "drum", "easel"];
const insert = db.prepare(`
  INSERT INTO products (key, title, description, price, in_stock)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET
    title = excluded.title,
    description = excluded.description,
    price = excluded.price,
    in_stock = excluded.in_stock
`);

db.exec("BEGIN");
for (let i = 0; i < 137; i++) {
  const category = CATEGORIES[i % CATEGORIES.length];
  const n = String(i).padStart(3, "0");
  insert.run(
    `${category}-${n}`,
    `${category[0].toUpperCase()}${category.slice(1)} ${n}`,
    `A sturdy ${category}, number ${n}. Suitable for demonstrations.`,
    1000 + i * 25,
    i % 7 === 0 ? 0 : 1,
  );
}

const readme = Buffer.from(
  "This file's bytes live in the database, not in /public.\n",
  "utf-8",
);
db.prepare(
  `INSERT INTO documents (path, mime_type) VALUES (?, ?)
   ON CONFLICT(path) DO UPDATE SET mime_type = excluded.mime_type`,
).run("/public/val/documents/readme_a1b2c.txt", "text/plain");
db.prepare(
  `INSERT INTO document_bytes (path, sha256, bytes) VALUES (?, ?, ?)
   ON CONFLICT(path) DO UPDATE SET sha256 = excluded.sha256, bytes = excluded.bytes`,
).run(
  "/public/val/documents/readme_a1b2c.txt",
  "seeded",
  new Uint8Array(readme),
);
db.exec("COMMIT");

const { n } = db.prepare("SELECT COUNT(*) AS n FROM products").get();
console.log(`Seeded ${n} products and 1 document into ${file}`);
