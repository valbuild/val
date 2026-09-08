import { s, c } from "../../val.config";

export const authorSchema = s.object({
  name: s.string(),
  title: s.string(),
});

export default c.define("/src/content/authors.val.ts", s.record(authorSchema), {
  freekh: { name: "Fredrik Ekholdt", title: "Val" },
  ada: { name: "Ada Lovelace", title: "Analytical Engine" },
});
