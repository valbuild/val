import { s, c, type t } from "../val.config";
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
    .nullable(),
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

export type Content = t.inferSchema<typeof schema>;
export type Image = t.inferSchema<typeof image>;
export default c.define("/app/content", schema, {
  video: c.file("/public/file_example.webm", {
    sha256: "9bb98735d0430e5a825173cb7db5e4d5aee32c1c283c3db90f1c9c532f73505e",
    mimeType: "video/webm",
  }),
  hero: {
    title: "Content as code",
    image: {
      data: c.file("/public/logo_e211b.png", {
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
  text: c.richtext`
Val is a CMS where **content** is **code** in your git repo.

<br />

Val is a CMS, which is useful because:

- editors can **change content** without developer interactions
- **images** can be managed without checking in code
- **i18n** support is easy to add
- a **well-documented** way to **structure content**

<br />

But, with all the benefits of having content hard-coded:

- works as normal with your **favorite IDE** without any plugins: search for content, references to usages, ...
- content is **type-checked** so you see when something is wrong immediately
- content can be **refactored** (change names, etc) just as if it was hard-coded (because it sort of is)
- work **locally** or in **branches** just as if you didn't use a CMS
- **no need for code-gen** and extra build steps

Visit ${c.rt.link("Val", { href: "https://val.build" })} for more information.
`,
});
