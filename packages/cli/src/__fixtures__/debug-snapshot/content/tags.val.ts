import { c, s } from "../val.config";

export default c.define(
  "/content/tags.val.ts",
  s.record(s.object({ label: s.string() })),
  {
    design: { label: "Design" },
    tech: { label: "Tech" },
  },
);
