import {
  RichTextNode as RichTextSourceNode,
  AllRichTextOptions,
  RichTextOptions,
  Styles,
  SelectorSource,
  Schema,
} from "@valbuild/core";
import React, { CSSProperties, type JSX, ReactNode } from "react";
import { attrs, raw, RichText, StegaOfRichTextSource } from "../stega";

/**
 * The tags that are in every richtext, whatever the options say: no option
 * turns them on, so a theme never has to mention them.
 */
type DefaultThemes = Partial<{
  br: string | null;
  p: string | null;
  span: string | null;
}>;
/**
 * The class name of every tag or style that an option turns on. The keys are
 * the option names themselves, which is what makes a theme exhaustive by
 * construction: enable `italic` in the schema and `italic` becomes a required
 * key here.
 *
 * `li` is the one key without an option of its own - it comes with `ul`/`ol`.
 */
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

/** `a` and `img` are on when they carry a schema, not only when they are `true`. */
type IsEnabled<T> = T extends true
  ? true
  : T extends Schema<SelectorSource>
    ? true
    : false;

/** Every option name `O` turns on, plus `li` when it has a list. */
type EnabledThemeKeys<O extends RichTextOptions> =
  | {
      [K in keyof OptionalFields & keyof RichTextOptions]: IsEnabled<
        O[K]
      > extends true
        ? K
        : never;
    }[keyof OptionalFields & keyof RichTextOptions]
  | (IsEnabled<O["ul"]> extends true
      ? "li"
      : IsEnabled<O["ol"]> extends true
        ? "li"
        : never);

/**
 * The `theme` a `ValRichText` accepts for a given set of richtext options: a
 * class name for every tag or style those options turn on, and nothing more.
 * Every key is required, so forgetting one is a type error naming it.
 */
export type ThemeOptions<O extends RichTextOptions = AllRichTextOptions> =
  DefaultThemes & Pick<OptionalFields, EnabledThemeKeys<O>>;

type RichTextNode = StegaOfRichTextSource<
  RichTextSourceNode<AllRichTextOptions>
>;

/**
 * Render RichText using JSX
 *
 * @example
 * const content = useVal(contentVal);
 * return <ValRichText content={content.myRichText} />
 *
 * @example
 * const content = useVal(contentVal);
 * return (
 *   <ValRichText
 *     theme={{
 *       h1: 'text-4xl font-bold',
 *     }}
 *     content={content.myRichText}
 *   />
 * );
 *
 *
 * @example
 * const content = useVal(contentVal);
 * return (
 *   <ValRichText
 *     content={content.myRichText}
 *     theme={{
 *        h1: 'text-4xl font-bold',
 *        img: 'rounded',
 *     }}
 *     transform={(node, className) => {
 *        if (node.tag === 'img') {
 *          return <Image className={className} src={node.src} alt={node.alt || ""} width={node.metadata?.width} height={node.metadata?.height} />
 *        }
 *     }} />
 * );
 *
 * @returns
 */
export function ValRichText<O extends RichTextOptions>({
  className,
  style,
  theme,
  transform,
  ...props
}: {
  className?: string;
  style?: CSSProperties;
  theme?: ThemeOptions<O>;
  transform?: (
    node: RichTextNode,
    children: ReactNode | ReactNode[],
    className?: string,
    key?: number,
  ) => JSX.Element | (string | JSX.Element)[] | string | undefined;
} & (
  | {
      /**
       * When using `children` - use the `content` prop instead.
       */
      children: RichText<O>;
    }
  | {
      content: RichText<O>;
    }
)) {
  const root = ("content" in props ? props.content : props.children) as
    | RichText<AllRichTextOptions>
    | undefined;
  function build(
    child: RichTextNode,
    key?: number,
  ): JSX.Element | (string | JSX.Element)[] | string | undefined {
    if (typeof child === "string") {
      const transformed = transform && transform(child, [], undefined, key);
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
      const transformed = transform && transform(child, [], undefined, key);
      if (transformed !== undefined) {
        return transformed;
      }
      return React.createElement("img", {
        key: key?.toString(),
        className,
        src: child.src.url,
        // alt: child.alt, TODO: add alt to the img html object
        width: child.src.width,
        height: child.src.height,
      });
    }
    const children =
      "children" in child
        ? // Why do this? We get a very weird error in NextJS 14.0.4 if we do not
          // Error: Cannot access Image.prototype on the server. You cannot dot into a client module from a server component. You can only pass the imported name through.
          // https://github.com/vercel/next.js/issues/52415
          child.children.length === 1
          ? build(child.children[0], key)
          : child.children.map(build)
        : null;
    if (transform) {
      const transformed = transform(
        child as RichTextNode,
        children ?? [],
        className,
        key,
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
    <div className={className} style={style} {...attrs(root)}>
      {raw(root)?.map(build)}
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
