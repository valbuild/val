import { s, c } from "./val.config";

export default c.define(
  "/blogs.val.ts",
  s.record(s.object({ title: s.string() })).jsonValues(),
  {
    // Canonical path: the key is the filename, under a folder named after the
    // `.val.ts` (`getNewJsonEntryPaths`). Anything else is a
    // `jsonValues:rename-entry-file` validation error.
    "/blogs/test": c.json(() => import("./blogs/blogs/test.val.json")),
  },
);
