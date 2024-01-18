import type { InferSchemaType } from "@valbuild/next";
import { s, c } from "../val.config";

export const schema = s.array(
  s.object({
    name: s.string(),
  })
);

export type Author = InferSchemaType<typeof schema>;
export default c.define("/content/authors", schema, [
  {
    name: "Fredrik Ekholdt",
  },
  {
    name: "Erlend Åmdal",
  },
  {
    name: "Theodor René Carlsen",
  },
]);
