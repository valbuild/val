import { ImageSource, Internal } from "@valbuild/core";
import { ReactNode } from "react";
import { cn } from "./designSystem/cn";

export type DropdownPreviewImage = ImageSource | string | null | undefined;

export function DropdownPreviewRow({
  title,
  subtitle,
  image,
  className,
  imageSize = "md",
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  image?: DropdownPreviewImage;
  className?: string;
  /**
   * `sm` where the row is a menu item rather than a card — see
   * `ReferencesList`, whose rows carry a border of their own and have less room.
   */
  imageSize?: "sm" | "md";
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
        <div
          className={cn(
            "shrink-0 overflow-hidden rounded bg-bg-secondary",
            imageSize === "sm" ? "h-7 w-7" : "h-8 w-8",
          )}
        >
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
  return Internal.mediaUrl(image);
}
