import { InferSchemaType } from "@valbuild/next";
import authorsVal from "../content/authors.val";
import { s, val } from "../val.config";
import image from "../schema/image.val";

export const schema = s.object({
  /**
   * Arrays and string:
   */
  tags: s.array(
    s.string({
      regexp: /CMS|github|react|NextJS|headless/,
    })
  ),
  /**
   * Rich Text that is optional:
   */
  text: s
    .richtext({
      // enables all features
      // styling:
      bold: true, // enables bold
      italic: true, // enables italic text
      lineThrough: true, // enables line/strike-through
      // tags:
      headings: ["h1", "h2", "h3", "h4", "h5", "h6"], // sets which headings are available
      a: true, // enables links
      img: true, // enables images
      ul: true, // enables unordered lists
      ol: true, // enables ordered lists
    })
    .optional(),

  text2: s
    .richtext({
      // enables all features
      // styling:
      bold: true, // enables bold
      italic: true, // enables italic text
      lineThrough: true, // enables line/strike-through
      // tags:
      headings: ["h1", "h2", "h3", "h4", "h5", "h6"], // sets which headings are available
      a: true, // enables links
      img: true, // enables images
      ul: true, // enables unordered lists
      ol: true, // enables ordered lists
    })
    .optional(),
  /**
   * Reference to other content:
   */
  author: s.keyOf(authorsVal),
  video: s.file(),
  /**
   * Objects:
   */
  hero: s.object({
    title: s.string(),
    image,
  }),
});

export type Content = InferSchemaType<typeof schema>;
export type Image = InferSchemaType<typeof image>;
export default val.content("/app/content", schema, {
  video: val.file("/public/file_example.webm", {
    sha256: "9bb98735d0430e5a825173cb7db5e4d5aee32c1c283c3db90f1c9c532f73505e",
    mimeType: "video/webm",
  }),
  hero: {
    title: "Content as codejj",
    image: {
      data: val.file("/public/logo_e211b.png", {
        width: 944,
        height: 944,
        sha256:
          "e211ba37284a7ed660ecbf4d80c6f9778ddf7a32664353a8ceeec0f33cf2130f",
        mimeType: "image/png",
      }),
      alt: "Val logo",
    },
  },
  tags: ["CMS", "react", "github", "NextJS"],
  author: 0,
  text2: val.richtext `
Veldig så gøy

<br />

<br />
`,
  text: val.richtext `
Dette er jo fantastisk

<br />


Jepp fra iphone

Jada!!!

<br />
Hjj

<br />

<br />

Tets

<br />


Hehhehehehe<br />


- test
`,
});
