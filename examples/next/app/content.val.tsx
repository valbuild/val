/** @jsxImportSource @valbuild/richtext */

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
export default c.define("/app/content.val.ts", schema, {
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
  text: (
    <richtext>
      <p>
        Val is a CMS where <span theme="bold">content</span> is{" "}
        <span theme="bold">code</span> in your git repo.
      </p>
      <br />
      <p>Val is a CMS, which is useful because:</p>
      <ul>
        <li>
          editors can <span theme="bold">change content</span> without developer
          interactions
        </li>
        <li>
          <span theme="bold">images</span> can be managed without checking in
          code
        </li>
        <li>
          <span theme="bold">i18n</span> support is easy to add
        </li>
        <li>
          a <span theme="bold">well-documented</span> way to{" "}
          <span theme="bold">structure content</span>
        </li>
      </ul>
      <br />
      <p>But, with all the benefits of having content hard-coded:</p>
      <ul>
        <li>
          works as normal with your <span theme="bold">favorite IDE</span>{" "}
          without any plugins: search for content, references to usages, ...
        </li>
        <li>
          content is <span theme="bold">type-checked</span> so you see when
          something is wrong immediately
        </li>
        <li>
          content can be <span theme="bold">refactored</span> (change names,
          etc) just as if it was hard-coded (because it sort of is)
        </li>
        <li>
          work <span theme="bold">locally</span> or in{" "}
          <span theme="bold">branches</span> just as if you didn't use a CMS
        </li>
        <li>
          <span theme="bold">no need for code-gen</span> and extra build steps
        </li>
      </ul>
      <p>
        Visit <a href="https://val.build">Val</a> for more information.
      </p>
    </richtext>
  ),
});
