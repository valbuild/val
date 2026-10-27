import { s, c, type t } from "../../val.config";

/**
 * `s.color()`: a CSS color string, so the value drops straight into a `style`
 * attribute or a CSS custom property with nothing to convert.
 *
 * The notation is the `format` option's business and defaults to `"hsl"`.
 * Transparency has to be opted into with `alpha: true` — a picker that always
 * offered it would let an alpha slip into a value the app multiplies against
 * its own background.
 */
export const schema = s.object({
  brand: s.color().describe("Primary brand colour. Defaults to hsl notation"),
  background: s.color({ format: "hex" }).describe("Page background"),
  text: s.color({ format: "rgb" }).describe("Body text colour"),
  accent: s.color({ format: "oklch" }).describe("Accent colour"),
  overlay: s
    .color({ format: "hsl", alpha: true })
    .describe("Overlay tint — the one colour here allowed an alpha channel"),
  // A colour is nullable like any other field.
  highlight: s.color().nullable().describe("Optional highlight colour"),
});

export type Theme = t.inferSchema<typeof schema>;

export default c.define("/src/content/theme.val.ts", schema, {
  brand: "hsl(217.22 91.22% 59.8%)",
  background: "#0b1020",
  text: "rgb(233 236 245)",
  accent: "oklch(0.7686 0.1647 70.08)",
  overlay: "hsl(217.22 91.22% 59.8% / 0.15)",
  highlight: null,
});
