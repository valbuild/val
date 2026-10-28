import { useCallback, useEffect, useRef, useState } from "react";
import {
  withQuickPreviewParam,
  type PageLocation,
  type PickedElement,
} from "@valbuild/shared/internal";
import {
  CanvasFrame,
  type CanvasFrameProps,
  type PageReader,
} from "../shell/canvas/CanvasFrame";
import type { CanvasPreviewStatus } from "../shell/canvas/CanvasPreviewNotice";
import { previewUrl } from "../../design/designTabUrl";

/**
 * The design tab's preview, swapping in a new build without a blank page.
 *
 * A new build used to remount the frame: it went white, went through
 * `/api/val/enable`, loaded and hydrated from nothing, and opened at the top
 * of the page it was on, or of the front page. Now the new build loads in a
 * second frame behind the first, and once its page says it is there -- the
 * bridge's `ready`, which is after it has hydrated -- it fades in over the old
 * one at the same path and scroll, and the old one goes.
 *
 * The page the person is looking at stays usable while the next loads, and
 * a next that never answers (a page with no bridge) is swapped in after the
 * frame's own timeout: it is the new build, and the old one is out of date.
 */

/** How long the new build fades in over the old one. */
const FADE_MS = 200;
/** How long a scroll back to where the page was is given before the fade. */
const SETTLE_MS = 150;

type Frame = {
  id: number;
  url: string;
  scrollTo: { x: number; y: number } | null;
  /**
   * `reloadKey` when the frame was made: a reload is the key moving past it,
   * so a frame that comes to the front is not reloaded by a reload that
   * happened before it existed.
   */
  reloadBase: number;
  /** The quick preview it shows, or `null` for the served build. */
  quick: string | null;
};

export type DesignPreviewFramesProps = {
  /** The proposal's address. */
  address: string;
  /** The page asked for (the page menu): the frame navigates there. */
  src: string;
  /** The build the address serves: a new one is swapped in. */
  buildKey: string | null;
  /** Bumped to reload the page as it is, at once. */
  reloadKey: number;
  /** The address's origin, which the frames talk to. */
  origin: string;
  elementPicking: CanvasFrameProps["elementPicking"];
  onPickElement: (element: PickedElement) => void;
  onElementPickingStopped: () => void;
  enableKey: number;
  /** The status of the page in front. */
  onStatusChange: (status: CanvasPreviewStatus) => void;
  /** Reads the page in front: the assistant's `read_page`. */
  onPageReader?: (reader: PageReader | null) => void;
  /** A new build is loading behind the page in front. */
  onSwappingChange?: (swapping: boolean) => void;
  /**
   * A quick preview to show (`quickPreview.ts`): a new id is loaded behind,
   * as a new build is, opened with `val_quick`. Its files must already be
   * stored, through `onQuickPreviewStorer`.
   */
  quickPreviewId?: string | null;
  /** Stores a quick preview's files in the page in front. */
  onQuickPreviewStorer?: CanvasFrameProps["onQuickPreviewStorer"];
  /** What the page in front shows, each time another comes to the front. */
  onFront?: (front: { quick: string | null }) => void;
};

