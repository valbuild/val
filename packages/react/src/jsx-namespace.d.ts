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
type WithVal<T extends {}> = {
  [K in keyof T]: K extends "style"
    ? WithVal<React.CSSProperties>
    : T[K] extends {}
    ? T[K]
    : MaybeVal<T[K]>;
};

export namespace ValJSX {
  interface Element extends ReactJSXElement {}
  interface ElementClass extends ReactJSXElementClass {}
  interface ElementAttributesProperty
    extends ReactJSXElementAttributesProperty {}
  interface ElementChildrenAttribute extends ReactJSXElementChildrenAttribute {}

  type LibraryManagedAttributes<C, P> = ReactJSXLibraryManagedAttributes<C, P>;

  interface IntrinsicAttributes extends ReactJSXIntrinsicAttributes {}
  interface IntrinsicClassAttributes<T>
    extends ReactJSXIntrinsicClassAttributes<T> {}

  type IntrinsicElements = {
    [K in keyof ReactJSXIntrinsicElements]: WithVal<
      ReactJSXIntrinsicElements[K]
    >;
  };
}
