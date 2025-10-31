import { c } from "../../../../val.config";
import { schema } from "./schema.val";

export default c.define("/app/[locale]/blogs/[blog]/nb-no.val.ts", schema, {
  "/nb-no/blogs/min-side": {
    title: "Min side",
    author: "thoram",
    content: [
      {
        tag: "p",
        children: ["Norsk innhold"],
      },
    ],
    link: {
      href: "/",
      label: "Hjem",
    },
    translation: "/en-us/blogs/my-page",
  },
});
