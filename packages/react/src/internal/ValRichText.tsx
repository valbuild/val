/* eslint-disable @typescript-eslint/ban-types */
import {
  RichTextNode as RichTextSourceNode,
  AllRichTextOptions,
  RichTextOptions,
  Styles,
  SelectorSource,
  Schema,
} from "@valbuild/core";
import React, { CSSProperties, ReactNode } from "react";
import { RichText, StegaOfRichTextSource } from "../stega";

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
type ThemeOptions<O extends RichTextOptions = AllRichTextOptions> =
  DefaultThemes &
    Pick<
      OptionalFields,
      | (NonNullable<O["inline"]>["img"] extends true | Schema<SelectorSource>
          ? "img"
          : never)
      | (NonNullable<O["inline"]>["a"] extends true ? "a" : never)
      | (NonNullable<O["block"]>["ul"] extends true ? "ul" | "li" : never)
      | (NonNullable<O["block"]>["ol"] extends true ? "ol" | "li" : never)
      | (NonNullable<O["style"]>["lineThrough"] extends true
          ? "lineThrough"
          : never)
      | (NonNullable<O["style"]>["bold"] extends true ? "bold" : never)
      | (NonNullable<O["style"]>["italic"] extends true ? "italic" : never)
      | (NonNullable<O["block"]>["h1"] extends true ? "h1" : never)
      | (NonNullable<O["block"]>["h2"] extends true ? "h2" : never)
      | (NonNullable<O["block"]>["h3"] extends true ? "h3" : never)
      | (NonNullable<O["block"]>["h4"] extends true ? "h4" : never)
      | (NonNullable<O["block"]>["h5"] extends true ? "h5" : never)
      | (NonNullable<O["block"]>["h6"] extends true ? "h6" : never)
    >;

type RichTextNode = StegaOfRichTextSource<
  RichTextSourceNode<AllRichTextOptions>
>;

/**
 * Render RichText using JSX
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
 *        block: {
 *          h1: 'text-4xl font-bold',
 *        },
 *        inline: {
 *          img: 'rounded',
 *        }
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
    node: RichTextNode,
    children: ReactNode | ReactNode[],
    className?: string,
  ) => JSX.Element | string | undefined;
}) {
  const root = children as RichText<AllRichTextOptions> | undefined;
  function build(child: RichTextNode, key?: number): JSX.Element | string {
    if (typeof child === "string") {
      const transformed = transform && transform(child, []);
      if (transformed !== undefined) {
        return transformed;
      }
      return child;
    }
    const className = classNameOfTag(
      child.tag,
      child.tag === "span" ? child.styles : [],
      theme,
    );
    if (child.tag === "img") {
      const transformed = transform && transform(child, []);
      if (transformed !== undefined) {
        return transformed;
      }
      return React.createElement("img", {
        key: key?.toString(),
        className,
        src: child.src.url,
        // alt: child.alt, TODO: add alt to the img html object
        width: child.src.metadata?.width,
        height: child.src.metadata?.height,
      });
    }
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
        child as RichTextNode,
        children ?? [],
        className,
      );
      if (transformed !== undefined) {
        return transformed;
      }
    }
    const tag = child.tag; // one of:  "a" | "ul" | "ol" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "br" | "p" | "li" | "span"
    return React.createElement(tag, {
      key: key?.toString(),
      className,
      children,
      href: child.tag === "a" ? child.href : undefined,
    });
  }
  return (
    <div className={className} style={style} data-val-path={root?.valPath}>
      {root?.map(build)}
    </div>
  );
}

function classNameOfTag(
  tag: string,
  style: Styles<AllRichTextOptions>[],
  theme?: Partial<AllThemes>,
) {
  let thisTagClassName: string | null = null;
  if (theme && tag in theme) {
    thisTagClassName = (theme as Record<string, string | null>)[tag] ?? null;
  }
  return [
    ...(thisTagClassName ? [thisTagClassName] : []),
    ...style.map((style) => {
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
      return style;
    }),
  ].join(" ");
}
