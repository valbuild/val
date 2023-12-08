import { s, val } from "../val.config";

export const schema = s.string();

export default val.content(
  "/app/test",
  schema,
  "React Server components also works"
);
