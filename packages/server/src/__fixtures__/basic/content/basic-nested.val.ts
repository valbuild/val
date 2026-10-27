import { c, s } from "../val.config";

export default c.define(
  "/content/basic-nested.val.ts",
  s.object({
    title: s.string(),
    items: s.array(s.object({ label: s.string(), count: s.number() })),
  }),
  {
    title: "Nested",
    items: [
      { label: "first", count: 1 },
      { label: "second", count: 2 },
    ],
  },
);
