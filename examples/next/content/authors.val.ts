import { s, c, type t } from "../val.config";

export const schema = s.record(
  s.object({
    name: s.string(),
    bio: s.richtext(),
  })
);

export type Author = t.inferSchema<typeof schema>;
export default c.define("/content/authors.val.ts", schema, {
  freekh: {
    name: "Fredrik Ekholdt",
    bio: c.richtext`# Test 1 23

Lorem ipsum dolor sit amet, consectetur adipiscing elit

<br />

Lorem ipsum dolor sit amet, consectetur adipiscing elit

${c.rt.image("/public/logo_e211b.png")}
`,
  },
  erlamd: {
    name: "Erlend Åmdal",
    bio: c.richtext`# Test 1 23`,
  },
  teddy: {
    name: "Theodor René Carlsen",
    bio: c.richtext`# Test 1 23`,
  },
});
