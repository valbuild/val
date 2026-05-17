import { s, c, type t } from "../val.config";
import mediaVal from "./media.val";

export const schema = s
  .record(
    s.object({
      name: s.string().minLength(2),
      birthdate: s.date().from("1900-01-01").to("2024-01-01").nullable(),
      joinedAt: s.datetime().nullable(),
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
    joinedAt: null,
    image: null,
  },
  freekh: {
    name: "Fredrik Ekholdt",
    birthdate: "1981-12-30",
    joinedAt: "2023-04-12T09:30:00.000Z",
    image: null,
  },
  erlamd: {
    name: "Erlend Åmdal",
    birthdate: null,
    joinedAt: null,
    image: null,
  },
  thoram: {
    name: "Thomas Ramirez",
    birthdate: null,
    joinedAt: null,
    image: null,
  },
  isabjo: {
    name: "Isak Bjørnstad",
    birthdate: null,
    joinedAt: null,
    image: null,
  },
  kimmid: {
    name: "Kim Midtlid",
    birthdate: null,
    joinedAt: null,
    image: null,
  },
});
