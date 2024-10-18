import { s, c, type t } from "../val.config";

export const schema = s.object({
  text: s.string(),
  date: s.date(),
  image: s.image(),
  objectUnions: s.union(
    "type",
    s.object({
      type: s.literal("object-type-1"),
      value: s.number(),
    }),
    s.object({
      type: s.literal("object-type-2"),
      value: s.string(),
    }),
  ),
  arrays: s.array(s.string()).nullable(),
  stringEnum: s.union(
    s.literal("lit-0"),
    s.literal("lit-1"),
    s.literal("lit-2"),
  ),
});
export type ClientContent = t.inferSchema<typeof schema>;

export default c.define("/components/clientContent.val.ts", schema, {
  text: "Client components works",
  date: "2001-05-08",
  image: c.file("/public/val/logo_e211b.png", {
    sha256: "e211ba37284a7ed660ecbf4d80c6f9778ddf7a32664353a8ceeec0f33cf2130f",
    width: 944,
    height: 944,
    mimeType: "image/png",
  }),
  objectUnions: {
    type: "object-type-2",
    value: "You can have multiple different types in a union",
  },
  arrays: ["array-1", "array-2"],
  stringEnum: "lit-1",
});
