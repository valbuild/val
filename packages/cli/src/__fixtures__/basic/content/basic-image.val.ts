import { c, s } from "../val.config";

export default c.define(
  "/content/basic-image.val.ts",
  s.image(),
  c.image("/public/val/image.png"),
);
