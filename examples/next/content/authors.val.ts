import { s, c, type t } from "../val.config";

export const schema = s.record(
  s.object({
    name: s.string(),
  })
);

export type Author = t.inferSchema<typeof schema>;
export default c.define("/content/authors.val.ts", schema, {
  teddy: { name: "Theodor René Carlsen" },
  freekh: { name: "Fredrik Ekholdt" },
  erlamd: { name: "Erlend Åmdal" },
});
