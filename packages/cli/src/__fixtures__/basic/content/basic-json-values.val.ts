import { c, s } from "../val.config";

/**
 * A `.jsonValues()` record whose entry content lives in separate files. The
 * point of the fixture: the `.val.ts` itself is always structurally valid — the
 * only thing that can be wrong is INSIDE an entry, which is exactly what
 * `val validate` used to miss.
 */
export default c.define(
  "/content/basic-json-values.val.ts",
  s
    .record(s.object({ title: s.string().minLength(2), order: s.number() }))
    .jsonValues(),
  {
    "/ok": c.json(() => import("./basic-json-values/ok.val.json")),
    "/broken": c.json(() => import("./basic-json-values/broken.val.json")),
  },
);
