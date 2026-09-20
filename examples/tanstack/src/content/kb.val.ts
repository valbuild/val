import { s, c, type t } from "../../val.config";
import authorsVal from "./authors.val";

/**
 * `.jsonValues()` plus `c.json()`: entries that live in their own files.
 *
 * What is written here is the `import()` thunk, not the content. The `.val.ts`
 * stays small, and the runtime, the Studio and validation each work one entry at
 * a time — which is what lets a record (or a router) hold many thousands of them
 * without loading them all to answer a question about one.
 *
 * The item schema is an ordinary schema, so everything else still applies:
 * `s.keyOf` points outward at another module, `s.route()` at a page of this app,
 * and `.preview()` names each row.
 */
export const articleSchema = s
  .object({
    title: s.string().minLength(2),
    body: s.string().multiline().describe("Plain text, in a text box"),
    order: s.number().min(0).max(999),
    author: s.keyOf(authorsVal),
    /** `s.route()`: a string that has to be a route this app serves. */
    related: s
      .route()
      .include(/^\/docs\//)
      .describe("A page under /docs"),
  })
  .preview(({ val }) => ({ title: val.title, subtitle: val.body }));

export type Article = t.inferSchema<typeof articleSchema>;

export default c.define(
  "/src/content/kb.val.ts",
  s.record(articleSchema).jsonValues(),
  {
    "what-is-val": c.json(() => import("./kb/what-is-val.val.json")),
    "why-file-per-entry": c.json(
      () => import("./kb/why-file-per-entry.val.json"),
    ),
  },
);
