import { CanvasField, CanvasPageData } from "./types";

/**
 * A page to put on the canvas.
 *
 * Deliberately the same fictional shop as the overlay stories, so the two
 * experiments can be compared against one design rather than two.
 */

function field(
  id: string,
  label: string,
  type: CanvasField["type"],
  value: string,
  section: string,
): CanvasField {
  return {
    id,
    label,
    type,
    value,
    section,
    sourcePath: `/content/home.val.ts?p="${id}"`,
  };
}

const FIELDS: CanvasField[] = [
  field("eyebrow", "Eyebrow", "string", "Autumn 2026", "hero"),
  field(
    "headline",
    "Headline",
    "string",
    "Clothes that outlast the season.",
    "hero",
  ),
  field(
    "intro",
    "Intro",
    "text",
    "Made in Bergen from wool we can trace to the farm. Repaired free, for as long as you own it.",
    "hero",
  ),
  field("ctaLabel", "Button label", "string", "Shop the collection", "hero"),
  field("ctaHref", "Button link", "link", "/shop", "hero"),

  field("cat1Title", "First category", "string", "Knitwear", "categories"),
  field("cat1Price", "First price", "string", "From 1 490 kr", "categories"),
  field(
    "cat1Image",
    "First image",
    "image",
    "/public/val/knitwear_a1b2c.jpg",
    "categories",
  ),
  field("cat2Title", "Second category", "string", "Outerwear", "categories"),
  field("cat2Price", "Second price", "string", "From 3 200 kr", "categories"),
  field(
    "cat2Image",
    "Second image",
    "image",
    "/public/val/outerwear_d4e5f.jpg",
    "categories",
  ),
  field("cat3Title", "Third category", "string", "Accessories", "categories"),
  field("cat3Price", "Third price", "string", "From 390 kr", "categories"),
  field(
    "cat3Image",
    "Third image",
    "image",
    "/public/val/accessories_g6h7i.jpg",
    "categories",
  ),

  field(
    "storyTitle",
    "Story title",
    "string",
    "Repaired, not replaced",
    "story",
  ),
  field(
    "storyBody",
    "Story body",
    "richtext",
    "Every garment comes with free repairs for as long as you own it. Bring it to any of our stores, or post it to us and we will send it back mended.",
    "story",
  ),
  field("storyLink", "Story link", "link", "/repairs", "story"),

  field(
    "footerNote",
    "Footer note",
    "string",
    "Made in Bergen since 1998",
    "footer",
  ),
];

export const mockCanvasPage: CanvasPageData = {
  title: "Home",
  urlPath: "/",
  sections: [
    {
      id: "hero",
      name: "Hero",
      fieldIds: ["eyebrow", "headline", "intro", "ctaLabel", "ctaHref"],
    },
    {
      id: "categories",
      name: "Categories",
      fieldIds: [
        "cat1Title",
        "cat1Price",
        "cat1Image",
        "cat2Title",
        "cat2Price",
        "cat2Image",
        "cat3Title",
        "cat3Price",
        "cat3Image",
      ],
    },
    {
      id: "story",
      name: "Story",
      fieldIds: ["storyTitle", "storyBody", "storyLink"],
    },
    { id: "footer", name: "Footer", fieldIds: ["footerNote"] },
  ],
  fields: Object.fromEntries(FIELDS.map((f) => [f.id, f])),
};
