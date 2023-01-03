import { s, val } from "../val.config";

export default val.content("/blog", () =>
  s.object({ title: s.string() }).static({ title: "Blog" })
);
