import { s, c } from "../val.config";

export const schema = s.string();

export default c.define(
  "/components/reactServerContent",
  schema,
  "React Server Components works"
);
