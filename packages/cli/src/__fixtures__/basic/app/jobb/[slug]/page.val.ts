import { c, nextAppRouter, s } from "../../../val.config";

/**
 * The shape the `.jsonValues()` path bug was reported on: a ROUTER whose entry
 * content — including an `s.image()` — lives in a `*.val.json` next to the
 * module. A router serializes as a record, so it takes the same jsonValues code
 * path, but nothing pinned that until this fixture.
 */
export default c.define(
  "/app/jobb/[slug]/page.val.ts",
  s
    .router(
      nextAppRouter,
      s.object({ header: s.string(), pageImage: s.image() }),
    )
    .jsonValues(),
  {
    "/jobb/student": c.json(() => import("./page/jobb/student.val.json")),
  },
);
