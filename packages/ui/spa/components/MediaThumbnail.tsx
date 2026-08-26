import { ReactNode } from "react";
import { cn } from "./designSystem/cn";
import { HotspotMarker } from "./fields/HotspotMarker";

/**
 * A file preview that never claims to be bigger than the file is.
 *
 * The tiles used to be `h-full w-full object-cover`, which fills the box
 * whatever is in it — so an 8×8 favicon was drawn at 120×72 as a blurry smear,
 * and looked identical to a large image that had merely been cropped. At a
 * glance the two are the same picture; the difference is exactly the thing
 * someone browsing a media collection is trying to find out.
 *
 * So: the image lays out at its intrinsic size, capped by the box. `max-w-full`
 * and `max-h-full` with no width or height is what does it — an image smaller
 * than the box sits at its own size, centred, and a larger one is scaled down
 * whole rather than cropped.
 *
 * The hotspot goes over the image and not over the box. The marker is
 * positioned in percentages, so it is only in the right place if its container
 * is the image — which is why the inner element shrink-wraps rather than
 * stretching. Showing the focal point beats silently applying it at this size:
 * a crop of a thumbnail is not a preview of anything.
 */
export function MediaThumbnail({
  url,
  alt = "",
  hotspot,
  className,
  imageClassName,
  onError,
  loading,
}: {
  url: string;
  alt?: string;
  /** Drawn as a marker over the image, when there is one. */
  hotspot?: { x: number; y: number };
  /** For the box: its size, its background, its corners. */
  className?: string;
  /** For the image itself, e.g. `image-render-pixel` for tiny sprites. */
  imageClassName?: string;
  onError?: () => void;
  loading?: "lazy" | "eager";
}): ReactNode {
  return (
    <span
      className={cn(
        "grid h-full w-full place-items-center overflow-hidden",
        className,
      )}
    >
      <span className="relative inline-flex max-h-full max-w-full">
        <img
          src={url}
          alt={alt}
          draggable={false}
          loading={loading}
          decoding="async"
          onError={onError}
          className={cn("max-h-full max-w-full object-contain", imageClassName)}
        />
        {hotspot && <HotspotMarker hotspot={hotspot} />}
      </span>
    </span>
  );
}
