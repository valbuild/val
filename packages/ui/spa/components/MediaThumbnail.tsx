import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { cn } from "./designSystem/cn";
import { HotspotMarker } from "./fields/HotspotMarker";

/**
 * How many times a failed thumbnail is re-requested, and how long apart.
 *
 * A just-uploaded file is served from its patch, and there is a window in which
 * the URL is already on screen and the server does not answer it yet — a `404`
 * for the very path that works a moment later. A browser does not retry a failed
 * image and will not re-request one whose `src` has not changed, so without this
 * the tile stays blank for as long as the view is open: the upload succeeded, the
 * bytes are on the server, and the editor sees a broken picture.
 *
 * Backs off, and gives up. Three tries over about a second and a half covers the
 * window without turning a genuinely missing file into a request loop.
 */
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 400;

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
  /**
   * Called when the image could not be loaded — after the retries, not before.
   *
   * A caller uses this to replace the tile with a placeholder, which is the
   * wrong thing to do for a file that is merely a few hundred milliseconds
   * early.
   */
  onError?: () => void;
  loading?: "lazy" | "eager";
}): ReactNode {
  const [attempt, setAttempt] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A new file starts over: the attempt count belongs to the URL, not the tile.
  useEffect(() => {
    setAttempt(0);
  }, [url]);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  const handleError = useCallback(() => {
    if (attempt >= MAX_RETRIES) {
      onError?.();
      return;
    }
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(
      () => setAttempt((current) => current + 1),
      RETRY_DELAY_MS * 2 ** attempt,
    );
  }, [attempt, onError]);
  /*
   * The retry has to change the URL.
   *
   * A browser that has failed a request for a `src` will not issue another one
   * for the same string, so re-rendering the same URL is not a retry at all.
   * Both URLs this receives ignore an unknown query parameter: the file endpoint
   * reads `patch_id`, and a published file is a static path.
   */
  const src =
    attempt === 0
      ? url
      : `${url}${url.includes("?") ? "&" : "?"}val_retry=${attempt}`;
  return (
    <span
      className={cn(
        "grid h-full w-full place-items-center overflow-hidden",
        className,
      )}
    >
      <span className="relative inline-flex max-h-full max-w-full">
        <img
          src={src}
          alt={alt}
          draggable={false}
          loading={loading}
          decoding="async"
          onError={handleError}
          className={cn("max-h-full max-w-full object-contain", imageClassName)}
        />
        {hotspot && <HotspotMarker hotspot={hotspot} />}
      </span>
    </span>
  );
}
