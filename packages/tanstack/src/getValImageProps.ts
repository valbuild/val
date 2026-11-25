import type React from "react";
import { Internal } from "@valbuild/core";
import { raw, type Image, type ValEncodedString } from "@valbuild/react/stega";
import { decodeValPathsOfString } from "./decodeValPathsOfString";

/**
 * What a loader is asked for: the image's own URL (without edit tags), the
 * width the browser may pick, and the quality the caller asked for, if any.
 * The same shape as `next/image`'s `loader`.
 */
export type ValImageLoaderProps = {
  src: string;
  width: number;
  quality?: number;
};

/** Turns an image and a width into the URL of the image at that width. */
export type ValImageLoader = (props: ValImageLoaderProps) => string;

/**
 * The props of `ValImage`, and of {@link getValImageProps}. Named and behaving
 * as `next/image`'s do, so a page moved from Next keeps its props: `sizes`,
 * `quality`, `fill`, `priority`/`preload`, `placeholder`/`blurDataURL`,
 * `loader`, `unoptimized` and `overrideSrc`.
 */
export type ValImageProps = Omit<
  React.ComponentProps<"img">,
  "src" | "alt" | "srcSet" | "width" | "height" | "loading" | "placeholder"
> & {
  src: Image;
  /** Overrides the image's own `alt`. */
  alt?: string;
  /**
   * The rendered width in CSS pixels. Defaults to the image's own, unless
   * `height` alone is given, in which case it keeps the image's aspect ratio.
   */
  width?: number | `${number}`;
  /** As `width`, for the height. */
  height?: number | `${number}`;
  /**
   * Fill the parent instead of having a size of its own: the image is
   * absolutely positioned at the parent's edges, so the parent needs
   * `position: relative` (or another positioning). Without `sizes`, a filled
   * image is taken to be as wide as the viewport.
   */
  fill?: boolean;
  /**
   * How wide the image is shown at each viewport size, as the `<img sizes>`
   * attribute. With it the browser picks from every width the host serves;
   * without it, from 1x and 2x the rendered `width`.
   */
  sizes?: string;
  /** 1–100. Snapped to the qualities the host serves (25, 50, 75, 80, 90, 100). */
  quality?: number | `${number}`;
  /**
   * The largest image above the fold: loaded eagerly, at high fetch priority,
   * and preloaded from the document's `<head>`.
   */
  priority?: boolean;
  /** Preloaded from the document's `<head>` and loaded eagerly. Next.js 16's name. */
  preload?: boolean;
  /** `lazy` unless `priority` or `preload` is set. */
  loading?: "lazy" | "eager";
  /**
   * What is shown until the image has loaded:
   *
   * - `"blur"`: `blurDataURL`, blurred; without one, a remote image's smallest
   *   resized copy, scaled up.
   * - a `data:image/…` URL: that image.
   * - `"empty"` (the default): nothing.
   */
  placeholder?: "empty" | "blur" | `data:image/${string}`;
  /** A small image, as a data URL, for `placeholder="blur"`. */
  blurDataURL?: string;
  /**
   * Serve the image as it is: no `srcset`. The default for SVG. An image that
   * cannot be resized (see "Images" in the README) is served as it is anyway.
   */
  unoptimized?: boolean;
  /**
   * How a URL for each width is made. The default asks the host of a remote
   * image for it (`?w=`); a loader of your own is used for every image.
   */
  loader?: ValImageLoader;
  /** The `src` attribute to write instead of the one chosen, `srcset` kept. */
  overrideSrc?: string;
  /** Ignore the image's hotspot instead of applying it as object-position. */
  disableHotspot?: boolean;
};

/** The attributes of the `<img>`: what `getValImageProps` gives back. */
export type ValImageElementProps = Omit<
  React.ComponentProps<"img">,
  "width" | "height"
> & {
  width?: number;
  height?: number;
  "data-val-path": string;
  "data-val-attr-alt"?: string;
  "data-val-attr-src"?: string;
};