export function DesignPreviewFrames({
  address,
  src,
  buildKey,
  reloadKey,
  origin,
  elementPicking,
  onPickElement,
  onElementPickingStopped,
  enableKey,
  onStatusChange,
  onPageReader,
  onSwappingChange,
  quickPreviewId = null,
  onQuickPreviewStorer,
  onFront,
}: DesignPreviewFramesProps) {
  const nextId = useRef(1);
  const [live, setLive] = useState<Frame>({
    id: 0,
    url: src,
    scrollTo: null,
    reloadBase: reloadKey,
    quick: null,
  });
  const [incoming, setIncoming] = useState<Frame | null>(null);
  /** The frame faded out of, kept under the new one until the fade is done. */
  const [leaving, setLeaving] = useState<Frame | null>(null);
  /** Where the page in front is: what the next build opens at. */
  const location = useRef<PageLocation | null>(null);

  // The page menu: the page in front goes there, as it always did.
  useEffect(() => {
    location.current = null;
    setIncoming(null);
    setLive((frame) => (frame.url === src ? frame : { ...frame, url: src }));
  }, [src]);

  const reloadKeyNow = useRef(reloadKey);
  reloadKeyNow.current = reloadKey;

  /** A frame for what is to come to the front: where the page in front is. */
  const behind = useCallback(
    (quick: string | null): Frame => {
      const at = location.current;
      const url = (at !== null ? previewUrl(address, at.path) : null) ?? src;
      return {
        id: nextId.current++,
        url: quick === null ? url : withQuickPreviewParam(url, quick),
        scrollTo: at !== null ? { x: at.scrollX, y: at.scrollY } : null,
        reloadBase: reloadKeyNow.current,
        quick,
      };
    },
    [address, src],
  );

  // A new build: loaded behind, where the page in front is.
  const lastBuild = useRef(buildKey);
  useEffect(() => {
    if (buildKey === lastBuild.current) return;
    lastBuild.current = buildKey;
    setIncoming(behind(null));
  }, [buildKey, behind]);

  // A quick preview: the same, opened as one.
  const lastQuick = useRef(quickPreviewId);
  useEffect(() => {
    if (quickPreviewId === lastQuick.current) return;
    lastQuick.current = quickPreviewId;
    if (quickPreviewId !== null) setIncoming(behind(quickPreviewId));
  }, [quickPreviewId, behind]);

  useEffect(() => {
    onFront?.({ quick: live.quick });
  }, [live.id, live.quick, onFront]);

  useEffect(() => {
    onSwappingChange?.(incoming !== null);
  }, [incoming, onSwappingChange]);

  // Once the new one has said it is there, and had a moment to scroll back
  // to where the old one was: it goes in front.
  const [incomingReady, setIncomingReady] = useState(false);
  useEffect(() => {
    setIncomingReady(false);
  }, [incoming?.id]);
  useEffect(() => {
    if (!incomingReady || incoming === null) return;
    const settle = setTimeout(() => {
      setLeaving(live);
      setLive(incoming);
      setIncoming(null);
    }, SETTLE_MS);
    return () => clearTimeout(settle);
  }, [incomingReady, incoming, live]);
  useEffect(() => {
    if (leaving === null) return;
    const gone = setTimeout(() => setLeaving(null), FADE_MS + 50);
    return () => clearTimeout(gone);
  }, [leaving]);

  const onIncomingStatus = useCallback((status: CanvasPreviewStatus) => {
    if (
      status === "live" ||
      status === "preview-off" ||
      status === "no-answer"
    ) {
      setIncomingReady(true);
    }
  }, []);
  const onLiveLocation = useCallback((at: PageLocation) => {
    location.current = at;
  }, []);

  const frameOf = (frame: Frame, role: "live" | "incoming" | "leaving") => (
    <div
      key={frame.id}
      className="absolute inset-0"
      style={{
        // The new build fades in over the old one (its opacity moving from
        // 0 as it comes to the front); the one leaving stays under it until
        // it is covered.
        opacity: role === "incoming" ? 0 : 1,
        transition: role === "live" ? `opacity ${FADE_MS}ms ease-out` : "none",
        zIndex: role === "leaving" ? 0 : role === "live" ? 1 : 2,
        pointerEvents: role === "live" ? "auto" : "none",
      }}
      aria-hidden={role === "live" ? undefined : true}
      // Which page is in front, for tests and for anyone reading the DOM.
      data-design-frame={role === "live" ? "front" : role}
    >
      <CanvasFrame
        url={frame.url}
        origin={origin}
        relaySources={false}
        throughEnable
        width="100%"
        height="100%"
        reloadKey={role === "live" ? reloadKey - frame.reloadBase : 0}
        isPicking={false}
        highlightedPath={null}
        scrollTo={frame.scrollTo}
        {...(role === "live"
          ? {
              elementPicking,
              onPickElement,
              onElementPickingStopped,
              enableKey,
              onStatusChange,
              onLocation: onLiveLocation,
              ...(onPageReader !== undefined ? { onPageReader } : {}),
              ...(onQuickPreviewStorer !== undefined
                ? { onQuickPreviewStorer }
                : {}),
            }
          : role === "incoming"
            ? { onStatusChange: onIncomingStatus }
            : {})}
      />
    </div>
  );

  return (
    <div className="relative h-full w-full">
      {leaving !== null && frameOf(leaving, "leaving")}
      {frameOf(live, "live")}
      {incoming !== null && frameOf(incoming, "incoming")}
    </div>
  );
}
