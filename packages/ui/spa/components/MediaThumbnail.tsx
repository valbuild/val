import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { cn } from "./designSystem/cn";

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
 * The tile is filled — `object-cover` — and the crop is centred on the image's
 * focal point, so the thumbnail frames the picture the way the page will. It
 * used to shrink the whole image into the box and draw the focal point on top
 * instead, and that went wrong twice: `max-h-full` inside a shrink-wrapping
 * span resolves against an `auto` height, so a portrait image was not scaled
 * at all and showed as its top strip; and a letterboxed 120×72 tile of a
 * landscape photo is a line with a dot on it, which says nothing about what
 * the crop keeps.
 *
 * What survives of the old rule is the part that was right: an image SMALLER
 * than the tile is not enlarged to fill it. An 8×8 favicon drawn at 120×72 is
 * a blurry smear that looks identical to a large photo that merely got cropped,
 * and telling those apart is exactly what someone browsing media is doing. So
 * once the image has loaded and it turns out covering would scale it UP, it
 * is drawn at its own size (or scaled down to fit), centred. That needs the
 * natural size, which only `onLoad` knows; the first frame of a tiny image is
 * the one frame that may be enlarged.
 *
 * And it is asked again whenever the TILE changes size, not only on load: the
 * image card is as wide as its panel, so a portrait that loaded in a wide card
 * stayed letterboxed after the panel narrowed, and a small image loaded in a
 * narrow one was enlarged once it widened. A `ResizeObserver` on the tile
 * re-asks with the natural size kept from the load.
 */
export function MediaThumbnail({
  url,
  alt = "",
  hotspot,
  className,
  imageClassName,
  onError,
  loading,
  checkerboard,
}: {
  url: string;
  alt?: string;
  /** Where the crop is centred. The middle of the image when there is none. */
  hotspot?: { x: number; y: number };
  /** For the box: its size, its background, its corners. */
  className?: string;
  /** For the image itself, e.g. `image-render-pixel` for tiny sprites. */
  imageClassName?: string;
  /**
   * Draw a checkerboard behind the picture, for a format that can be
   * transparent. See `mayBeTransparent`.
   */
  checkerboard?: boolean;
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
  /** Whether covering the tile would enlarge the image. See above. */
  const [smallerThanBox, setSmallerThanBox] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  /** The loaded picture's own size, kept so a resize can re-ask. */
  const natural = useRef<{ width: number; height: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const measure = useCallback(() => {
    const tile = box.current;
    const size = natural.current;
    if (!tile || !size) return;
    setSmallerThanBox(
      Math.max(tile.clientWidth / size.width, tile.clientHeight / size.height) >
        1,
    );
  }, []);
  // A new file starts over: the attempt count belongs to the URL, not the tile.
  useEffect(() => {
    setAttempt(0);
    setSmallerThanBox(false);
    natural.current = null;
  }, [url]);
  useEffect(() => {
    const tile = box.current;
    // Absent under jsdom; the load-time answer is all there is there.
    if (!tile || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(tile);
    return () => observer.disconnect();
  }, [measure]);
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
      ref={box}
      className={cn("relative block h-full w-full overflow-hidden", className)}
    >
      <img
        src={src}
        alt={alt}
        draggable={false}
        loading={loading}
        decoding="async"
        onError={handleError}
        onLoad={(ev) => {
          const { naturalWidth, naturalHeight } = ev.currentTarget;
          if (naturalWidth === 0 || naturalHeight === 0) return;
          natural.current = { width: naturalWidth, height: naturalHeight };
          measure();
        }}
        className={cn(
          // Absolute, so the box is the tile whatever the tile is: a
          // percentage height on a grid or flex child can resolve against an
          // `auto` track, and the image then lays out at its own aspect ratio.
          //
          // Scaled down, the element shrinks to the picture and is centred by
          // `inset-0 m-auto` rather than by `object-position`: the element's
          // box is then the picture's box, which is what a checkerboard has
          // to be drawn on.
          "absolute inset-0",
          smallerThanBox
            ? "m-auto h-auto max-h-full w-auto max-w-full"
            : "h-full w-full object-cover",
          checkerboard && "val-checkerboard",
          imageClassName,
        )}
        style={
          hotspot && !smallerThanBox
            ? { objectPosition: `${hotspot.x * 100}% ${hotspot.y * 100}%` }
            : undefined
        }
      />
    </span>
  );
}

/**
 * Whether an image of this type can have transparent pixels, and so needs a
 * checkerboard behind it to show where its edges are.
 *
 * By type rather than by looking at the pixels: a JPEG never can, and reading
 * back every thumbnail through a canvas to find out whether a PNG actually
 * does is a lot of work for a background.
 */
export function mayBeTransparent(mimeType: string | undefined): boolean {
  return (
    mimeType === "image/png" ||
    mimeType === "image/webp" ||
    mimeType === "image/gif" ||
    mimeType === "image/avif" ||
    mimeType === "image/svg+xml"
  );
}

/**
 * The focal point in a gallery entry's metadata, when it has a usable one.
 *
 * A gallery entry is untyped metadata on the way to the picker (`Record<string,
 * unknown>`), so the shape is checked rather than assumed: a hotspot with a
 * string in it would otherwise reach `objectPosition` as `NaN%`.
 */
export function hotspotOf(
  metadata: Record<string, unknown> | undefined,
): { x: number; y: number } | undefined {
  const hotspot = metadata?.hotspot;
  if (typeof hotspot !== "object" || hotspot === null) return undefined;
  if (!("x" in hotspot) || !("y" in hotspot)) return undefined;
  const { x, y } = hotspot;
  return typeof x === "number" && typeof y === "number" ? { x, y } : undefined;
}
