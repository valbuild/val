import { c, s } from "../val.config";

/**
 * A `.jsonValues()` record with one entry hand-authored INLINE instead of
 * `c.json(() => import(...))`. The types allow it on purpose (a type error there
 * is a dead end for the author); validation reports it as
 * `jsonValues:extract-entry` and `--fix` moves it into its own `*.val.json`.
 */
export default c.define(
  "/content/basic-inline-json-values.val.ts",
  s.record(s.object({ title: s.string(), order: s.number() })).jsonValues(),
  {
    "/ok": c.json(() => import("./basic-inline-json-values/ok.val.json")),
    "/inline": { title: "Written inline", order: 3 },
  },
);
