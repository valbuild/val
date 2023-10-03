/* eslint-disable @typescript-eslint/ban-types */
import { FileSource, Source, VAL_EXTENSION } from "@valbuild/core";
import React from "react";

type ValRichTextRender<Tag extends string | number | symbol, T> =
  | ((
      props: T & {
        className: string;
        tag: Tag;
        children: React.ReactNode | React.ReactNode[];
      }
    ) => React.ReactElement)
  | string;

type ValRichTextProps<P extends Params> = {
  children: RichText<P>;
  render?: (P["tags"] extends string | number | symbol
    ? {
        tags: {
          [K in P["tags"]]: ValRichTextRender<
            K,
            {
              //
            }
          >;
        };
      }
    : {}) &
    (keyof P["nodes"] extends string | number | symbol
      ? {
          nodes: {
            [K in keyof P["nodes"]]: ValRichTextRender<
              K,
              {
                source: P["nodes"][K];
              }
            >;
          };
        }
      : {}) & {
      classes?: {
        [K in P["classes"] extends string | number | symbol
          ? P["classes"]
          : never]: string;
      };
    };
};

function ValRichText<P extends Params>(props: ValRichTextProps<P>) {
  return null;
}

export type UrlSource = {
  readonly value: string;
  readonly [VAL_EXTENSION]: "url";
};

type Params<
  Tags extends string | unknown = unknown,
  Classes extends string | unknown = unknown,
  Nodes extends { [K in string]: Source } = {}
> = {
  tags?: Tags;
  classes?: Classes;
  nodes?: Nodes;
};

type RichText<T extends Params> = T;

function Upper() {
  const text: RichText<{
    nodes: { img: FileSource };
    classes:
      | "font-sans"
      | "font-serif"
      | "text-xl"
      | "text-sm"
      | "underline"
      | "line-through";
    tags: "h1" | "h2" | "p";
  }> = {} as any;
  return (
    <div>
      <ValRichText
        render={{
          tags: {
            h1: "text-3xl text-bold",
            h2: "text-3xl text-bold",
            p: "text-base",
          },
          nodes: {
            img: "object-fit object-center",
          },
          classes: {
            "font-sans": "font-sans",
            "font-serif": "font-serif",
            "text-xl": "text-xl",
            "text-sm": "text-sm",
            underline: "underline",
            "line-through": "line-through",
          },
        }}
      >
        {text}
      </ValRichText>
    </div>
  );
}

const b = richtext({
  heading: ["h1", "h2"],
  image: true,
  code: true,
  blockquote: true,
  ul: true,
  ol: true,
  lineThrough: true,
  underline: true,
  textDirection: ["left", "right", "center"],
  fontSize: {
    xs: "safsadf",
  },
  fontFamily: {
    sans: "Gelato",
  },
});

const HEADING_TAGS = ["h1", "h2"] as const;
const TEXT_DIRECTIONS = ["left", "right", "center"] as const;
type Options = {
  heading?: (typeof HEADING_TAGS)[number][];
  image?: boolean;
  // button?: boolean;
  // section?: false | { headingTag: typeof HEADING_TAGS[number] } ;
  // anchor?: boolean | { tag: string[] };
  // details?: boolean;
  code?: boolean;
  blockquote?: boolean;
  italic?: boolean;
  ul?: boolean;
  ol?: boolean;
  lineThrough?: boolean;
  underline?: boolean;
  textDirection?: (typeof TEXT_DIRECTIONS)[number][];
  fontSize?: Record<string, string>;
  fontWeight?: Record<string, string | number>;
  fontFamily?: Record<string, string>;
};

type A = [
  {
    tag: "p";
    classes: ["underline", "line-through", "font-sans", "text-sm"];
  }
];

function richtext<
  O extends Options = {
    heading: (typeof HEADING_TAGS)[number][];
    image: true;
    code: true;
    blockquote: true;
    ul: true;
    ol: true;
    lineThrough: true;
    underline: true;
    textDirection?: (typeof TEXT_DIRECTIONS)[number][];
  }
>(
  options?: O
): RichText<{
  nodes: O["image"] extends true ? { img: FileSource } : {};
  tags:
    | "p"
    | "span"
    | (O["heading"] extends (typeof HEADING_TAGS)[number][]
        ? O["heading"][number]
        : (typeof HEADING_TAGS)[number])
    | (O["blockquote"] extends true ? "blockquote" : never)
    | (O["ul"] extends true ? "ul" | "ul>li" : never)
    | (O["ol"] extends true ? "ol" | "ol>li" : never)
    | (O["code"] extends true ? "code" : never);
  classes:
    | (O["fontFamily"] extends Record<string, string>
        ? `font-${keyof O["fontFamily"] & string}`
        : never)
    | (O["fontSize"] extends Record<string, string>
        ? `text-${keyof O["fontSize"] & string}`
        : never)
    | (O["underline"] extends true ? "underline" : never)
    | (O["lineThrough"] extends true ? "line-through" : never)
    | (O["italic"] extends true ? "italic" : never)
    | (O["textDirection"] extends [] ? O["textDirection"][number] : never);
}> {
  throw new Error("not implemented");
}

const a = richtext({ underline: true, ul: true });
