import { s, c, type t } from "../val.config";

export const schema = s.record(
  s.object({
    name: s.string(),
    birthdate: s.date().from("1900-01-01").to("2024-01-01"),
  }),
);

export type Author = t.inferSchema<typeof schema>;
export default c.define("/content/authors.val.ts", schema, {
  teddy: { name: "Theodor René Carlsen", birthdate: "1970-01-01" },
  freekh: { name: "Fredrik Ekholdt", birthdate: "1970-01-01" },
  erlamd: { name: "Erlend Åmdal", birthdate: "1970-01-01" },
  thoram: { name: "Thomas Ramirez", birthdate: "1903-10-15" },
  isabjo: { name: "Isak Bjørnstad", birthdate: "1970-01-01" },
  kimmid: { name: "Kim Midtlid", birthdate: "1970-03-19" },
});
