import { c, s } from "../val.config";
import tagsVal from "./tags.val";
import { summarySchema } from "./summary";

export default c.define(
  "/content/projects.val.ts",
  s.record(
    s.object({
      title: s.string(),
      tag: s.keyOf(tagsVal),
      summary: summarySchema,
    }),
  ),
  {
    BBL: {
      title: "BBL",
      tag: "design",
      summary: {
        services: ["Strategy", "Design", "Development"],
      },
    },
  },
);
