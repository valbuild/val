import { Source, Val } from "@valbuild/core";

// unpack all here to avoid infinite self-referencing when defining our own JSX namespace
//
// `React.JSX` rather than the bare global `JSX`: @types/react 19 removed the
// global JSX namespace, so the only remaining declaration is the one on the
// react module itself.
type ReactJSXElement = React.JSX.Element;
type ReactJSXElementClass = React.JSX.ElementClass;
type ReactJSXElementAttributesProperty = React.JSX.ElementAttributesProperty;
type ReactJSXElementChildrenAttribute = React.JSX.ElementChildrenAttribute;
type ReactJSXLibraryManagedAttributes<C, P> =
  React.JSX.LibraryManagedAttributes<C, P>;
type ReactJSXIntrinsicAttributes = React.JSX.IntrinsicAttributes;
type ReactJSXIntrinsicClassAttributes<T> =
  React.JSX.IntrinsicClassAttributes<T>;
type ReactJSXIntrinsicElements = React.JSX.IntrinsicElements;

type MaybeVal<T> = T extends Source ? Val<T> | T : T;
type WithVal<T extends object> = {
  [K in keyof T]: K extends "key" | "ref" | "className"
    ? T[K]
    : K extends "style"
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
