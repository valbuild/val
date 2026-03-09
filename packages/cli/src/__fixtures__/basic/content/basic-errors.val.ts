import { c, s } from "../val.config";

export default c.define(
  "/content/basic-errors.val.ts",
  s.string().minLength(30),
  "Hello World",
);
