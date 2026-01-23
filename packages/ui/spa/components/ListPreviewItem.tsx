import {
  ImageSource,
  ImageMetadata,
  Internal,
  RemoteSource,
  VAL_EXTENSION,
} from "@valbuild/core";
import { cn } from "./designSystem/cn";
import { useState } from "react";

export function ListPreviewItem({
  title,
  image,
  subtitle,
  className,
}: {
  title: string;
  image: ImageSource | RemoteSource<ImageMetadata> | null;
  subtitle: string | null;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex w-full items-start justify-between pl-4 flex-grow text-left",
        className,
      )}
    >
      <div className="flex flex-col flex-shrink py-4 overflow-x-clip">
        <div className="font-semibold">{title}</div>
        {subtitle && (
          <div className="block overflow-hidden flex-shrink max-h-5 text-sm text-gray-500 text-ellipsis">
            {subtitle}
          </div>
        )}
      </div>
      {image && <ImageOrPlaceholder src={image} alt={title} />}
    </div>
  );
}

function ImageOrPlaceholder({
  src,
  alt,
}: {
  src: ImageSource | RemoteSource<ImageMetadata> | null | undefined;
  alt: string;
}) {
  const [isLoaded, setIsLoaded] = useState(false);

  if (src === null || src === undefined) {
    return (
      <div className="flex-shrink-0 ml-4 w-20 h-20 opacity-25 bg-bg-brand-secondary"></div>
    );
  }

  const imageUrl =
    src[VAL_EXTENSION] === "file"
      ? Internal.convertFileSource(src).url
      : Internal.convertRemoteSource(src).url;

  return (
    <div className="relative flex-shrink-0 ml-4 w-20 h-20">
      {!isLoaded && (
        <div className="absolute inset-0 opacity-25 bg-bg-brand-secondary animate-in"></div>
      )}
      <img
        src={imageUrl}
        alt={alt}
        onLoad={() => setIsLoaded(true)}
        onError={() => setIsLoaded(false)}
        className={`absolute inset-0 object-cover w-full h-full rounded-r-lg ${isLoaded ? "opacity-100" : "opacity-0"}`}
        style={{
          objectPosition: src.metadata?.hotspot
            ? `${src.metadata.hotspot.x}% ${src.metadata.hotspot.y}%`
            : "",
          transition: "opacity 0.2s ease-in-out",
        }}
      />
    </div>
  );
}
