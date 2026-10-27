import NextImage from "next/image";
import { raw, ValEncodedString, Image } from "@valbuild/react/stega";
import { decodeValPathsOfString } from "./decodeValPathsOfString";

// all NextImage component props
export type ValImageProps = Omit<
  React.ComponentProps<typeof NextImage>,
  | "src"
  | "alt"
  | "srcset"
  | "layout"
  | "objectFit"
  | "objectPosition"
  | "lazyBoundary"
  | "lazyRoot"
> & {
  alt?: string;
  src: Image;
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
  const preferMetadataDims =
    (src?.width !== undefined || src?.height !== undefined) &&
    !rest.fill &&
    !width &&
    !height;
  const isUnoptimized =
    rest.unoptimized !== undefined
      ? rest.unoptimized
      : src?.mimeType === "image/svg+xml"; // SVGs are unoptimized by default
  return (
    <NextImage
      {...{
        ...rest,
        layout: undefined,
        objectFit: undefined,
        objectPosition: undefined,
        lazyBoundary: undefined,
        lazyRoot: undefined,
      }}
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
      fill={rest.fill}
      width={preferMetadataDims ? src?.width : width}
      height={preferMetadataDims ? src?.height : height}
      unoptimized={isUnoptimized}
    ></NextImage>
  );
}
