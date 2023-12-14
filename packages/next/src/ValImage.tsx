import NextImage from "next/image";
import { raw } from "./raw";
import { ValEncodedString, Image as ValImage } from "@valbuild/react/stega";
import { decodeValPathOfString } from "./decodeValPathOfString";

// all NextImage component props
export type ValImageProps = Omit<
  React.ComponentProps<typeof NextImage>,
  "src" | "srcset"
> & {
  src: ValImage;
};
export function ValImage(props: ValImageProps) {
  const { src, alt, style, width, height, ...rest } = props;
  const valPathOfUrl = decodeValPathOfString(src.url);
  const valPaths = [valPathOfUrl];
  const maybeValPathOfAlt = decodeValPathOfString(alt as ValEncodedString);
  if (maybeValPathOfAlt) {
    valPaths.push(maybeValPathOfAlt);
  }
  const hotspot = src.metadata?.hotspot;
  const imageStyle = hotspot
    ? {
        ...style,
        objectPosition: `${hotspot.x * 100}% ${hotspot.y * 100}%`,
      }
    : style;
  return (
    <NextImage
      {...rest}
      src={valPathOfUrl ? raw(src.url) : src.url}
      data-val-path={valPaths.join(",")}
      data-val-attr-alt={maybeValPathOfAlt}
      data-val-attr-src={valPathOfUrl}
      style={imageStyle}
      alt={raw(alt as ValEncodedString)}
      width={width || src.metadata?.width}
      height={height || src.metadata?.height}
    ></NextImage>
  );
}
