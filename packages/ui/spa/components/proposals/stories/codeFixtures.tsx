import type { ChatMessage } from "../../AIChat";
import { changedFiles } from "../../../proposals/changedFiles";

/** What code mode's stories show: one proposal, its files and its chat. */

export const SITE: Record<string, string> = {
  "src/routes/_site.index.tsx": [
    'import { Hero } from "../components/sections/Hero";',
    'import { Quote } from "../components/sections/Quote";',
    'import { ProductGrid } from "../components/sections/ProductGrid";',
    "",
    "function Home() {",
    "  const page = useValRoute(homeVal);",
    "  return (",
    "    <>",
    "      <Hero {...page.hero} />",
    "      <Quote {...page.quote} />",
    "      <ProductGrid {...page.products} />",
    "    </>",
    "  );",
    "}",
    "",
  ].join("\n"),
  "src/components/sections/Quote.tsx":
    "export function Quote() {\n  return null;\n}\n",
  "src/routes/_site.index.val.ts": "export default c.define(/* … */);\n",
};

export const PROPOSAL: Record<string, string | null> = {
  "src/routes/_site.index.tsx": SITE["src/routes/_site.index.tsx"]
    .replace(
      'import { Quote } from "../components/sections/Quote";',
      'import { Testimonials } from "../components/sections/Testimonials";',
    )
    .replace(
      "      <Quote {...page.quote} />",
      "      <Testimonials items={page.testimonials} />",
    ),
  "src/components/sections/Quote.tsx": null,
  "src/components/sections/Testimonials.tsx": [
    "export function Testimonials({ items }: { items: Testimonial[] }) {",
    "  return (",
    '    <section className="bg-subtle px-8 py-12">',
    '      <h2 className="mb-6 text-2xl font-bold">Worn for years, not weeks</h2>',
    "      {items.map((item) => <Card key={item.name} {...item} />)}",
    "    </section>",
    "  );",
    "}",
    "",
  ].join("\n"),
  "src/routes/_site.index.val.ts":
    "export default c.define(/* …, testimonials */);\n",
};

export const FILES = changedFiles(SITE, PROPOSAL, [
  "src/routes/_site.index.tsx",
  "src/components/sections/Quote.tsx",
  "src/components/sections/Testimonials.tsx",
]);

export const MESSAGES: ChatMessage[] = [
  {
    id: "u1",
    role: "user",
    content:
      "Replace the quote on the front page with a section of customer testimonials. Three of them, as cards.",
    status: "complete",
  },
  {
    id: "a1",
    role: "assistant",
    content:
      "Done, and it is in the preview. I added a **Testimonials** section with its own schema (quote, name, place), put it on the front page where the quote was, and removed the Quote section, which nothing else used.\n\n" +
      "Nothing on the site has changed: it changes when the proposal is published.",
    status: "complete",
    toolActivities: [
      { toolCallId: "t1", name: "list_files", status: "complete" },
      { toolCallId: "t2", name: "read_file", status: "complete" },
      { toolCallId: "t3", name: "write_files", status: "complete" },
      { toolCallId: "t4", name: "build_proposal", status: "complete" },
    ],
  },
];
