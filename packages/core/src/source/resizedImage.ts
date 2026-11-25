import { splitRemoteRef } from "../remote/splitRemoteRef";

/*
 * RESIZED REMOTE IMAGES: `?w=<width>&q=<quality>` on a remote ref.
 *
 * Both hosts a remote ref can name answer it: the platform loader for
 * `https://<site>/_val/file/…` (valbuild/home `platform/packages/loader/src/valFile.ts`,
 * through Cloudflare Images) and the content service for
 * `https://remote.val.build/file/…` (valbuild/home `content/src/remoteFileRoutes.ts`,
 * through sharp). Each answers with the image scaled DOWN to the width -- never
 * up -- in the best format the browser's `Accept` names (AVIF, then WebP, else
 * the original's), and keeps the copy, so it is made once.
 *
 * The two ladders below are the contract with those hosts and must stay equal
 * to theirs. A width that is not on the ladder is served at the next one up,
 * which is still right but is a second URL for the same bytes: the readers here
 * only ever ask for widths on it.
 */

/**
 * The widths a remote image is served at, in device pixels. Next.js's
 * `imageSizes` and `deviceSizes` in one list.
 */
export const RESIZE_WIDTHS: readonly number[] = [
  64, 128, 256, 384, 640, 750, 828, 1080, 1200, 1600, 1920, 2560, 3840,
];

/** The smallest of {@link RESIZE_WIDTHS} that are screen widths. */
export const RESIZE_DEVICE_WIDTH = 640;

/**
 * The qualities a remote image is encoded at. Any other is served at the
 * nearest one. Leaving `q` out is {@link RESIZE_DEFAULT_QUALITY}.
 */
export const RESIZE_QUALITIES: readonly number[] = [25, 50, 75, 80, 90, 100];

/** The quality a resized image is encoded at when `q` is not given. */
export const RESIZE_DEFAULT_QUALITY = 80;

/** The formats a host resizes. SVG is any size, a GIF may be animated. */
const RESIZABLE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "avif"]);

/** The width on the ladder an image asked for at `width` is served at. */
export function resizeWidth(width: number): number {
  return (
    RESIZE_WIDTHS.find((rung) => rung >= width) ??
    RESIZE_WIDTHS[RESIZE_WIDTHS.length - 1]
  );
}

/** The quality on the ladder nearest to `quality`. */
export function resizeQuality(quality: number): number {
  let nearest = RESIZE_QUALITIES[0];
  for (const rung of RESIZE_QUALITIES) {
    if (Math.abs(rung - quality) < Math.abs(nearest - quality)) {
      nearest = rung;
    }
  }
  return nearest;
}

/**
 * Whether the bytes at `url` can be asked for at another width: a PUBLISHED
 * remote ref to a JPEG, PNG, WebP or AVIF.
 *
 * `url` is what `mediaUrl` gave, without edit tags. A draft is served from
 * `/api/val/files/…`, which is not a ref, so it is never resized: its bytes are
 * in the patch store, not at either host.
 */
export function isResizableImageUrl(url: string): boolean {
  const ref = splitRemoteRef(url);
  if (ref.status !== "success") {
    return false;
  }
  const dot = ref.filePath.lastIndexOf(".");
  if (dot === -1) {
    return false;
  }
  return RESIZABLE_EXTENSIONS.has(ref.filePath.slice(dot + 1).toLowerCase());
}

/**
 * The URL of the image at `url` resized to `width`, or null when it cannot be
 * resized ({@link isResizableImageUrl}). `width` and `quality` are snapped to
 * the ladders, so two readers asking for nearly the same thing share one URL,
 * one copy and one cache entry.
 */
export function resizedImageUrl(
  url: string,
  options: { width: number; quality?: number },
): string | null {
  if (!isResizableImageUrl(url)) {
    return null;
  }
  const params = [`w=${resizeWidth(options.width)}`];
  if (options.quality !== undefined) {
    const quality = resizeQuality(options.quality);
    if (quality !== RESIZE_DEFAULT_QUALITY) {
      params.push(`q=${quality}`);
    }
  }
  return `${url}?${params.join("&")}`;
}
