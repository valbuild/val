import { raw, ValEncodedString, Image } from "@valbuild/react/stega";
import { decodeValPathsOfString } from "./decodeValPathsOfString";

/**
 * An `<img>` for a Val image, with the edit tags kept where the Studio can see
 * them.
 *
 * The Next package wraps `next/image`. TanStack Start has no image component,
 * so this is a plain `<img>` — which means it also carries what `next/image`
 * would have supplied on its own: the intrinsic `width`/`height` from the
 * source (so the browser can reserve the space) and `hotspot` as
 * `object-position`.
 *
 * What it exists for is the tags. `src.url` is stega-encoded, so it cannot be
 * put in an `src` attribute as-is: the invisible characters would be sent to
 * the server. `raw()` strips them and the paths they carried are re-attached as
 * `data-val-path` / `data-val-attr-*`, which is what makes the image
 * click-to-edit.
 */
export type ValImageProps = Omit<
  React.ComponentProps<"img">,
  "src" | "alt" | "srcSet"
> & {
  alt?: string;
  src: Image;
  /** Ignore the image's hotspot instead of applying it as object-position. */
  disableHotspot?: boolean;
};

export function ValImage(props: ValImageProps) {
  const { src, alt, style, width, disableHotspot, height, ...rest } = props;
  const valPathsOfUrl = src?.url ? decodeValPathsOfString(src.url) : undefined;
  const valPaths: string[] = valPathsOfUrl ? valPathsOfUrl : [];
  const maybeValPathOfAlt = alt
    ? decodeValPathsOfString(alt as ValEncodedString)
    : undefined;
  if (maybeValPathOfAlt) {
    for (const valPath of maybeValPathOfAlt) {
      valPaths.push(valPath);
    }
  }
  const hotspot = src?.hotspot;
  const imageStyle =
    hotspot && !disableHotspot
      ? {
          ...style,
          objectPosition: `${hotspot.x * 100}% ${hotspot.y * 100}%`,
        }
      : style;
  // The authored dimensions are only used when the caller has not said
  // otherwise: an explicit width/height is the caller sizing the element, and
  // overriding it with the file's own size would fight them.
  const preferMetadataDims =
    (src?.width !== undefined || src?.height !== undefined) &&
    !width &&
    !height;
  return (
    <img
      {...rest}
      src={valPathsOfUrl && valPathsOfUrl.length > 0 ? raw(src?.url) : src?.url}
      data-val-path={valPaths.join(",")}
      data-val-attr-alt={maybeValPathOfAlt}
      data-val-attr-src={
        valPathsOfUrl && valPathsOfUrl.length > 0
          ? valPathsOfUrl.join(",")
          : undefined
      }
      style={imageStyle}
      alt={
        alt
          ? raw(alt as ValEncodedString)
          : src?.alt
            ? raw(src?.alt as ValEncodedString)
            : ""
      }
      width={preferMetadataDims ? src?.width : width}
      height={preferMetadataDims ? src?.height : height}
    />
  );
}
