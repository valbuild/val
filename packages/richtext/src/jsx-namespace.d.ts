import { RichText } from "@valbuild/core";

/* eslint-disable @typescript-eslint/ban-types */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
export namespace ValRichTextJSX {
  export type Element = RichText<{}>;
  export type Fragment = any;
  export type ElementClass = any;
  export type ElementAttributesProperty = {
    props: {};
  };
  type ReactJSXElementChildrenAttribute = { children: {} };

  export type IntrinsicAttributes = {};
  export type IntrinsicClassAttributes<T> = {};

  export type IntrinsicElements = {
    h1: {};
    h2: {};
    h3: {};
    h4: {};
    h5: {};
    h6: {};
    p: {};
    span: {
      theme?: string;
    };
    richtext: {};
    br: {};
    a: {
      href: string;
    };
    ul: {};
    ol: {};
    li: {};
    img:
      | (
          | {
              path: string;
            }
          | { src: string }
        ) & {
          alt?: string;
          height?: number;
          width?: number;
          sha256?: string;
        };
  };
}
