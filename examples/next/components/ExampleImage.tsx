import Image from "next/image";
import { Image as ValImage } from "../app/content.val";

export function ExampleImage({
  src,
  width,
  height,
  sizes,
  style,
  className,
}: {
  src: ValImage;
  width?: number;
  height?: number;
  sizes?: string;
  style?: React.CSSProperties;
  className?: string;
}) {
  const hotspot = src.data.metadata?.hotspot;
  const imageStyle = hotspot
    ? { ...style, objectPosition: `${hotspot.x * 100}% ${hotspot.y * 100}%` }
    : style;

  return (
    <Image
      src={src.data.url}
      alt={src.alt}
      height={height || src.data.metadata?.height}
      width={width || src.data.metadata?.width}
      // sizes={sizes}
      className={className}
    ></Image>
  );
}
