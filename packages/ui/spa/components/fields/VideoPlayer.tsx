import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

export type PlayerTrack = {
  url: string;
  srclang: string;
  label?: string;
  kind?: "subtitles" | "captions";
  default?: boolean;
};

/**
 * The Studio's player: a `<video>` that also plays HLS where the browser does
 * not.
 *
 * Safari (and recent Chrome) play an `.m3u8` natively; everything else needs
 * Media Source Extensions driven by hls.js, which is loaded only when a stream
 * is shown in such a browser — never for a plain mp4, and never at Studio
 * startup.
 *
 * `startTime` / `endTime` are shown as they will play: the player starts at
 * the start and pauses at the end, so what an editor sees is what a page that
 * honours them shows.
 */
export const VideoPlayer = forwardRef<
  HTMLVideoElement,
  {
    src: string;
    isHls: boolean;
    poster?: string;
    tracks?: PlayerTrack[];
    startTime?: number;
    endTime?: number;
    className?: string;
    onError?: (message: string) => void;
    /**
     * A preview rather than a player: no controls, no sound, playing on its
     * own and round again — what a gallery tile shows while it is hovered.
     */
    preview?: boolean;
  }
>(function VideoPlayer(
  {
    src,
    isHls,
    poster,
    tracks,
    startTime,
    endTime,
    className,
    onError,
    preview = false,
  },
  forwardedRef,
) {
  const ref = useRef<HTMLVideoElement>(null);
  useImperativeHandle<HTMLVideoElement | null, HTMLVideoElement | null>(
    forwardedRef,
    () => ref.current,
  );

  useEffect(() => {
    const video = ref.current;
    if (!video) {
      return;
    }
    if (!isHls || video.canPlayType("application/vnd.apple.mpegurl") !== "") {
      video.src = src;
      return () => {
        video.removeAttribute("src");
        video.load();
      };
    }
    let destroyed = false;
    let destroy: (() => void) | null = null;
    import("hls.js")
      .then(({ default: Hls }) => {
        if (destroyed) {
          return;
        }
        if (!Hls.isSupported()) {
          onError?.("This browser cannot play HLS streams.");
          return;
        }
        const hls = new Hls();
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            onError?.(`Could not play the stream: ${data.details}`);
          }
        });
        hls.loadSource(src);
        hls.attachMedia(video);
        destroy = () => hls.destroy();
      })
      .catch((err: unknown) => {
        onError?.(
          `Could not load the stream player: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    return () => {
      destroyed = true;
      destroy?.();
    };
  }, [src, isHls]);

  useEffect(() => {
    const video = ref.current;
    if (!video) {
      return;
    }
    const onLoaded = () => {
      if (startTime !== undefined && video.currentTime < startTime) {
        video.currentTime = startTime;
      }
    };
    const onTimeUpdate = () => {
      if (endTime !== undefined && video.currentTime >= endTime) {
        video.pause();
      }
    };
    const onPlay = () => {
      if (endTime !== undefined && video.currentTime >= endTime) {
        video.currentTime = startTime ?? 0;
      }
    };
    video.addEventListener("loadedmetadata", onLoaded);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("play", onPlay);
    return () => {
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("play", onPlay);
    };
  }, [startTime, endTime]);

  return (
    <video
      ref={ref}
      className={className}
      controls={!preview}
      muted={preview}
      autoPlay={preview}
      loop={preview}
      playsInline
      preload="metadata"
      // A remote file is on another origin: without CORS, the frame the
      // editor picks as the poster could not be read back off a canvas.
      crossOrigin="anonymous"
      poster={poster}
    >
      {tracks?.map((track) => (
        <track
          key={track.url}
          src={track.url}
          srcLang={track.srclang}
          label={track.label ?? track.srclang}
          kind={track.kind ?? "subtitles"}
          default={track.default}
        />
      ))}
    </video>
  );
});
