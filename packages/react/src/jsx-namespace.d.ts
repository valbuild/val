import { Val } from "@val/lib/src/Val";

// unpack all here to avoid infinite self-referencing when defining our own JSX namespace
type ReactJSXElement = JSX.Element;
type ReactJSXElementClass = JSX.ElementClass;
type ReactJSXElementAttributesProperty = JSX.ElementAttributesProperty;
type ReactJSXElementChildrenAttribute = JSX.ElementChildrenAttribute;
type ReactJSXLibraryManagedAttributes<C, P> = JSX.LibraryManagedAttributes<
  C,
  P
>;
type ReactJSXIntrinsicAttributes = JSX.IntrinsicAttributes;
type ReactJSXIntrinsicClassAttributes<T> = JSX.IntrinsicClassAttributes<T>;
type ReactJSXIntrinsicElements = JSX.IntrinsicElements;

type MaybeVal<T> = T extends string ? Val<T> | T : T;
type WithVal<T extends object> = {
  [K in keyof T]: K extends "style"
    ? WithVal<React.CSSProperties>
    : T[K] extends object
    ? T[K]
    : MaybeVal<T[K]>;
};

export namespace ValJSX {
  export type Element = ReactJSXElement;
  export type ElementClass = ReactJSXElementClass;
  export type ElementAttributesProperty = ReactJSXElementAttributesProperty;
  export type ElementChildrenAttribute = ReactJSXElementChildrenAttribute;

  export type LibraryManagedAttributes<C, P> = ReactJSXLibraryManagedAttributes<
    C,
    P
  >;

  export type IntrinsicAttributes = ReactJSXIntrinsicAttributes;
  export type IntrinsicClassAttributes<T> = ReactJSXIntrinsicClassAttributes<T>;

  export type IntrinsicElements = {
    [K in keyof ReactJSXIntrinsicElements]: WithVal<
      ReactJSXIntrinsicElements[K]
    >;
  };
}
