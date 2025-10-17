import { c } from "../../../../val.config";
import { schema } from "./schema.val";

export default c.define("/app/[locale]/blogs/[blog]/en-us.val.ts", schema, {
  "/en-us/blogs/my-page": {
    title: "My page",
    author: "freekh",
    content: [
      {
        tag: "p",
        children: ["English content"],
      },
    ],
    link: {
      href: "/",
      label: "Home",
    },
    translation: "/nb-no/blogs/min-side",
  },
});
