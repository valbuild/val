import { s, val } from "../val.config";

export default val.content("/pages/blog", () =>
  s.object({ title: s.string(), text: s.string() }).static({
    title: "1672911735",
    text: "Blipp blopp",
  })
);
