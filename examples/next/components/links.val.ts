import { c, s } from "../val.config";

export default c.define(
  "/components/links",
  s.object({
    homepage: s.string(),
  }),
  {
    homepage: "https://val.build",
  }
);
