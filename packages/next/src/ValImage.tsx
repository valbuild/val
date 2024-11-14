import NextImage from "next/image";
import { raw } from "./raw";
import { ValEncodedString, Image } from "@valbuild/react/stega";
import { decodeValPathOfString } from "./decodeValPathOfString";

// all NextImage component props
export type ValImageProps = Omit<
  React.ComponentProps<typeof NextImage>,
  | "src"
  | "srcset"
  | "layout"
  | "objectFit"
  | "objectPosition"
  | "lazyBoundary"
  | "lazyRoot"
> & {
  src: Image;
  disableHotspot?: boolean;
};
export function ValImage(props: ValImageProps) {
  const { src, alt, style, width, disableHotspot, height, ...rest } = props;
  const valPathOfUrl = decodeValPathOfString(src.url);
  const valPaths = [valPathOfUrl];
  const maybeValPathOfAlt = decodeValPathOfString(alt as ValEncodedString);
  if (maybeValPathOfAlt) {
    valPaths.push(maybeValPathOfAlt);
  }
  const hotspot = src.metadata?.hotspot;
  const imageStyle =
    hotspot && !disableHotspot
      ? {
          ...style,
          objectPosition: `${hotspot.x * 100}% ${hotspot.y * 100}%`,
        }
      : style;
  const useMetadataDimensions =
    src.metadata !== undefined && !rest.fill && !width && !height;
  const isUnoptimized =
    rest.unoptimized !== undefined
      ? rest.unoptimized
      : src.metadata?.mimeType === "image/svg+xml"; // SVGs are unoptimized by default
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
      src={valPathOfUrl ? raw(src.url) : src.url}
      data-val-path={valPaths.join(",")}
      data-val-attr-alt={maybeValPathOfAlt}
      data-val-attr-src={valPathOfUrl}
      style={imageStyle}
      alt={raw(alt as ValEncodedString)}
      fill={rest.fill}
      width={useMetadataDimensions ? src.metadata?.width : width}
      height={useMetadataDimensions ? src.metadata?.height : height}
      unoptimized={isUnoptimized}
    ></NextImage>
  );
}
