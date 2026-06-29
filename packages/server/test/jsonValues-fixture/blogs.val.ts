import { s, c } from "./val.config";

export default c.define(
  "/blogs.val.ts",
  s.record(s.object({ title: s.string() })).jsonValues(),
  {
    "/blogs/test": c.json(
      () => import("./page/blogs/test.val.json"),
      "testsha123",
    ),
  },
);
