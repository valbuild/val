import { s, c, type t } from "../val.config";

export const schema = s
  .record(
    s.object({
      name: s.string().minLength(2),
      birthdate: s.date().from("1900-01-01").to("2024-01-01").nullable(),
    }),
  )
  .render({
    layout: "list",
    select: ({ val }) => ({
      title: val.name,
      subtitle: val.birthdate,
    }),
  });

export type Author = t.inferSchema<typeof schema>;
export default c.define("/content/authors.val.ts", schema, {
  teddy: {
    name: "Theodor René Carlsen",
    birthdate: null,
  },
  freekh: {
    name: "Fredrik Ekholdt",
    birthdate: "1981-12-30",
  },
  erlamd: {
    name: "Erlend Åmdal",
    birthdate: null,
  },
  thoram: {
    name: "Thomas Ramirez",
    birthdate: null,
  },
  isabjo: {
    name: "Isak Bjørnstad",
    birthdate: null,
  },
  kimmid: {
    name: "Kim Midtlid",
    birthdate: null,
  },
});
