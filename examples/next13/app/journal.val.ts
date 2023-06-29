import { s, val } from "../val.config";

export const schema = s.array(
  s.object({
    title: s.string(), // TODO: i18n
    /**
     * Blog image. We only allow png and jpg.
     */
    image: s.image().optional(),
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

export default val.content("/app/journal", schema, [
  {
    title: "Dear Diary?",
    image: val.file("/public/val/app/journal/image1.jpg", {
      width: 512,
      height: 512,
      sha256:
        "9e420dc93157ab98338542ba6f1d34fcf829d646aa729a86720fa3f4cb2d0076",
    }),
    text: {
      children: [
        {
          children: [],
          direction: "ltr",
          format: "",
          indent: 0,
          type: "paragraph",
          version: 1,
        },
        {
          children: [
            {
              detail: 0,
              format: 0,
              mode: "normal",
              style: "font-size: 11px;",
              text: "Normal small",
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
              detail: 0,
              format: 0,
              mode: "normal",
              style: "font-size: 20px;",
              text: "Normal Font size 20",
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
              detail: 0,
              format: 0,
              mode: "normal",
              style: "font-family: serif;",
              text: "Normal font type serif",
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
              detail: 0,
              format: 1,
              mode: "normal",
              style: "font-family: serif;",
              text: "Serif and bold",
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
              detail: 0,
              format: 2,
              mode: "normal",
              style: "",
              text: "Arial and italic",
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
              detail: 0,
              format: 8,
              mode: "normal",
              style: "",
              text: "Underline",
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
              detail: 0,
              format: 4,
              mode: "normal",
              style: "",
              text: "strikethrough",
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
              detail: 0,
              format: 12,
              mode: "normal",
              style: "",
              text: "Underline then strikethrough",
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
      ],
      direction: "ltr",
      format: "",
      indent: 0,
      type: "root",
      version: 1,
    },
    rank: 100,
  },
  {
    title: "Today I started to use Val?",
    image: null,
    text: {
      children: [
        {
          children: [
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
  {
    title: "Why hasn't there ever been such a great CMS such as this?",
    image: null,
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
]);