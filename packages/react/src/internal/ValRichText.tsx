/* eslint-disable @typescript-eslint/ban-types */
import {
  RichText,
  RichTextNode,
  AnyRichTextOptions,
  SourcePath,
  RichTextOptions,
  Classes as ClassesOf,
} from "@valbuild/core";
import React, { CSSProperties, ReactNode } from "react";

type DefaultThemes = Partial<{
  br: string | null;
  p: string | null;
  span: string | null;
}>;
type OptionalFields = {
  h1: string | null;
  h2: string | null;
  h3: string | null;
  h4: string | null;
  h5: string | null;
  h6: string | null;
  img: string | null;
  a: string | null;
  ul: string | null;
  ol: string | null;
  li: string | null;
  lineThrough: string | null;
  bold: string | null;
  italic: string | null;
};
type AllThemes = DefaultThemes & OptionalFields;
type ThemeOptions<O extends RichTextOptions = AnyRichTextOptions> =
  DefaultThemes &
    Pick<
      OptionalFields,
      | (O["img"] extends true ? "img" : never)
      | (O["a"] extends true ? "a" : never)
      | (O["ul"] extends true ? "ul" | "li" : never)
      | (O["ol"] extends true ? "ol" | "li" : never)
      | (O["lineThrough"] extends true ? "lineThrough" : never)
      | (O["bold"] extends true ? "bold" : never)
      | (O["italic"] extends true ? "italic" : never)
      | (O["headings"] extends Array<infer T>
          ? T extends "h1" | "h2" | "h3" | "h4" | "h5" | "h6"
            ? T
            : never
          : never)
    >;

/**
 * Render RichText as HTML
 *
 * @example
 * const content = useVal(contentVal);
 * return <ValRichText>{content.myRichText}</ValRichText>
 *
 * @example
 * const content = useVal(contentVal);
 * return (
 *   <ValRichText
 *     theme={{
 *       h1: 'text-4xl font-bold',
 *     }}>
 *    {content.myRichText}
 *   </ValRichText>
 * );
 *
 *
 * @example
 * const content = useVal(contentVal);
 * return (
 *   <ValRichText
 *     theme={{
 *        h1: 'text-4xl font-bold',
 *        img: 'rounded',
 *     }}
 *     transform={(node, className) => {
 *        if (node.tag === 'img') {
 *          return <Image className={className} src={node.src} alt={node.alt || ""} width={node.metadata?.width} height={node.metadata?.height} />
 *        }
 *     }}>
 *    {content.myRichText}
 *   </ValRichText>
 * );
 *
 * @param
 * @returns
 */
export function ValRichText<O extends RichTextOptions>({
  children,
  className,
  style,
  theme,
  transform,
}: {
  children: RichText<O>;
  className?: string;
  style?: CSSProperties;
  theme?: ThemeOptions<O>;
  transform?: (
    node: RichTextNode<O>,
    children: ReactNode | ReactNode[],
    className?: string
  ) => JSX.Element | string | undefined;
}) {
  const root = children as RichText<AnyRichTextOptions> & {
    valPath: SourcePath;
  };
  function build(
    child: RichTextNode<AnyRichTextOptions>,
    key?: number
  ): JSX.Element | string {
    if (typeof child === "string") {
      const transformed = transform && transform(child, []);
      if (transformed !== undefined) {
        return transformed;
      }
      return child;
    }
    const className = classNameOfTag(
      child.tag,
      "classes" in child ? child.classes : [],
      theme
    );
    const children =
      "children" in child
        ? // Why do this? We get a very weird error in NextJS 14.0.4 if we do not
          // Error: Cannot access Image.prototype on the server. You cannot dot into a client module from a server component. You can only pass the imported name through.
          // https://github.com/vercel/next.js/issues/52415
          child.children.length === 1
          ? build(child.children[0])
          : child.children.map(build)
        : null;
    if (transform) {
      const transformed = transform(
        child as RichTextNode<O>,
        children ?? [],
        className
      );
      if (transformed !== undefined) {
        return transformed;
      }
    }
    const tag = child.tag; // one of: "img" | "a" | "ul" | "ol" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "br" | "p" | "li" | "span"
    return React.createElement(tag, {
      key: key?.toString(),
      className,
      children,
    });
  }
  return (
    <div className={className} style={style} data-val-path={root.valPath}>
      {root.children.map(build)}
    </div>
  );
}

function classNameOfTag(
  tag: AllTagsOf<AnyRichTextOptions>,
  clazz: ClassesOf<AnyRichTextOptions>[],
  theme?: Partial<AllThemes>
) {
  let thisTagClassName: string | null = null;
  if (theme && tag in theme) {
    thisTagClassName = theme[tag] ?? null;
  }
  return [
    ...(thisTagClassName ? [thisTagClassName] : []),
    ...clazz.map((style) => {
      if (
        theme &&
        // not need on type-level, but defensive on runtime:
        typeof style === "string"
      ) {
        if (style === "line-through") {
          if ("lineThrough" in theme) {
            return theme["lineThrough"];
          }
        }
        if (style !== "line-through" && style in theme) {
          return theme[style];
        }
      }
      return clazz;
    }),
  ].join(" ");
}

type AllTagsOf<O extends RichTextOptions> =
  | (O["img"] extends true ? "img" : never)
  | (O["a"] extends true ? "a" : "nei")
  | (O["ul"] extends true ? "ul" | "li" : never)
  | (O["ol"] extends true ? "ol" | "li" : never)
  | (O["headings"] extends Array<infer T>
      ? T extends "h1"
        ? "h1"
        : never
      : never)
  | (O["headings"] extends Array<infer T>
      ? T extends "h2"
        ? "h2"
        : never
      : never)
  | (O["headings"] extends Array<infer T>
      ? T extends "h3"
        ? "h3"
        : never
      : never)
  | (O["headings"] extends Array<infer T>
      ? T extends "h4"
        ? "h4"
        : never
      : never)
  | (O["headings"] extends Array<infer T>
      ? T extends "h5"
        ? "h5"
        : never
      : never)
  | (O["headings"] extends Array<infer T>
      ? T extends "h6"
        ? "h6"
        : never
      : never)
  | "br"
  | "p"
  | "span";