/**
 * Everything `getValImageProps` worked out that `ValImage` needs to draw a
 * placeholder and preload: the props, plus how to ask for another width.
 */
export type ValImageAttributes = {
  props: ValImageElementProps;
  /** Whether a `srcset` was written. */
  optimized: boolean;
  /** The URL of the image at `width`, or null when it cannot be resized. */
  urlAt: (width: number) => string | null;
  /** Whether the caller asked for the image to be preloaded. */
  preload: boolean;
};

/**
 * The `<img>` attributes `ValImage` renders, for building a `<picture>` or
 * anything else that needs them: the counterpart of `next/image`'s
 * `getImageProps`. `placeholder` is ignored here, because nothing would take
 * it away once the image has loaded.
 *
 * ```tsx
 * const { props: desktop } = getValImageProps({ src: page.wide, sizes: "100vw" });
 * const { props: mobile } = getValImageProps({ src: page.tall, sizes: "100vw" });
 * <picture>
 *   <source media="(min-width: 1000px)" srcSet={desktop.srcSet} sizes={desktop.sizes} />
 *   <img {...mobile} />
 * </picture>
 * ```
 */
export function getValImageProps(props: ValImageProps): {
  props: ValImageElementProps;
} {
  return { props: valImageAttributes(props).props };
}

/** {@link getValImageProps}, with what `ValImage` needs besides. */
export function valImageAttributes(props: ValImageProps): ValImageAttributes {
  const {
    src,
    alt,
    style,
    width: widthProp,
    height: heightProp,
    fill,
    sizes: sizesProp,
    quality: qualityProp,
    priority,
    preload,
    loading,
    fetchPriority,
    decoding,
    unoptimized: unoptimizedProp,
    loader,
    overrideSrc,
    disableHotspot,
    // Not attributes of an `<img>`: `ValImage` draws these.
    placeholder: _placeholder,
    blurDataURL: _blurDataURL,
    ...rest
  } = props;

  // Edit tags: the URL is stega-encoded, so it cannot go in an attribute as
  // it is -- the invisible characters would be sent to the server. `raw()`
  // strips them, and the paths they carried are re-attached as
  // `data-val-path` / `data-val-attr-*`, which makes the image click-to-edit.
  const valPathsOfUrl = src?.url ? decodeValPathsOfString(src.url) : undefined;
  const valPathsOfAlt = alt
    ? decodeValPathsOfString(alt as ValEncodedString)
    : undefined;
  const valPaths = [...(valPathsOfUrl ?? []), ...(valPathsOfAlt ?? [])];
  const url =
    valPathsOfUrl && valPathsOfUrl.length > 0 ? raw(src.url) : src?.url;

  const quality = toInt(qualityProp);
  const unoptimized = unoptimizedProp ?? src?.mimeType === "image/svg+xml";
  const urlAt = (width: number): string | null => {
    if (unoptimized || !url) return null;
    if (loader) return loader({ src: url, width, quality });
    return Internal.media.resizedImageUrl(url, { width, quality });
  };

  const { width, height } = fill
    ? { width: undefined, height: undefined }
    : renderedSize(toInt(widthProp), toInt(heightProp), src);

  let srcSet: string | undefined;
  let sizes: string | undefined;
  let chosenSrc = url;
  const ladder = widthsFor(width, sizesProp, src?.width);
  const urls = ladder.widths.map((w) => urlAt(w));
  const optimized = urls.length > 0 && urls.every((u) => u !== null);
  if (optimized) {
    srcSet = urls
      .map(
        (u, i) =>
          `${u} ${ladder.kind === "w" ? `${ladder.widths[i]}w` : `${i + 1}x`}`,
      )
      .join(", ");
    sizes = sizesProp ?? (ladder.kind === "w" ? "100vw" : undefined);
    chosenSrc = urls[urls.length - 1] ?? url;
  }

  const hotspot = src?.hotspot;
  const imageStyle: React.CSSProperties = {
    ...(fill ? FILL_STYLE : {}),
    ...(hotspot && !disableHotspot
      ? { objectPosition: `${hotspot.x * 100}% ${hotspot.y * 100}%` }
      : {}),
    ...style,
  };

  const shouldPreload = Boolean(priority || preload);
  return {
    props: {
      ...rest,
      src: overrideSrc ?? chosenSrc,
      srcSet,
      sizes,
      width,
      height,
      loading: shouldPreload ? "eager" : (loading ?? "lazy"),
      fetchPriority: priority ? "high" : fetchPriority,
      decoding: decoding ?? "async",
      style: Object.keys(imageStyle).length > 0 ? imageStyle : undefined,
      alt: alt
        ? raw(alt as ValEncodedString)
        : src?.alt
          ? raw(src.alt as ValEncodedString)
          : "",
      "data-val-path": valPaths.join(","),
      "data-val-attr-alt": valPathsOfAlt?.join(","),
      "data-val-attr-src":
        valPathsOfUrl && valPathsOfUrl.length > 0
          ? valPathsOfUrl.join(",")
          : undefined,
    },
    optimized,
    urlAt,
    preload: shouldPreload,
  };
}

