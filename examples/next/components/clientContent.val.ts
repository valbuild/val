import { s, val } from "../val.config";

export const schema = s.object({
  text: s.string().raw(),
  objectUnions: s.union(
    "type",
    s.object({
      type: s.literal("object-type-1"),
      value: s.number(),
    }),
    s.object({
      type: s.literal("object-type-2"),
      value: s.string(),
    })
  ),
  stringEnum: s.union(
    s.literal("lit-0"),
    s.literal("lit-1"),
    s.literal("lit-2")
  ),
});

export default val.content("/components/clientContent", schema, {
  text: "Client components works",
  objectUnions: {
    type: "object-type-2",
    value: "You can have multiple different types in a union",
  },
  stringEnum: "lit-1",
});
