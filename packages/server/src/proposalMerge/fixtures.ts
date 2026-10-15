import type { JSONValue, Operation } from "@valbuild/core/patch";
import { page } from "./project";

/*
 * The site every scenario starts from: its pages, as `.val.ts` files, and a
 * component. A proposal that changes a schema stages the same file with
 * another schema (`withSchema`), as the Studio's assistant writes it.
 */

export const HOME_SCHEMA = `s.object({ title: s.string(), subtitle: s.string(), hero: s.string() })`;
export const homePage = () =>
  page("home.val.ts", HOME_SCHEMA, {
    title: "Sale",
    subtitle: "Everything must go",
    hero: "a.png",
  });

export const aboutPage = () =>
  page("about.val.ts", `s.object({ heading: s.string() })`, {
    heading: "About us",
  });

/** A page of sections: a list, where a change names an item by position. */
export const sectionsPage = () =>
  page(
    "sections.val.ts",
    `s.object({ sections: s.array(s.object({ text: s.string() })) })`,
    { sections: [{ text: "Hero" }, { text: "Text" }, { text: "Gallery" }] },
  );

/** Products by key: a record, where a change names an entry by key. */
export const PRODUCTS_SCHEMA = `s.record(s.object({ name: s.string(), price: s.number() }))`;
export const productsPage = () =>
  page("products.val.ts", PRODUCTS_SCHEMA, {
    "product-1": { name: "Lamp", price: 100 },
    "product-2": { name: "Chair", price: 200 },
  });

/** A component: code, and nothing Val reads. */
export const HERO = "src/components/Hero.tsx";
export const hero = (className: string) =>
  [
    `export function Hero({ title }: { title: string }) {`,
    `  return <h1 className="${className}">{title}</h1>;`,
    `}`,
    ``,
  ].join("\n");
export const FOOTER = "src/components/Footer.tsx";
export const footer = (text: string) =>
  [
    `export function Footer() {`,
    `  return <footer>${text}</footer>;`,
    `}`,
    ``,
  ].join("\n");

// --- changes, as the Studio writes them -------------------------------------------

/** A change names something to remove or move, never the page itself. */
type Field = [string, ...string[]];

export const set = (path: string[], value: JSONValue): Operation => ({
  op: "replace",
  path,
  value,
});
export const add = (path: string[], value: JSONValue): Operation => ({
  op: "add",
  path,
  value,
});
export const remove = (path: Field): Operation => ({ op: "remove", path });
export const move = (from: Field, path: string[]): Operation => ({
  op: "move",
  from,
  path,
});
