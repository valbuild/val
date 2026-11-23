import { VAL_PREVIEW_MESSAGES, type SourcePath } from "@valbuild/core";
import {
  DEFAULT_CANVAS_SELECTION,
  isValCanvasPageMessage,
  VAL_CANVAS_MESSAGE,
  type ValCanvasStudioMessage,
} from "@valbuild/shared/internal";
import type {
  CanvasInlineEdit,
  CanvasInlineEditRequest,
} from "../shell/canvas/useCanvasInlineEdit";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { cn } from "../designSystem/cn";
import { componentPreviewUrl } from "../../utils/componentReview";
import { withQuickPreview } from "../shell/canvas/canvasSwap";
import { enableUrlOf } from "../shell/canvas/CanvasFrame";
import { useComponentsCode } from "./componentsCode";

/**
 * How far outside the visible part of the stage a lazy preview is loaded
 * ahead of being scrolled to, so it is mostly there when it arrives.
 */
const LAZY_MARGIN = "600px";

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
 * Typing in a text where this frame shows it: the shell's editing on the
 * page (`useCanvasInlineEdit`), and the request it made for THIS frame - the
 * one the pick came from - or `null`.
 */
export type ComponentFrameInline = {
  edit: CanvasInlineEdit;
  request: CanvasInlineEditRequest | null;
  /** The page could not edit what was picked: open it the usual way. */
  onFallback: (paths: SourcePath[]) => void;
};

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
  inline = null,
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
  /**
   * Make the frame only once it is near the visible part of the stage: for a
   * board or a page of many. Each preview is a document of the site's, so a
   * project with a hundred uses would otherwise load a hundred at once. Once
   * made it is kept, so scrolling back does not load it again.
   */
  lazy?: boolean;
  title: string;
  onStatus?: (status: ComponentFrameStatus) => void;
  /** Select & edit in this frame: see {@link ComponentFrameInline}. */
  inline?: ComponentFrameInline | null;
  className?: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState<number | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  const [status, setStatus] = useState<ComponentFrameStatus>("loading");
  const code = useComponentsCode();
  const src = enableUrlOf(
    withQuickPreview(componentPreviewUrl(path, example), code.quickId),
  );
  const frameKey = `${reloadKey}:${code.documentKey}`;
  const [near, setNear] = useState(!lazy);
  useEffect(() => {
    if (near) return;
    const element = containerRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: LAZY_MARGIN },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [near]);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const measure = () => setRoom(element.getBoundingClientRect().width);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, []);

  // A new document starts a new wait for an answer - once there is one. The
  // last height is kept meanwhile, so a new build or a quick preview of the
  // same component swaps in without the frame collapsing first.
  useEffect(() => {
    if (!near) return;
    setStatus("loading");
    const timer = window.setTimeout(() => {
      setStatus((current) => (current === "loading" ? "no-answer" : current));
    }, NO_ANSWER_MS);
    return () => window.clearTimeout(timer);
  }, [src, frameKey, near]);

  // Which quick preview the document now in the frame was opened as
  const loadedQuick = useRef(code.quickId);
  loadedQuick.current = code.quickId;
  const onDocumentRef = useRef(code.onDocument);
  onDocumentRef.current = code.onDocument;
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;
  useEffect(() => {
    onStatusRef.current?.(status);
  }, [status]);

  const post = useCallback((message: object | ValCanvasStudioMessage) => {
    iframeRef.current?.contentWindow?.postMessage(
      message,
      window.location.origin,
    );
  }, []);

  // The project's selection colour, as the canvas is told it (`theme`)
  const selection = code.selection?.selection ?? DEFAULT_CANVAS_SELECTION;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  useEffect(() => {
    post({ type: VAL_PREVIEW_MESSAGES.theme, selection });
  }, [selection, post]);

  /*
   * Select & edit: the request the shell made for this frame goes to the
   * page as the canvas's own `editInline`, and the page's answers go back to
   * the shell as the canvas frame hands them on (`CanvasFrame`).
   */
  const inlineRef = useRef(inline);
  inlineRef.current = inline;
  const [typing, setTyping] = useState(false);
  const requestId = inline?.request?.requestId ?? null;
  useEffect(() => {
    const request = inlineRef.current?.request;
    if (requestId === null || request === undefined || request === null) {
      return;
    }
    post({
      val: VAL_CANVAS_MESSAGE,
      type: "editInline",
      requestId,
      candidates: request.candidates,
    });
  }, [requestId, post]);

  /** Select & edit is in use: the page may be asked to type in a pick. */
  const editingMode = inline !== null;
  const pickingRef = useRef(picking);
  pickingRef.current = picking;
  useEffect(() => {
    post({
      type: VAL_PREVIEW_MESSAGES.picking,
      enabled: picking,
      editing: editingMode,
    });
  }, [picking, editingMode, post]);

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
      if (isValCanvasPageMessage(data)) {
        const current = inlineRef.current;
        if (current === null) return;
        if (data.type === "inlineEditStarted") {
          if (current.edit.onStarted(data.requestId, data.path) === false) {
            post({ val: VAL_CANVAS_MESSAGE, type: "stopInlineEdit" });
          } else {
            setTyping(true);
          }
        } else if (data.type === "inlineEdit") {
          current.edit.onEdit(data.path, data.value);
        } else if (data.type === "inlineEditEnded") {
          current.edit.onEnded(data.path);
          setTyping(false);
        } else if (data.type === "inlineEditSelection") {
          current.edit.onSelection(data.path, data.selection);
        } else if (data.type === "inlineEditUnavailable") {
          const paths = current.edit.onUnavailable(data.requestId);
          if (paths !== null) current.onFallback(paths);
        }
        return;
      }
      if (data.type === VAL_PREVIEW_MESSAGES.ready) {
        setStatus("ready");
        onDocumentRef.current?.({ quick: loadedQuick.current });
        post({
          type: VAL_PREVIEW_MESSAGES.theme,
          selection: selectionRef.current,
        });
        post({
          type: VAL_PREVIEW_MESSAGES.picking,
          enabled: pickingRef.current,
          editing: inlineRef.current !== null,
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

  /*
   * The content changed: read it again, once the edits have settled - but
   * not while a text in this frame is being typed in. The page shows the
   * typing itself, and a refresh would render the component again under the
   * caret; it is read again once the typing ends.
   */
  const firstVersion = useRef(true);
  const missedRefresh = useRef(false);
  useEffect(() => {
    if (firstVersion.current) {
      firstVersion.current = false;
      return;
    }
    if (typing) {
      missedRefresh.current = true;
      return;
    }
    missedRefresh.current = false;
    const timer = window.setTimeout(() => {
      post({ type: VAL_PREVIEW_MESSAGES.refresh });
    }, REFRESH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [contentVersion, typing, post]);

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
      {room !== null && near && (
        <iframe
          key={frameKey}
          ref={iframeRef}
          src={src}
          title={title}
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
