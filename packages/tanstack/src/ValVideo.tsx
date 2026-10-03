import { useEffect, useRef } from "react";
import { raw, ValEncodedString, Video } from "@valbuild/react/stega";
import { decodeValPathsOfString } from "./decodeValPathsOfString";

/**
 * What `ValVideo` needs from hls.js — written out rather than imported, so
 * this package typechecks in an app that has never installed it.
 */
type HlsLike = {
  loadSource(url: string): void;
  attachMedia(media: HTMLMediaElement): void;
  destroy(): void;
};
type HlsConstructorLike = {
  new (): HlsLike;
  isSupported(): boolean;
};

export type ValVideoProps = Omit<
  React.ComponentProps<"video">,
  "src" | "poster" | "children"
> & {
  src: Video;
  /**
   * How to play an HLS stream in a browser that cannot play one itself, which
   * is every browser but Safari (and recent Chrome). Pass a loader for hls.js:
   *
   * ```tsx
   * <ValVideo src={page.intro} hls={() => import("hls.js")} />
   * ```
   *
   * It is called only when the video IS a stream and the browser needs it, so
   * a page of plain mp4s never downloads it. Without it, such a browser shows
   * the poster and an unplayable player.
   */
  hls?: () => Promise<{ default: HlsConstructorLike }>;
  /** Ignore the video's hotspot instead of applying it as object-position. */
  disableHotspot?: boolean;
  /** Leave out the caption tracks. */
  disableCaptions?: boolean;
};

/**
 * A `<video>` for a Val video, with everything the Studio lets an editor set:
 * the poster, the caption tracks, the start and end time, and the focal point
 * as `object-position`. Like `ValImage`, the edit tag on `src.url` is moved to
 * `data-val-path`, so the video is click-to-edit and the URL the browser
 * fetches is clean.
 *
 * Start and end are applied by the player rather than by cutting the file: it
 * seeks to `startTime` when the video loads and pauses at `endTime`. For a
 * progressive file the `#t=` media fragment says the same thing to the
 * browser before any script runs.
 */
export function ValVideo(props: ValVideoProps) {
  const {
    src,
    hls,
    disableHotspot,
    disableCaptions,
    style,
    width,
    height,
    ...rest
  } = props;
  const ref = useRef<HTMLVideoElement>(null);
  const valPathsOfUrl = src?.url ? decodeValPathsOfString(src.url) : undefined;
  const url = src?.url
    ? valPathsOfUrl && valPathsOfUrl.length > 0
      ? raw(src.url)
      : src.url
    : undefined;
  const isHls =
    src?.mimeType === "application/vnd.apple.mpegurl" ||
    src?.mimeType?.toLowerCase() === "application/x-mpegurl";
  const startTime = src?.startTime;
  const endTime = src?.endTime;

  useEffect(() => {
    const video = ref.current;
    if (!video || !url) {
      return;
    }
    if (!isHls || video.canPlayType("application/vnd.apple.mpegurl") !== "") {
      video.src =
        !isHls && (startTime !== undefined || endTime !== undefined)
          ? `${url}#t=${startTime ?? 0}${endTime !== undefined ? `,${endTime}` : ""}`
          : url;
      return () => {
        video.removeAttribute("src");
        video.load();
      };
    }
    if (!hls) {
      console.warn(
        'Val: this browser cannot play HLS streams on its own. Pass `hls={() => import("hls.js")}` to ValVideo.',
      );
      return;
    }
    let destroyed = false;
    let instance: HlsLike | null = null;
    hls().then(({ default: Hls }) => {
      if (destroyed || !Hls.isSupported()) {
        return;
      }
      instance = new Hls();
      instance.loadSource(url);
      instance.attachMedia(video);
    });
    return () => {
      destroyed = true;
      instance?.destroy();
    };
  }, [url, isHls, hls, startTime, endTime]);

  useEffect(() => {
    const video = ref.current;
    if (!video || (startTime === undefined && endTime === undefined)) {
      return;
    }
    const onLoaded = () => {
      if (startTime !== undefined && video.currentTime < startTime) {
        video.currentTime = startTime;
      }
    };
    const onTimeUpdate = () => {
      if (endTime !== undefined && video.currentTime >= endTime) {
        if (video.loop) {
          video.currentTime = startTime ?? 0;
        } else {
          video.pause();
        }
      }
    };
    video.addEventListener("loadedmetadata", onLoaded);
    video.addEventListener("timeupdate", onTimeUpdate);
    return () => {
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("timeupdate", onTimeUpdate);
    };
  }, [startTime, endTime]);

  const hotspot = src?.hotspot;
  const videoStyle =
    hotspot && !disableHotspot
      ? { ...style, objectPosition: `${hotspot.x * 100}% ${hotspot.y * 100}%` }
      : style;
  // As for `ValImage`: the file's own size reserves the space, unless the
  // caller is sizing the element.
  const preferMetadataDims =
    (src?.width !== undefined || src?.height !== undefined) &&
    !width &&
    !height;
  return (
    <video
      playsInline
      preload="metadata"
      {...rest}
      ref={ref}
      poster={src?.poster?.url}
      aria-label={
        rest["aria-label"] ??
        (src?.alt ? raw(src.alt as ValEncodedString) : undefined)
      }
      data-val-path={valPathsOfUrl?.join(",")}
      data-val-attr-src={valPathsOfUrl?.join(",")}
      style={videoStyle}
      width={preferMetadataDims ? src?.width : width}
      height={preferMetadataDims ? src?.height : height}
    >
      {!disableCaptions &&
        src?.captions?.map((track) => (
          <track
            key={track.url}
            src={track.url}
            srcLang={track.srclang}
            label={
              track.label ? raw(track.label as ValEncodedString) : track.srclang
            }
            kind={track.kind ?? "subtitles"}
            default={track.default}
          />
        ))}
    </video>
  );
}
