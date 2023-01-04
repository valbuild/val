import { s, val } from "../val.config";

export default val.content("/blog", () =>
  s
    .object({ title: s.string(), text: s.string() })
    .static({ title: "Blog", text: "This is the blog page" })
);
