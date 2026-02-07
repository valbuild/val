import { s, c, type t } from "../val.config";
import mediaVal from "./media.val";

export const schema = s
  .record(
    s.object({
      name: s.string().minLength(2),
      birthdate: s.date().from("1900-01-01").to("2024-01-01").nullable(),
      image: s.image(mediaVal).nullable(),
    }),
  )
  .render({
    as: "list",
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
    image: c.image("/public/val/images/logo.png"),
  },
  freekh: {
    name: "Fredrik Ekholdt",
    birthdate: "1981-12-30",
    image: null,
  },
  erlamd: {
    name: "Erlend Åmdal",
    birthdate: null,
    image: null,
  },
  thoram: {
    name: "Thomas Ramirez",
    birthdate: null,
    image: null,
  },
  isabjo: {
    name: "Isak Bjørnstad",
    birthdate: null,
    image: null,
  },
  kimmid: {
    name: "Kim Midtlid",
    birthdate: null,
    image: null,
  },
});
