import { s, c, type t } from "../val.config";

/**
 * A set of custom icons.
 *
 * Colors are declared as variables rather than baked into the markup, so the
 * same icon can inherit the surrounding text color, follow a dark mode
 * stylesheet, or be recolored per usage. The color on each variable is an
 * example: it is what the editor previews, what `svgVarsCss` writes into the
 * stylesheet, and what a pasted color is matched against on import.
 */
export const iconSchema = s
  .svg({
    width: 24,
    height: 24,
    aspectRatio: "1:1",
    variables: {
      brand: {
        value: "#0055ff",
        match: ["#0055FF", "#0050f0"],
        description: "The primary shape of the icon",
      },
      line: {
        value: "currentColor",
        description: "Strokes: inherits the surrounding text color",
      },
      surface: {
        value: "#ffffff",
        match: ["#fff", "#fefefe"],
        description: "Cut-outs and badges",
      },
    },
  })
  .describe("A 24x24 icon. Paste svg markup to replace it.");

export const schema = s.record(iconSchema);

export type Icons = t.inferSchema<typeof schema>;

export default c.define("/content/icons.val.ts", schema, {
  bell: {
    viewBox: "0 0 24 24",
    width: 24,
    height: 24,
    children: [
      {
        tag: "path",
        attrs: {
          d: "M12 2.5A5.5 5.5 0 0 0 6.5 8v4.2L4.8 15.2a.6.6 0 0 0 .52.9h13.36a.6.6 0 0 0 .52-.9L17.5 12.2V8A5.5 5.5 0 0 0 12 2.5Z",
          fill: { var: "brand" },
        },
        children: [],
      },
      {
        tag: "path",
        attrs: {
          d: "M9.6 18.5a2.4 2.4 0 0 0 4.8 0",
          stroke: { var: "line" },
          "stroke-width": 1.6,
          "stroke-linecap": "round",
          fill: "none",
        },
        children: [],
      },
      {
        tag: "circle",
        attrs: { cx: 17.5, cy: 6, r: 2.6, fill: { var: "surface" } },
        children: [],
      },
    ],
  },
  bookmark: {
    viewBox: "0 0 24 24",
    width: 24,
    height: 24,
    children: [
      {
        tag: "path",
        attrs: {
          d: "M6.5 3.5h11a1 1 0 0 1 1 1v16l-6.5-4.2-6.5 4.2v-16a1 1 0 0 1 1-1Z",
          fill: { var: "brand" },
        },
        children: [],
      },
      {
        tag: "path",
        attrs: {
          d: "M9.5 8.5h5",
          stroke: { var: "surface" },
          "stroke-width": 1.6,
          "stroke-linecap": "round",
          fill: "none",
        },
        children: [],
      },
    ],
  },
  check: {
    viewBox: "0 0 24 24",
    width: 24,
    height: 24,
    children: [
      {
        tag: "circle",
        attrs: { cx: 12, cy: 12, r: 9.5, fill: { var: "brand" } },
        children: [],
      },
      {
        tag: "path",
        attrs: {
          d: "M7.5 12.3 10.6 15.4 16.5 9.5",
          stroke: { var: "surface" },
          "stroke-width": 2,
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
          fill: "none",
        },
        children: [],
      },
    ],
  },
});
