import { s, c, type t } from "_/val.config";
import authorsVal from "../content/authors.val";
import image from "../schema/image.val";

export const schema = s.object({
  /**
   * Arrays and string:
   */
  tags: s.array(s.string().regexp(/CMS|github|react|NextJS|headless/)),
  /**
   * Rich Text that is optional:
   */
  text: s
    .richtext({
      // enables all features
      // styling:
      style: {
        bold: true, // enables bold
        italic: true, // enables italic text
        lineThrough: true, // enables line/strike-through
      },
      block: {
        // tags:
        h1: true, // enables h1
        h2: true,
        ul: true, // enables unordered lists
        ol: true, // enables ordered lists
      },
      inline: {
        a: true,
        img: true,
      },
    })
    .nullable(),
  /**
   * Reference to other content:
   */
  author: s.keyOf(authorsVal),
  video: s.file({ accept: "video/*" }),
  /**
   * Objects:
   */
  hero: s.object({
    title: s.string(),
    image,
  }),
  // Boolean:
  featured: s.boolean(),
});

export type Content = t.inferSchema<typeof schema>;
export type Image = t.inferSchema<typeof image>;
export default c.define("/app/content.val.ts", schema, {
  video: c.file("/public/val/file_example.webm", {
    mimeType: "video/webm",
  }),
  hero: {
    title: "Content as code",
    image: c.image("/public/val/logo_e211b.png", {
      width: 944,
      height: 944,
      mimeType: "image/png",
      alt: "Val logo",
    }),
  },
  tags: ["CMS", "react", "github", "NextJS"],
  author: "freekh",
  text: [
    {
      tag: "p",
      children: [
        "Val is a CMS where ",
        { tag: "span", styles: ["bold"], children: ["content"] },
        " is ",
        { tag: "span", styles: ["bold"], children: ["code"] },
        " in your git repo.",
      ],
    },
    { tag: "p", children: [{ tag: "br" }] },
    { tag: "p", children: ["Val is a CMS, which is useful because:"] },
    {
      tag: "ul",
      children: [
        {
          tag: "li",
          children: [
            {
              tag: "p",
              children: [
                "editors can ",
                { tag: "span", styles: ["bold"], children: ["change content"] },
                " without developer interactions",
              ],
            },
          ],
        },
        {
          tag: "li",
          children: [
            {
              tag: "p",
              children: [
                { tag: "span", styles: ["bold"], children: ["images"] },
                " can be managed without checking in code",
              ],
            },
          ],
        },
        {
          tag: "li",
          children: [
            {
              tag: "p",
              children: [
                { tag: "span", styles: ["bold"], children: ["i18n"] },
                " support is easy to add",
              ],
            },
          ],
        },
        {
          tag: "li",
          children: [
            {
              tag: "p",
              children: [
                "a ",
                {
                  tag: "span",
                  styles: ["bold"],
                  children: ["well-documented"],
                },
                " way to ",
                {
                  tag: "span",
                  styles: ["bold"],
                  children: ["structure content"],
                },
              ],
            },
          ],
        },
      ],
    },
    { tag: "p", children: [{ tag: "br" }] },
    {
      tag: "p",
      children: ["But, with all the benefits of having content hard-coded:"],
    },
    {
      tag: "ul",
      children: [
        {
          tag: "li",
          children: [
            {
              tag: "p",
              children: [
                "works as normal with your ",
                { tag: "span", styles: ["bold"], children: ["favorite IDE"] },
                " without any plugins: search for content, references to usages, ...",
              ],
            },
          ],
        },
        {
          tag: "li",
          children: [
            {
              tag: "p",
              children: [
                "content is ",
                { tag: "span", styles: ["bold"], children: ["type-checked"] },
                " so you see when something is wrong immediately",
              ],
            },
          ],
        },
        {
          tag: "li",
          children: [
            {
              tag: "p",
              children: [
                "content can be ",
                { tag: "span", styles: ["bold"], children: ["refactored"] },
                " (change names, etc) just as if it was hard-coded (because it sort of is)",
              ],
            },
          ],
        },
        {
          tag: "li",
          children: [
            {
              tag: "p",
              children: [
                "work ",
                { tag: "span", styles: ["bold"], children: ["locally"] },
                " or in ",
                { tag: "span", styles: ["bold"], children: ["branches"] },
                " just as if you didn't use a CMS",
              ],
            },
          ],
        },
        {
          tag: "li",
          children: [
            {
              tag: "p",
              children: [
                {
                  tag: "span",
                  styles: ["bold"],
                  children: ["no need for code-gen"],
                },
                " and extra build steps",
              ],
            },
          ],
        },
      ],
    },
    {
      tag: "p",
      children: [
        "Visit ",
        { tag: "a", href: "https://val.build", children: ["Val"] },
        " for more information.",
      ],
    },
  ],
  featured: false,
});
