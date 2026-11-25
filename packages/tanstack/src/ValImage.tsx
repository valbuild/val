import React, { useCallback, useState } from "react";
import { preload as preloadResource } from "react-dom";
import { Internal } from "@valbuild/core";
import { valImageAttributes, type ValImageProps } from "./getValImageProps";

export {
  getValImageProps,
  type ValImageProps,
  type ValImageLoader,
  type ValImageLoaderProps,
  type ValImageElementProps,
} from "./getValImageProps";

/**
 * An `<img>` for a Val image, with the edit tags kept where the Studio can see
 * them, and the props of `next/image`.
 *
 * TanStack Start has no image component, so this carries what `next/image`
 * would have supplied: the intrinsic `width`/`height` from the source (so the
 * browser can reserve the space), `hotspot` as `object-position`, lazy
 * loading, `fill`, `priority`, `placeholder` -- and a `srcset`. A published
 * remote image (`s.image().remote()`) is resized by the host that serves it,
 * Val's platform on Cloudflare or `remote.val.build`, so the browser downloads
 * the width it shows rather than the upload. See "Images" in the README.
 *
 * What it exists for besides is the tags. `src.url` is stega-encoded, so it
 * cannot be put in an `src` attribute as-is: the invisible characters would be
 * sent to the server. `raw()` strips them and the paths they carried are
 * re-attached as `data-val-path` / `data-val-attr-*`, which is what makes the
 * image click-to-edit.
 */
export function ValImage(props: ValImageProps) {
  const { ref, onLoad, placeholder, blurDataURL } = props;
  const attributes = valImageAttributes(props);
  const img = attributes.props;
  const shownSrc = img.src;

  if (attributes.preload && typeof shownSrc === "string") {
    // React hoists this into the document's <head>, on the server as well,
    // and dedupes it by `imageSrcSet` when there is one.
    preloadResource(shownSrc, {
      as: "image",
      imageSrcSet: img.srcSet,
      imageSizes: img.sizes,
      fetchPriority: img.fetchPriority,
      crossOrigin: img.crossOrigin,
      referrerPolicy: img.referrerPolicy,
    });
  }

  const placeholderUrl =
    placeholder === "blur"
      ? (blurDataURL ??
        attributes.urlAt(Internal.media.RESIZE_WIDTHS[0]) ??
        undefined)
      : placeholder?.startsWith("data:image/")
        ? placeholder
        : undefined;

  // The placeholder is taken away once THIS src has loaded: a new image
  // shows its own placeholder until it is there.
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const showPlaceholder =
    placeholderUrl !== undefined && loadedSrc !== shownSrc;
  const ownRef = useCallback(
    (element: HTMLImageElement | null) => {
      // Loaded before React hydrated it, so `onLoad` will never come.
      if (
        element &&
        element.complete &&
        element.naturalWidth > 0 &&
        typeof shownSrc === "string"
      ) {
        setLoadedSrc(shownSrc);
      }
      if (typeof ref === "function") {
        return ref(element);
      }
      if (ref) {
        ref.current = element;
        return () => {
          ref.current = null;
        };
      }
    },
    [ref, shownSrc],
  );

  return (
    <img
      {...img}
      ref={placeholderUrl !== undefined ? ownRef : ref}
      onLoad={(event) => {
        if (typeof shownSrc === "string") setLoadedSrc(shownSrc);
        onLoad?.(event);
      }}
      style={
        showPlaceholder
          ? {
              ...placeholderStyle(placeholderUrl, placeholder === "blur", img),
              ...img.style,
            }
          : img.style
      }
    />
  );
}

/**
 * The placeholder as a background of the `<img>` itself, as `next/image` draws
 * it, sized and placed as the image will be. With `placeholder="blur"` a data
 * URL is blurred by an SVG filter; a remote image's smallest copy cannot be
 * (an SVG used as an image loads nothing from the network), and is shown
 * scaled up instead. A data URL given AS the placeholder is shown as it is.
 */
function placeholderStyle(
  placeholderUrl: string,
  blur: boolean,
  img: { width?: number; height?: number; style?: React.CSSProperties },
): React.CSSProperties {
  const objectFit = img.style?.objectFit;
  const image =
    blur && placeholderUrl.startsWith("data:")
      ? `url("data:image/svg+xml;charset=utf-8,${blurSvg(placeholderUrl, img.width, img.height, objectFit)}")`
      : `url("${placeholderUrl.replace(/"/g, "%22")}")`;
  return {
    backgroundImage: image,
    backgroundSize:
      objectFit === "contain"
        ? "contain"
        : objectFit === "fill"
          ? "100% 100%"
          : "cover",
    backgroundPosition: img.style?.objectPosition ?? "50% 50%",
    backgroundRepeat: "no-repeat",
  };
}

/**
 * `next/image`'s blur: the image, blurred, with its edges kept opaque.
 *
 * The result is itself the body of a percent-encoded data URL, which the
 * browser decodes once before parsing it as XML. So the nested URL is
 * XML-escaped and then percent-encoded: an SVG `blurDataURL` is
 * percent-encoded too, and decoded unescaped its `<` would end the attribute.
 */
function blurSvg(
  dataUrl: string,
  width: number | undefined,
  height: number | undefined,
  objectFit: React.CSSProperties["objectFit"],
): string {
  const std = 20;
  const viewBox = width && height ? `viewBox='0 0 ${width} ${height}'` : "";
  const preserveAspectRatio = viewBox
    ? "none"
    : objectFit === "contain"
      ? "xMidYMid"
      : objectFit === "cover"
        ? "xMidYMid slice"
        : "none";
  return `%3Csvg xmlns='http://www.w3.org/2000/svg' ${viewBox}%3E%3Cfilter id='b' color-interpolation-filters='sRGB'%3E%3CfeGaussianBlur stdDeviation='${std}'/%3E%3CfeColorMatrix values='1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 100 -1' result='s'/%3E%3CfeFlood x='0' y='0' width='100%25' height='100%25'/%3E%3CfeComposite operator='out' in='s'/%3E%3CfeComposite in2='SourceGraphic'/%3E%3CfeGaussianBlur stdDeviation='${std}'/%3E%3C/filter%3E%3Cimage width='100%25' height='100%25' x='0' y='0' preserveAspectRatio='${preserveAspectRatio}' style='filter: url(%23b);' href='${encodeURIComponent(escapeXml(dataUrl))}'/%3E%3C/svg%3E`;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
