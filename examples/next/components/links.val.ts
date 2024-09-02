import { c, s } from "../val.config";

export default c.define(
  "/components/links.val.ts",
  s.object({
    homepage: s.string(),
  }),
  {
    homepage: "https://val.build",
  },
);
