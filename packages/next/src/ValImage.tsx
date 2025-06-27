import NextImage from "next/image";
import { raw } from "./raw";
import { ValEncodedString, Image } from "@valbuild/react/stega";
import { decodeValPathOfString } from "./decodeValPathOfString";

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
  const valPathOfUrl = src?.url && decodeValPathOfString(src.url);
  const valPaths = [valPathOfUrl];
  const maybeValPathOfAlt = decodeValPathOfString(alt as ValEncodedString);
  if (maybeValPathOfAlt) {
    valPaths.push(maybeValPathOfAlt);
  }
  const hotspot = src?.metadata?.hotspot;
  const imageStyle =
    hotspot && !disableHotspot
      ? {
          ...style,
          objectPosition: `${hotspot.x * 100}% ${hotspot.y * 100}%`,
        }
      : style;
  const preferMetadataDims =
    src?.metadata !== undefined && !rest.fill && !width && !height;
  const isUnoptimized =
    rest.unoptimized !== undefined
      ? rest.unoptimized
      : src?.metadata?.mimeType === "image/svg+xml"; // SVGs are unoptimized by default
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
      src={valPathOfUrl ? raw(src?.url) : src?.url}
      data-val-path={valPaths.join(",")}
      data-val-attr-alt={maybeValPathOfAlt}
      data-val-attr-src={valPathOfUrl}
      style={imageStyle}
      alt={
        alt
          ? raw(alt as ValEncodedString)
          : src?.metadata?.alt
            ? raw(src?.metadata?.alt as ValEncodedString)
            : ""
      }
      fill={rest.fill}
      width={preferMetadataDims ? src?.metadata?.width : width}
      height={preferMetadataDims ? src?.metadata?.height : height}
      unoptimized={isUnoptimized}
    ></NextImage>
  );
}
