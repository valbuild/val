import { c, s } from "../val.config";

// One error `--fix` repairs (the image's metadata) and one it cannot (the
// title is too short), in the same module.
export default c.define(
  "/content/basic-fixable-and-unfixable.val.ts",
  s.object({ image: s.image(), title: s.string().minLength(30) }),
  {
    image: { path: "/public/val/image.png" },
    title: "Too short",
  },
);
