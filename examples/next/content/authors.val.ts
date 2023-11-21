import { s, val } from "../val.config";

export const schema = s.array(
  s.object({
    name: s.string(),
  })
);

export default val.content("/content/authors", schema, [
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
