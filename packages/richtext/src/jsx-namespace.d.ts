/* eslint-disable @typescript-eslint/ban-types */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
export namespace ValRichTextJSX {
  export type Element =
    | {
        tag: "h1";
        children: string;
        props: Record<string, any>;
      }
    | {
        tag: "richtext";
        children: null;
        props: Record<string, any>;
      }
    | {
        tag: "img";
        children: [] | null;
        props: Record<string, any>;
      };
  // export type Fragment = any;
  // export type ElementClass = any;
  export type ElementAttributesProperty = {
    props: {};
  };
  export type ElementChildrenAttribute = {
    children: {};
  };

  // export type IntrinsicAttributes = {};
  // export type IntrinsicClassAttributes<T> = {};

  export type IntrinsicElements = {
    h1: {
      className?: string;
      children: string;
    };
    p: {
      className?: string;
    };
    richtext: {
      children: Element[] | Element;
    };
    img:
      | {
          path: string;
          className?: string;
          alt?: string;
          height?: number;
          width?: number;
          sha256?: string;
        }
      | {
          src: string;
          className?: string;
          alt?: string;
          height?: number;
          width?: number;
        };
  };
}
