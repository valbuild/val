import { ImageSource } from "@valbuild/core";
import { useMediaUrl } from "../utils/mediaUrl";
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
  /**
   * Three states, for the same reason {@link image} has three.
   *
   * A `string` is the subtitle; `null` means the preview declares a subtitle
   * that this value does not have, so the line is still RESERVED and the rows
   * of the list stay the same height; `undefined` means it declares no
   * subtitle at all, so there is no second line and the row is one line tall.
   *
   * Reserving is the right default because every row of one list comes from
   * one closure: if any row can have a subtitle, they all can, and a list whose
   * rows are 44px or 56px depending on whether an author filled in a field is a
   * list that moves under the cursor.
   */
  subtitle: string | null | undefined;
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
      <div className="flex flex-col flex-1 min-w-0">
        {/*
         * Fixed line heights rather than `leading-tight` plus a gap, and
         * chosen so the two lines TOGETHER are exactly the thumbnail: 20 + 20
         * against `w-10 h-10`, and 16 + 16 against `w-8 h-8` when compact. So
         * a row measures the same whether the value filled its subtitle in or
         * not, and `PREVIEW_ROW_CONTENT_HEIGHT` in `RecordFields` — the
         * virtualizer's estimate for an un-loaded row — stays true of a loaded
         * one. Change one of these three numbers and change the others.
         */}
        <div
          className={cn(
            "font-medium truncate",
            compact ? "text-sm leading-4" : "leading-5",
          )}
        >
          {title}
        </div>
        {subtitle !== undefined && (
          <div
            className={cn(
              "truncate text-fg-tertiary",
              compact ? "text-xs leading-4" : "text-sm leading-5",
            )}
            aria-hidden={subtitle === null}
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
  // `useMediaUrl`, not `Internal.mediaUrl`: a just-uploaded file is served from
  // its PATCH, and the value alone cannot say which one. Without the lookup the
  // row drew a broken image until the editor saved.
  const imageUrl = useMediaUrl(src);

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
        src={imageUrl ?? undefined}
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
