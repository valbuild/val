import { CanvasField, CanvasPageData, CanvasSection } from "./types";

/**
 * A page to put on the canvas.
 *
 * Deliberately the same fictional shop as the overlay stories, so the two
 * experiments can be compared against one design rather than two.
 *
 * The field paths are the real thing: this page is the `"/"` entry of a
 * `s.router(nextAppRouter, ...)` module, so every path starts at that key and
 * then walks the schema — quoted segments for object keys and record keys,
 * bare numbers for array indices, exactly as `createValPathOfItem` builds
 * them. The schema it walks is
 *
 *   s.object({
 *     hero: s.object({ eyebrow, title, intro, cta: s.object({ text, href }) }),
 *     categories: s.array(s.object({ title, price, image })),
 *     story: s.object({ title, body, link }),
 *     footer: s.object({ note }),
 *   })
 *
 * which matters because the panel groups by section: a repeated section is an
 * array in Val, not three sets of numbered fields, and a canvas that pretends
 * otherwise would not survive contact with a real module.
 */

const PAGE_MODULE = "/app/page.val.ts";
const ROUTE_KEY = "/";

/** `["hero", "title"]` -> `/app/page.val.ts?p="/"."hero"."title"` */
function sourcePathOf(segments: (string | number)[]): string {
  const walked = [ROUTE_KEY, ...segments]
    .map((segment) =>
      typeof segment === "number" ? `${segment}` : JSON.stringify(segment),
    )
    .join(".");
  return `${PAGE_MODULE}?p=${walked}`;
}

/**
 * One field, identified by the path it edits.
 *
 * The id is the source path rather than a short slug, because that is what
 * identifies a field in Val: two canvases of the same page have to agree on
 * which field is which, and only the path does that.
 */
function field(
  segments: (string | number)[],
  label: string,
  type: CanvasField["type"],
  value: string,
  section: string,
): CanvasField {
  const sourcePath = sourcePathOf(segments);
  return { id: sourcePath, sourcePath, label, type, value, section };
}

const heroFields: CanvasField[] = [
  field(["hero", "eyebrow"], "Eyebrow", "string", "Autumn 2026", "hero"),
  field(
    ["hero", "title"],
    "Title",
    "string",
    "Clothes that outlast the season.",
    "hero",
  ),
  field(
    ["hero", "intro"],
    "Intro",
    "text",
    "Made in Bergen from wool we can trace to the farm. Repaired free, for as long as you own it.",
    "hero",
  ),
  field(
    ["hero", "cta", "text"],
    "Button label",
    "string",
    "Shop the collection",
    "hero",
  ),
  field(["hero", "cta", "href"], "Button link", "link", "/shop", "hero"),
];

/**
 * The categories array.
 *
 * Built from a list rather than written out three times, so the indices in the
 * paths cannot drift from the order of the rows.
 */
const categoryFields: CanvasField[] = [
  {
    title: "Knitwear",
    price: "From 1 490 kr",
    image: "/public/val/images/knitwear_a1b2c.jpg",
  },
  {
    title: "Outerwear",
    price: "From 3 200 kr",
    image: "/public/val/images/outerwear_d4e5f.jpg",
  },
  {
    title: "Accessories",
    price: "From 390 kr",
    image: "/public/val/images/accessories_g6h7i.jpg",
  },
].flatMap((category, index) => [
  field(
    ["categories", index, "title"],
    "Title",
    "string",
    category.title,
    "categories",
  ),
  field(
    ["categories", index, "price"],
    "Price",
    "string",
    category.price,
    "categories",
  ),
  field(
    ["categories", index, "image"],
    "Image",
    "image",
    category.image,
    "categories",
  ),
]);

const storyFields: CanvasField[] = [
  field(
    ["story", "title"],
    "Title",
    "string",
    "Repaired, not replaced",
    "story",
  ),
  field(
    ["story", "body"],
    "Body",
    "richtext",
    "Every garment comes with free repairs for as long as you own it. Bring it to any of our stores, or post it to us and we will send it back mended.",
    "story",
  ),
  field(["story", "link"], "Link", "link", "/repairs", "story"),
];

const footerFields: CanvasField[] = [
  field(
    ["footer", "note"],
    "Note",
    "string",
    "Made in Bergen since 1998",
    "footer",
  ),
];

const SECTIONS: { id: string; name: string; fields: CanvasField[] }[] = [
  { id: "hero", name: "Hero", fields: heroFields },
  { id: "categories", name: "Categories", fields: categoryFields },
  { id: "story", name: "Story", fields: storyFields },
  { id: "footer", name: "Footer", fields: footerFields },
];

const FIELDS: CanvasField[] = SECTIONS.flatMap((section) => section.fields);

export const mockCanvasPage: CanvasPageData = {
  title: "/",
  urlPath: "/",
  sections: SECTIONS.map(
    (section): CanvasSection => ({
      id: section.id,
      name: section.name,
      fieldIds: section.fields.map((f) => f.id),
    }),
  ),
  fields: Object.fromEntries(FIELDS.map((f) => [f.id, f])),
};
