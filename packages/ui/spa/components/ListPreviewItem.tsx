import { ImageSource, Internal } from "@valbuild/core";
import { cn } from "./designSystem/cn";
import { useState } from "react";

/**
 * A value that HAS a preview, drawn as a compact media row: thumbnail on the
 * left, title and subtitle stacked tight beside it, one line each.
 *
 * The point is that it should not look like the fallback. When a schema
 * declares `.preview(...)` we know exactly what the row is made of — a title,
 * maybe a subtitle, maybe an image — so the row is laid out for that shape
 * instead of dumping whatever the value happens to contain (which is what
 * `Preview` does, and what a reader sees when no preview is declared). Rows
 * are deliberately short: a page-builder tree wants several list levels on one
 * laptop screen, not three tall cards.
 *
 * Padding lives HERE, not in the callers: `RefPreview` picks between this and
 * the fallback, and the two used to be padded differently by whoever wrapped
 * them, so the same list changed density depending on which branch a row took.
 */
export function ListPreviewItem({
  title,
  image,
  subtitle,
  className,
  size,
}: {
  title: string;
  /**
   * Three states, not two, because the preview tells us which it is:
   * an `ImageSource` draws the thumbnail, `null` means the preview declares an
   * image that this value does not have — so the column is still reserved,
   * with a placeholder, and rows in the same list stay aligned — and
   * `undefined` means it declares no image at all, so there is no column and
   * the title starts at the edge.
   */
  image?: ImageSource | null;
  subtitle: string | null;
  className?: string;
  size?: "compact";
}) {
  const compact = size === "compact";
  return (
    <div
      className={cn(
        "flex items-center gap-3 p-2 w-full min-w-0 text-left",
        className,
      )}
    >
      {image !== undefined &&
        (image === null ? (
          <div
            className={cn(
              "flex-shrink-0 rounded opacity-25 bg-bg-brand-secondary",
              compact ? "w-8 h-8" : "w-10 h-10",
            )}
          />
        ) : (
          <Thumbnail src={image} alt={title} compact={compact} />
        ))}
      <div className="flex flex-col flex-1 gap-0.5 min-w-0">
        <div
          className={cn("font-medium leading-tight truncate", {
            "text-sm": compact,
          })}
        >
          {title}
        </div>
        {subtitle && (
          <div
            className={cn(
              "leading-tight truncate text-fg-tertiary",
              compact ? "text-xs" : "text-sm",
            )}
          >
            {subtitle}
          </div>
        )}
      </div>
    </div>
  );
}

function Thumbnail({
  src,
  alt,
  compact,
}: {
  src: ImageSource;
  alt: string;
  compact: boolean;
}) {
  const [isLoaded, setIsLoaded] = useState(false);
  const imageUrl = Internal.mediaUrl(src);

  return (
    <div
      className={cn(
        "flex-shrink-0 relative rounded overflow-hidden",
        compact ? "w-8 h-8" : "w-10 h-10",
      )}
    >
      {!isLoaded && (
        <div className="absolute inset-0 opacity-25 bg-bg-brand-secondary animate-in"></div>
      )}
      <img
        src={imageUrl}
        alt={alt}
        onLoad={() => setIsLoaded(true)}
        onError={() => setIsLoaded(false)}
        className={cn(
          "absolute inset-0 object-cover w-full h-full",
          isLoaded ? "opacity-100" : "opacity-0",
        )}
        style={{
          objectPosition: src.hotspot
            ? `${src.hotspot.x * 100}% ${src.hotspot.y * 100}%`
            : "",
          transition: "opacity 0.2s ease-in-out",
        }}
      />
    </div>
  );
}
