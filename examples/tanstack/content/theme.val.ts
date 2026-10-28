import { s, c, type t } from "../val.config";

/**
 * Colors are stored as CSS color strings, so they can be dropped straight into
 * a `style` attribute or a CSS custom property.
 *
 * The `format` option decides the notation. It defaults to `"hsl"`.
 */
export const schema = s.object({
  // Defaults to hsl
  brand: s.color().describe("Primary brand color"),
  // ...but any CSS color notation can be picked
  background: s.color({ format: "hex" }).describe("Page background"),
  text: s.color({ format: "rgb" }).describe("Body text color"),
  accent: s.color({ format: "oklch" }).describe("Accent color"),
  // Transparency has to be opted into
  overlay: s
    .color({ format: "hsl", alpha: true })
    .describe("Overlay tint, alpha allowed"),
  // ...and colors can be optional like any other field
  highlight: s.color().nullable().describe("Optional highlight color"),
});

export type Theme = t.inferSchema<typeof schema>;
export default c.define("/content/theme.val.ts", schema, {
  brand: "hsl(217.22 91.22% 59.8%)",
  background: "#0b1020",
  text: "rgb(233 236 245)",
  accent: "oklch(0.7686 0.1647 70.08)",
  overlay: "hsl(217.22 91.22% 59.8% / 0.15)",
  highlight: null,
});
