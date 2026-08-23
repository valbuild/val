import { c, s } from "../val.config";

/**
 * A `.jsonValues()` record whose entry file is NOT at the path its key derives.
 *
 * The key↔file mapping is canonical — `getNewJsonEntryPaths` derives it, and every
 * write (the commit flow, `jsonValues:extract-entry`) uses it — so `/moved` must
 * live in `./basic-noncanonical-json-values/moved.val.json`. Here it is parked in
 * a hand-chosen directory instead, which typechecks and loads fine: validation is
 * the only thing that can catch it, and `jsonValues:rename-entry-file` moves it
 * back.
 */
export default c.define(
  "/content/basic-noncanonical-json-values.val.ts",
  s
    .record(s.object({ title: s.string().minLength(2), order: s.number() }))
    .jsonValues(),
  {
    "/canonical": c.json(
      () => import("./basic-noncanonical-json-values/canonical.val.json"),
    ),
    "/moved": c.json(
      () =>
        import("./basic-noncanonical-json-values-entries/hand-placed.val.json"),
    ),
  },
);
