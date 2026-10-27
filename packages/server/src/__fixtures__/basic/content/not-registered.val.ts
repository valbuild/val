// Deliberately NOT added to val.modules.ts: exercises the "not found in
// val.modules" fatal error path in Service.get.
import { c, s } from "../val.config";

export default c.define(
  "/content/not-registered.val.ts",
  s.string(),
  "Not registered",
);
