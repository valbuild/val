import {
  ImageMetadata,
  ImageSource,
  Internal,
  RemoteSource,
  VAL_EXTENSION,
} from "@valbuild/core";
import { ReactNode } from "react";
import { cn } from "./designSystem/cn";

export type DropdownPreviewImage =
  | ImageSource
  | RemoteSource<ImageMetadata>
  | string
  | null
  | undefined;

export function DropdownPreviewRow({
  title,
  subtitle,
  image,
  className,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  image?: DropdownPreviewImage;
  className?: string;
}) {
  const imageUrl = resolveImageUrl(image);
  return (
    <div className={cn("flex min-w-0 flex-1 items-center gap-2", className)}>
      <div className="flex min-w-0 flex-1 flex-col">
        {title != null &&
          title !== "" &&
          (typeof title === "string" ? (
            <span className="truncate font-medium">{title}</span>
          ) : (
            <div className="font-medium">{title}</div>
          ))}
        {subtitle != null &&
          subtitle !== "" &&
          (typeof subtitle === "string" ? (
            <span className="truncate text-xs text-fg-secondary">
              {subtitle}
            </span>
          ) : (
            <div className="text-xs text-fg-secondary">{subtitle}</div>
          ))}
      </div>
      {imageUrl && (
        <div className="h-8 w-8 shrink-0 overflow-hidden rounded bg-bg-secondary">
          <img
            src={imageUrl}
            alt={typeof title === "string" ? title : ""}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </div>
      )}
    </div>
  );
}

function resolveImageUrl(image: DropdownPreviewImage): string | null {
  if (image === null || image === undefined) {
    return null;
  }
  if (typeof image === "string") {
    return image;
  }
  if (image[VAL_EXTENSION] === "file") {
    return Internal.convertFileSource(image).url;
  }
  if (image[VAL_EXTENSION] === "remote") {
    return Internal.convertRemoteSource(image).url;
  }
  return null;
}
