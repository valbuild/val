import { s, c } from "../val.config";

// Deliberately NOT in val.modules: a real Val module someone forgot to
// register, which `validate` warns about.
export default c.define(
  "/content/unregistered-module.val.ts",
  s.object({ text: s.string() }),
  { text: "hi" },
);
