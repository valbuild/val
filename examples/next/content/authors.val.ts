import { s, c, type t } from "../val.config";

export const schema = s
  .record(
    s.object({
      name: s.string(),
      birthdate: s.date().from("1900-01-01").to("2024-01-01"),
      metadata: s
        .object({
          image: s.image(),
        })
        .nullable(),
    }),
  )
  .preview({
    as: "card",
    display: ({ val }) => ({
      title: val.name || "Faen",
      image: val.metadata?.image,
    }),
  });

export type Author = t.inferSchema<typeof schema>;
export default c.define("/content/authors.val.ts", schema, {
  teddy: {
    name: "Theodor René Carlsen",
    birthdate: "1970-01-01",
    metadata: null,
  },
  freekh: {
    name: "Fredrik Ekholdt",
    birthdate: "1970-01-01",
    metadata: {
      image: c.image("/public/val/logo_7adc7.png", {
        width: 944,
        height: 944,
        mimeType: "image/png",
      }),
    },
  },
  erlamd: {
    name: "Erlend Åmdal",
    birthdate: "1970-01-01",
    metadata: null,
  },
  thoram: {
    name: "Thomas Ramirez",
    birthdate: "1903-10-15",
    metadata: null,
  },
  isabjo: {
    name: "Isak Bjørnstad",
    birthdate: "1970-01-01",
    metadata: null,
  },
  kimmid: {
    name: "Kim Midtlid",
    birthdate: "1970-03-19",
    metadata: null,
  },
});
