/* eslint-disable @typescript-eslint/ban-types */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
export namespace ValRichTextJSX {
  export type Element = {
    tag: keyof IntrinsicElements;
    children: Element[] | string;
    props: Record<string, any>;
  };
  export type Fragment = any;
  export type ElementClass = any;
  export type ElementAttributesProperty = {
    props: {};
  };
  type ReactJSXElementChildrenAttribute = { children: {} };

  export type IntrinsicAttributes = {};
  export type IntrinsicClassAttributes<T> = {};

  export type IntrinsicElements = {
    h1: {
      className?: string;
    };
    h2: {
      className?: string;
    };
    h3: {
      className?: string;
    };
    h4: {
      className?: string;
    };
    h5: {
      className?: string;
    };
    h6: {
      className?: string;
    };
    p: {
      className?: string;
    };
    span: {};
    richtext: {};
    img:
      | (
          | {
              path: string;
            }
          | { src: string }
        ) & {
          className?: string;
          alt?: string;
          height?: number;
          width?: number;
          sha256?: string;
        };
  };
}
