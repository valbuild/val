---
"@valbuild/core": minor
"@valbuild/shared": minor
"@valbuild/ui": minor
"@valbuild/server": minor
"@valbuild/next": minor
"@valbuild/react": minor
---

`s.record().external()`: content that lives in your database.

A third place content can live, next to code and `*.val.json` files: behind an
adapter you write — a database, an HTTP API, a bucket. The schema stays in your
repository and stays typed; only the entries move.

```ts
// content/products.val.ts — an ordinary .val.ts, with no driver in sight
export default c.define(
  "/content/products.val.ts",
  s
    .record(s.object({ title: s.string(), price: s.number() }))
    .external("products"),
  c.external(),
);
```

```ts
// val/external.ts — server-only, where the driver belongs
const { entry, modules } = defineExternal<Tx>({
  around: (run) => sql.begin(run), // one transaction per request
});

export default modules({
  products: entry(productsVal, {
    keys: async ({ cursor, limit }, { tx }) =>
      ok(await listKeys(tx, cursor, limit)),
    get: async (keys, { tx }) => ok(await rowsByKey(tx, keys)),
    put: async (entries, { tx }) => ok(await upsert(tx, entries)),
    delete: async (keys, { tx }) => ok(await remove(tx, keys)),
  }),
});
```

Then register it: `initValServer(valModules, { ...config, external }, { draftMode })`.

**Reading is the same everywhere.** `fetchVal` and `fetchValKey` work on an
external record and are the same functions you already call — an app must not
have to change which reader it uses when its content moves into a store.
`fetchValKeys` is the one addition, because no other storage mode has anything to
page. In the Studio, an external record renders through the same record UI as
every other record.

**Your adapter's types come from your schema.** The item type, the label and
whether the record is `.readonly()` all ride in the module's type, so a wrong row
shape is a compile error at the offending property, a `.readonly()` record that
supplies a `put` is rejected by name, and "find all references" on a schema field
reaches the adapter that produces it.

**What Val does when your adapter does less.** `count` and `search` are optional:
omit `count` and Val counts by paging keys, bounded, and says when it stopped
("200,000+"); omit `search` and Val answers from what it has already read and
labels the result partial rather than downloading your store. Either can be
`false` to decline — an editor is then told search is unavailable, which is a
different thing from no matches, and shown differently.

**Unpublished edits are visible.** Drafts never reach your store; they are applied
on top of what it returns, which includes correcting a delegated search for text
an editor has just typed or deleted.

**Other details worth knowing:**

- Every method may return `ok(value, warnings)` or `err({ message, retryable })`,
  or just the value. Retries re-enter the whole transaction where you have an
  `around` and repeat the single call where you do not; a thrown error is never
  retried.
- `s.images()`, `s.files()` and `s.router()` are all records, so they take
  `.external()` too. A media record requires `putFile` and `getFile`, checked at
  startup.
- Entries written inline in the `.val.ts` still compile — that is how content
  moves into a store — and `val validate` reports each as an `external:upload`
  fix. A blanket `val validate --fix` will not apply it, because applying it
  writes to a live store.
- An `.external()` module nobody bound, or a binding no module asks for, is a
  startup error. An unbound external record would otherwise read as empty, and
  empty is a legitimate state for a store.

**This release is read-only.** Reading works end to end — the Studio, the CLI and
your app all read external records. Writing them from the Studio comes next.

See `examples/next` for a complete SQLite-backed example, adapter and all.
