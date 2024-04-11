import { s, c, type t } from "../val.config";

export const schema = s.object({
  text: s.string(),
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
  arrays: s.array(s.string()),
  stringEnum: s.union(
    s.literal("lit-0"),
    s.literal("lit-1"),
    s.literal("lit-2")
  ),
});
export type ClientContent = t.inferSchema<typeof schema>;

export default c.define("/components/clientContent", schema, {
  text: "Client components works",
  objectUnions: {
    type: "object-type-2",
    value: "You can have multiple different types in a union",
  },
  arrays: ["array-1", "array-2"],
  stringEnum: "lit-1",
});
