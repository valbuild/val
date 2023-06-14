import { s, val } from "../val.config";

export const schema = s.array(
  s.object({
    title: s.string(), // TODO: i18n
    /**
     * Blog image. We only allow png and jpg.
     */
    image: s.image(),
    /**
     * The text is optional, by the way.
     */
    text: s.richtext(),
    /**
     * The rank is some arbitrary number we sort by.
     */
    rank: s.number(),
  })
);

export default val.content("/app/blogs", schema, [
  {
    title: "HVA? asdasdas     dasdas ascasasdasdas eqweqweqweqw shabbaboooey. ",
    image: val.file("/public/val/app/blogs/image1.jpg", {
      width: 512,
      height: 512,
      sha256:
        "9e420dc93157ab98338542ba6f1d34fcf829d646aa729a86720fa3f4cb2d0076",
    }),
    text: { children: [{ children: [{ detail: 0, format: 0, mode: "normal", style: "", text: "Heading 1", type: "text", version: 1 }], direction: "ltr", format: "", indent: 0, type: "heading", version: 1, tag: "h1" }, { children: [{ detail: 0, format: 0, mode: "normal", style: "", text: "Heading 2", type: "text", version: 1 }], direction: "ltr", format: "", indent: 0, type: "heading", version: 1, tag: "h2" }, { children: [], direction: "ltr", format: "", indent: 0, type: "paragraph", version: 1 }, { children: [{ detail: 0, format: 0, mode: "normal", style: "font-size: 11px;", text: "Normal small", type: "text", version: 1 }], direction: "ltr", format: "", indent: 0, type: "paragraph", version: 1 }, { children: [{ detail: 0, format: 0, mode: "normal", style: "font-size: 20px;", text: "Normal Font size 20", type: "text", version: 1 }], direction: "ltr", format: "", indent: 0, type: "paragraph", version: 1 }, { children: [{ detail: 0, format: 0, mode: "normal", style: "font-family: serif;", text: "Normal font type serif", type: "text", version: 1 }], direction: "ltr", format: "", indent: 0, type: "paragraph", version: 1 }, { children: [{ detail: 0, format: 1, mode: "normal", style: "font-family: serif;", text: "Serif and bold", type: "text", version: 1 }], direction: "ltr", format: "", indent: 0, type: "paragraph", version: 1 }, { children: [{ detail: 0, format: 2, mode: "normal", style: "", text: "Arial and italic", type: "text", version: 1 }], direction: "ltr", format: "", indent: 0, type: "paragraph", version: 1 }, { children: [{ detail: 0, format: 8, mode: "normal", style: "", text: "Underline", type: "text", version: 1 }], direction: "ltr", format: "", indent: 0, type: "paragraph", version: 1 }, { children: [{ detail: 0, format: 4, mode: "normal", style: "", text: "strikethrough", type: "text", version: 1 }], direction: "ltr", format: "", indent: 0, type: "paragraph", version: 1 }, { children: [{ detail: 0, format: 12, mode: "normal", style: "", text: "Underline then strikethrough", type: "text", version: 1 }], direction: "ltr", format: "", indent: 0, type: "paragraph", version: 1 }], direction: "ltr", format: "", indent: 0, type: "root", version: 1 },
    rank: 100,
  },
  {
    title: "HVEM ER VI? Hvem er vi s\u00E5nn eeeeegentlig? h\u00E6\u00E6\u00E6.                ",
    image: val.file("/public/val/app/blogs/image2.jpg", {
      width: 512,
      height: 512,
      sha256:
        "9d39bf1a0b7efb117c5b6cfbca0911904c0be3d07588142db624dab183c33e20",
    }),
    text: {
      direction: "ltr",
      format: "",
      indent: 0,
      type: "root",
      version: 1,
      children: [],
    },
    rank: 10,
  },
  {
    title: "HVORFOR? ikke?",
    image: val.file("/public/val/app/blogs/image3.jpg", {
      width: 512,
      height: 512,
      sha256:
        "5d70cf57c58aed863e79971cc78607ccd26529050ceb083e9face9670581ea7d",
    }),
    text: {
      children: [
        {
          children: [
            {
              detail: 0,
              format: 0,
              mode: "normal",
              style: "",
              text: "Lists:",
              type: "text",
              version: 1,
            },
          ],
          direction: "ltr",
          format: "",
          indent: 0,
          type: "paragraph",
          version: 1,
        },
        {
          children: [
            {
              children: [
                {
                  detail: 0,
                  format: 0,
                  mode: "normal",
                  style: "",
                  text: "Num list 1",
                  type: "text",
                  version: 1,
                },
              ],
              direction: "ltr",
              format: "",
              indent: 0,
              type: "listitem",
              version: 1,
              value: 1,
            },
            {
              children: [
                {
                  detail: 0,
                  format: 0,
                  mode: "normal",
                  style: "",
                  text: "Num list 2",
                  type: "text",
                  version: 1,
                },
              ],
              direction: "ltr",
              format: "",
              indent: 0,
              type: "listitem",
              version: 1,
              value: 2,
            },
          ],
          direction: "ltr",
          format: "",
          indent: 0,
          type: "list",
          version: 1,
          listType: "number",
          start: 1,
          tag: "ol",
        },
        {
          children: [],
          direction: null,
          format: "",
          indent: 0,
          type: "paragraph",
          version: 1,
        },
        {
          children: [
            {
              children: [
                {
                  detail: 0,
                  format: 0,
                  mode: "normal",
                  style: "",
                  text: "Bullet list 1",
                  type: "text",
                  version: 1,
                },
              ],
              direction: "ltr",
              format: "",
              indent: 0,
              type: "listitem",
              version: 1,
              value: 1,
            },
            {
              children: [
                {
                  detail: 0,
                  format: 0,
                  mode: "normal",
                  style: "",
                  text: "Bullet list 2",
                  type: "text",
                  version: 1,
                },
              ],
              direction: "ltr",
              format: "",
              indent: 0,
              type: "listitem",
              version: 1,
              value: 2,
            },
          ],
          direction: "ltr",
          format: "",
          indent: 0,
          type: "list",
          version: 1,
          listType: "bullet",
          start: 1,
          tag: "ul",
        },
        {
          children: [],
          direction: null,
          format: "",
          indent: 0,
          type: "heading",
          version: 1,
          tag: "h2",
        },
      ],
      direction: "ltr",
      format: "",
      indent: 0,
      type: "root",
      version: 1,
    },
    rank: 1,
  },
]);
