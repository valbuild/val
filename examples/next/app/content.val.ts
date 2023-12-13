import { InferSchemaType } from "@valbuild/next";
import authorsVal from "../content/authors.val";
import { s, val } from "../val.config";

const image = s.object({
  data: s.image(),
  alt: s.string(),
});
export const schema = s.object({
  /**
   * Arrays and string:
   */
  tags: s.array(s.string()),
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
  /**
   * Reference to other content:
   */
  author: s.keyOf(authorsVal),
  /**
   * Objects:
   */
  hero: s.object({
    title: s.string(),
    image,
  }),
});

export type Content = InferSchemaType<typeof schema>;
export default val.content("/app/content", schema, {
  hero: {
    title: "Content as code",
    image: {
      data: val.file("/public/logo_e211b.png", {
        sha256:
          "e211ba37284a7ed660ecbf4d80c6f9778ddf7a32664353a8ceeec0f33cf2130f",
        width: 944,
        height: 944,
        mimeType: "image/png",
      }),
      alt: "Val logo",
    },
  },
  tags: ["CMS", "react", "github", "NextJS"],
  author: 0,
  text: val.richtext`
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
`,
});
