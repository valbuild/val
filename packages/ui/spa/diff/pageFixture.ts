import { initVal, Internal, type ModuleFilePath } from "@valbuild/core";

/*
 * One page module and its Source, for the diff engine: what its tests change
 * a field at a time, and what its story changes all at once.
 */

const { s, c } = initVal();

export const PAGE = "/content/page.val.ts" as ModuleFilePath;

export function p(...children: (string | Inline)[]): {
  tag: "p";
  children: (string | Inline)[];
} {
  return { tag: "p", children };
}
type Inline = { tag: "span"; styles: "bold"[]; children: [string] };
export function bold(text: string): Inline {
  return { tag: "span", styles: ["bold"], children: [text] };
}
export function h2(text: string): { tag: "h2"; children: string[] } {
  return { tag: "h2", children: [text] };
}

export const pageVal = c.define(
  PAGE,
  s.object({
    title: s.string(),
    published: s.boolean(),
    date: s.date(),
    status: s.enum("draft", "live"),
    seo: s.object({ title: s.string(), index: s.boolean() }),
    hero: s.image().nullable(),
    tags: s.array(s.string()),
    sections: s.array(
      s.discriminatedUnion(
        "type",
        s.object({
          type: s.literal("hero"),
          title: s.string(),
          image: s.image().nullable(),
        }),
        s.object({
          type: s.literal("faq"),
          title: s.string(),
          items: s.array(
            s.object({ question: s.string(), answer: s.string() }),
          ),
        }),
        s.object({
          type: s.literal("quote"),
          title: s.string(),
          text: s.string(),
          author: s.string(),
        }),
      ),
    ),
    body: s.richtext({ bold: true, h2: true, ul: true }),
    people: s.record(s.object({ name: s.string(), bio: s.string() })),
  }),
  {
    title: "Content that ships with your code",
    published: false,
    date: "2026-11-03",
    status: "draft",
    seo: { title: "Hello | Val", index: false },
    hero: {
      path: "/public/val/team_3f9a1.webp",
      width: 1200,
      height: 600,
      mimeType: "image/webp",
      alt: "The team at work",
    },
    tags: ["cms", "typescript", "react"],
    sections: [
      {
        type: "hero",
        title: "Content that ships with your code",
        image: null,
      },
      {
        type: "faq",
        title: "Questions",
        items: [
          {
            question: "How often do you ship?",
            answer: "Weekly, on Thursdays.",
          },
          { question: "Is there a free plan?", answer: "Yes, for one editor." },
        ],
      },
      {
        type: "quote",
        title: "What teams say",
        text: "Editors never see git.",
        author: "Ada",
      },
      {
        type: "quote",
        title: "Customer logos",
        text: "Used by forty teams.",
        author: "Linus",
      },
    ],
    body: [
      p("Val stores content in your repo, so every change is a commit."),
      p("Editors never see git. They see a page and a Publish button."),
      p("It works with the framework you already use."),
    ],
    people: {
      ada: { name: "Ada Lovelace", bio: "Wrote the first program." },
      linus: { name: "Linus Berg", bio: "Maintains the build." },
    },
  },
);
/** The page as the site has it: what every test changes something of. */
export const site = Internal.getSource(pageVal);
export const pageSchema = Internal.getSchema(pageVal)?.["executeSerialize"]();

const [hero, faq, quote, logos] = site.sections;

/**
 * The page after a busy afternoon: something of every kind changed, so the
 * story shows the engine's answer to each.
 */
export const proposed = {
  ...site,
  title: "Content that ships with the code, and stays editable",
  published: true,
  date: "2026-11-17",
  seo: { title: "Hello, spring | Val", index: true },
  hero: {
    path: "/public/val/office_b71c4.webp",
    width: 1600,
    height: 800,
    mimeType: "image/webp",
    alt: "The team at the office",
  },
  tags: ["react", "cms", "next", "typescript"],
  sections: [
    hero,
    logos,
    {
      type: "quote",
      title: "Testimonials",
      text: "It took an afternoon.",
      author: "Kari",
    },
    faq.type === "faq"
      ? {
          ...faq,
          items: [
            {
              ...faq.items[0],
              answer: "Daily, as soon as a change is reviewed.",
            },
            { question: "Can I host it myself?", answer: "Yes." },
            faq.items[1],
          ],
        }
      : faq,
    { ...quote, title: "What teams say after a month" },
  ],
  body: [
    site.body[1],
    p("Val stores content in code, so every change is a commit."),
    h2("Pricing"),
    p("Free for one editor. Every plan includes history and restore."),
    p("It works with ", bold("the framework"), " you already use."),
  ],
  people: {
    ada: { ...site.people.ada, bio: "Wrote the first published program." },
    "linus-berg": site.people.linus,
    kari: { name: "Kari Nordmann", bio: "Edits the blog." },
  },
};