/** As `next/image` positions a filled image. The caller's `style` wins. */
const FILL_STYLE: React.CSSProperties = {
  position: "absolute",
  height: "100%",
  width: "100%",
  left: 0,
  top: 0,
  right: 0,
  bottom: 0,
};

/**
 * The `width`/`height` attributes: what the caller gave, else the image's own,
 * so the browser can reserve the space before the bytes arrive. One given
 * alone gets the other from the image's aspect ratio.
 */
function renderedSize(
  width: number | undefined,
  height: number | undefined,
  src: Image | undefined,
): { width?: number; height?: number } {
  const own = { width: src?.width, height: src?.height };
  if (width === undefined && height === undefined) return own;
  if (width !== undefined && height !== undefined) return { width, height };
  if (!own.width || !own.height) return { width, height };
  if (width !== undefined) {
    return { width, height: Math.round((width * own.height) / own.width) };
  }
  if (height !== undefined) {
    return { width: Math.round((height * own.width) / own.height), height };
  }
  return own;
}

/**
 * Which widths go in the `srcset`, and whether they are described by width
 * (`640w`, for a `sizes`) or by density (`2x`, for a fixed `width`) --
 * `next/image`'s rule, over the widths the host serves:
 *
 * - With `sizes`, every width, except those too small for the narrowest
 *   `vw` it names on the narrowest screen.
 * - Without `sizes` and without a width, the screen widths.
 * - With a width, that width and twice it.
 *
 * Widths past the image's own are left out, bar the first: a host never
 * scales up, so each of them would be one more copy of the same pixels.
 */
function widthsFor(
  width: number | undefined,
  sizes: string | undefined,
  intrinsicWidth: number | undefined,
): { widths: number[]; kind: "w" | "x" } {
  const { RESIZE_WIDTHS, RESIZE_DEVICE_WIDTH, resizeWidth } = Internal.media;
  let widths: number[];
  let kind: "w" | "x" = "w";
  if (sizes) {
    const viewportWidths = [...sizes.matchAll(/(^|\s)(1?\d?\d)vw/g)].map(
      (match) => parseInt(match[2], 10),
    );
    if (viewportWidths.length > 0) {
      const smallest = RESIZE_DEVICE_WIDTH * Math.min(...viewportWidths) * 0.01;
      widths = RESIZE_WIDTHS.filter((w) => w >= smallest);
    } else {
      widths = [...RESIZE_WIDTHS];
    }
  } else if (width === undefined) {
    widths = RESIZE_WIDTHS.filter((w) => w >= RESIZE_DEVICE_WIDTH);
  } else {
    kind = "x";
    widths = [...new Set([width, width * 2].map(resizeWidth))];
  }
  if (intrinsicWidth) {
    const capped: number[] = [];
    for (const w of widths) {
      capped.push(w);
      if (w >= intrinsicWidth) break;
    }
    widths = capped;
  }
  return { widths, kind };
}

function toInt(value: number | string | undefined): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return parseInt(value, 10);
  }
  return undefined;
}
