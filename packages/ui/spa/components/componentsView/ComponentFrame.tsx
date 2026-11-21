import { VAL_PREVIEW_MESSAGES, type SourcePath } from "@valbuild/core";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { cn } from "../designSystem/cn";
import { componentPreviewUrl } from "../../utils/componentReview";

/**
 * How long a frame is given to say it is there before the view says the
 * site has no preview route. The first load of a dev server compiles the
 * route, so it is generous.
 */
const NO_ANSWER_MS = 20_000;

/**
 * How long after the last edit the preview is told to read its content
 * again. The route reads what the server has, which an edit reaches once it
 * is saved - and a refresh per keystroke would only flicker.
 */
const REFRESH_DEBOUNCE_MS = 800;

/** How tall a frame is taken to be until it says. */
const UNMEASURED_HEIGHT_PX = 200;

export type ComponentFrameStatus = "loading" | "ready" | "no-answer";

/**
 * EXPERIMENTAL: one component, rendered by the site itself on its preview
 * route (`/val-preview?p=<path>`) in a frame, laid out at `width` and scaled
 * down to the room there is.
 *
 * What it talks to is `ValPreviewBridge` in the route (`VAL_PREVIEW_MESSAGES`):
 * it says how tall the component is, and which field a click on content came
 * from; it is told when the content changed, and whether a click picks.
 *
 * Through `/api/val/enable`, the way the canvas turns draft mode on: without
 * it the route renders the PUBLISHED content, without the edit being made and
 * without the tags that make a click lead to a field.
 */
export function ComponentFrame({
  path,
  example = false,
  width,
  maxHeight,
  picking = false,
  onPick,
  contentVersion,
  reloadKey = 0,
  lazy = false,
  title,
  onStatus,
  className,
}: {
  path: SourcePath;
  /** Render the component's `example` rather than the content at `path`. */
  example?: boolean;
  /** The width the component is laid out at: a screen's. */
  width: number;
  /** Cut the frame off below this height, scaled: for a thumbnail. */
  maxHeight?: number;
  /** Whether a click on content picks its field rather than doing what it does on the site. */
  picking?: boolean;
  onPick?: (paths: SourcePath[]) => void;
  /**
   * Anything that changes when the content shown does - the module's source,
   * by reference. A change tells the route to read it again.
   */
  contentVersion?: unknown;
  /** Bumped to throw the frame away and load it again: after the component's CODE changed. */
  reloadKey?: number;
  /** Load only once scrolled into view: for a board of many. */
  lazy?: boolean;
  title: string;
  onStatus?: (status: ComponentFrameStatus) => void;
  className?: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState<number | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  const [status, setStatus] = useState<ComponentFrameStatus>("loading");
  const src = enableUrlOf(componentPreviewUrl(path, example));

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const measure = () => setRoom(element.getBoundingClientRect().width);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, []);

  // A new document starts over: no height, and a new wait for an answer
  useEffect(() => {
    setHeight(null);
    setStatus("loading");
    const timer = window.setTimeout(() => {
      setStatus((current) => (current === "loading" ? "no-answer" : current));
    }, NO_ANSWER_MS);
    return () => window.clearTimeout(timer);
  }, [src, reloadKey]);

  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;
  useEffect(() => {
    onStatusRef.current?.(status);
  }, [status]);

  const post = useCallback((message: object) => {
    iframeRef.current?.contentWindow?.postMessage(
      message,
      window.location.origin,
    );
  }, []);

  const pickingRef = useRef(picking);
  pickingRef.current = picking;
  useEffect(() => {
    post({ type: VAL_PREVIEW_MESSAGES.picking, enabled: picking });
  }, [picking, post]);

  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (event.origin !== window.location.origin) return;
      const data: unknown = event.data;
      if (typeof data !== "object" || data === null || !("type" in data)) {
        return;
      }
      if (data.type === VAL_PREVIEW_MESSAGES.ready) {
        setStatus("ready");
        post({
          type: VAL_PREVIEW_MESSAGES.picking,
          enabled: pickingRef.current,
        });
      } else if (
        data.type === VAL_PREVIEW_MESSAGES.size &&
        "height" in data &&
        typeof data.height === "number"
      ) {
        setStatus("ready");
        setHeight(data.height);
      } else if (
        data.type === VAL_PREVIEW_MESSAGES.pick &&
        "paths" in data &&
        Array.isArray(data.paths)
      ) {
        onPickRef.current?.(
          data.paths.filter(
            (picked): picked is SourcePath => typeof picked === "string",
          ),
        );
      }
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [post]);

  // The content changed: read it again, once the edits have settled
  const firstVersion = useRef(true);
  useEffect(() => {
    if (firstVersion.current) {
      firstVersion.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      post({ type: VAL_PREVIEW_MESSAGES.refresh });
    }, REFRESH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [contentVersion, post]);

  const scale = room === null ? 1 : Math.min(1, room / width);
  const naturalHeight = height ?? UNMEASURED_HEIGHT_PX;
  const shownHeight =
    maxHeight === undefined
      ? naturalHeight * scale
      : Math.min(naturalHeight * scale, maxHeight);

  return (
    <div
      ref={containerRef}
      className={cn("relative w-full overflow-hidden", className)}
      style={{ height: shownHeight }}
    >
      {room !== null && (
        <iframe
          key={reloadKey}
          ref={iframeRef}
          src={src}
          title={title}
          loading={lazy ? "lazy" : "eager"}
          referrerPolicy="same-origin"
          className="absolute top-0 left-0 border-0 bg-white origin-top-left"
          style={{
            width,
            height: naturalHeight,
            transform: scale === 1 ? undefined : `scale(${scale})`,
            // A thumbnail is looked at, not used
            pointerEvents: onPick === undefined ? "none" : undefined,
          }}
        />
      )}
      {status === "loading" && height === null && (
        <div className="absolute inset-0 animate-pulse bg-bg-secondary" />
      )}
    </div>
  );
}

/** The preview, through `/api/val/enable`: sets the draft cookie, then lands on it. */
function enableUrlOf(previewUrl: string): string {
  const redirectTo = new URL(previewUrl, window.location.origin).toString();
  return `/api/val/enable?redirect_to=${encodeURIComponent(redirectTo)}`;
}
