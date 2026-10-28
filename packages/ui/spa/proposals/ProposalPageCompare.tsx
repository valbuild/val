import { useEffect, useRef, useState, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import {
  isValCanvasPageMessage,
  VAL_CANVAS_MESSAGE,
  withValCanvasParam,
} from "@valbuild/shared/internal";
import { CanvasFrame } from "../components/shell/canvas/CanvasFrame";
import type { CanvasPreviewStatus } from "../components/shell/canvas/CanvasPreviewNotice";
import { CANVAS_DEVICE_WIDTHS } from "../components/shell/canvas/types";
import type { ComparePageView } from "../compare/types";
import { siteOrigin, sitePageUrl } from "./sitePageUrl";

/**
 * One side of a page, in a proposal's Compare with the site: the page as the
 * site serves it, or as this proposal does.
 *
 * Both are real renders, not a reconstruction. A proposal is deployed to its
 * own address (valbuild/home `docs/proposals.md`), which is where this Studio
 * runs, so the right is the page at this origin -- saved and unsaved alike, by
 * the canvas's own frame, which keeps a draft render up with every edit. The
 * left is the same route at the site's address: what visitors see now.
 *
 * Neither can be scrolled in step with the other. The site is another origin,
 * and nothing it would answer is in the canvas protocol.
 */
export function ProposalPage({
  siteUrl,
  page,
}: {
  siteUrl: string;
  page: ComparePageView;
}) {
  const width = CANVAS_DEVICE_WIDTHS[page.device];
  return page.side === "left" ? (
    <SitePage siteUrl={siteUrl} url={page.url} width={width} />
  ) : (
    <ProposalSidePage url={page.url} width={width} />
  );
}

function SitePage({
  siteUrl,
  url,
  width,
}: {
  siteUrl: string;
  url: string;
  width: number;
}) {
  const href = sitePageUrl(siteUrl, url);
  const origin = siteOrigin(siteUrl);
  const frameRef = useRef<HTMLIFrameElement>(null);
  /*
   * Whether the site said it is rendering DRAFT content.
   *
   * It can: a site on a sibling subdomain of the proposal's address is the
   * same SITE to a browser, so its Lax cookies come along into this frame,
   * and an editor who has preview on there gets the site's own unpublished
   * changes -- under a heading that says "what visitors see now". The frame
   * cannot be told to leave the cookies behind, so it says so instead. Only a
   * site with Val's canvas bridge answers at all; silence is published.
   */
  const [isDraft, setIsDraft] = useState(false);
  useEffect(() => {
    setIsDraft(false);
    const listener = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      if (!isValCanvasPageMessage(event.data)) return;
      if (event.data.type !== "ready") return;
      setIsDraft(event.data.draftMode);
      if (event.data.draftMode && origin !== null) {
        /*
         * Nothing will be relayed into this frame, and a page in the canvas
         * waits for draft sources until it is told that was all of them --
         * ten seconds per module it reads. Tell it now.
         */
        frameRef.current?.contentWindow?.postMessage(
          { val: VAL_CANVAS_MESSAGE, type: "sourcesSynced" },
          origin,
        );
      }
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [href, origin]);
  return (
    <>
      <PageAddress href={href} />
      {isDraft && (
        <p role="status" className="pb-1 text-xs text-fg-warning-primary">
          Preview is on for the site in this browser, so this shows the site
          with its own unpublished changes.
        </p>
      )}
      <ScaledViewport width={width}>
        {(height) => (
          <iframe
            ref={frameRef}
            // The canvas marker, so a site in draft mode draws no overlay of
            // its own in here.
            src={withValCanvasParam(href)}
            title={`The site's ${url}`}
            style={{ width, height, border: "none", display: "block" }}
            className="bg-white"
            // No way out of the frame: a link aimed at the top window would
            // navigate the Studio away from a review in progress.
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
            // A proposal's address is not the site's business.
            referrerPolicy="no-referrer"
          />
        )}
      </ScaledViewport>
    </>
  );
}

function ProposalSidePage({ url, width }: { url: string; width: number }) {
  const [status, setStatus] = useState<CanvasPreviewStatus>("connecting");
  const [enableKey, setEnableKey] = useState(0);
  return (
    <>
      <PageAddress href={url} />
      {status === "preview-off" && (
        <p role="status" className="pb-1 text-xs text-fg-tertiary">
          Unsaved changes are not shown, because preview is off.{" "}
          <button
            type="button"
            onClick={() => setEnableKey((key) => key + 1)}
            className="font-medium text-fg-primary underline underline-offset-2"
          >
            Show them
          </button>
        </p>
      )}
      <ScaledViewport width={width}>
        {(height) => (
          <CanvasFrame
            url={url}
            width={width}
            height={height}
            reloadKey={0}
            isPicking={false}
            highlightedPath={null}
            enableKey={enableKey}
            onStatusChange={setStatus}
          />
        )}
      </ScaledViewport>
    </>
  );
}

/** Where a side is served, and a way to open it on its own. */
function PageAddress({ href }: { href: string }) {
  const absolute = new URL(href, window.location.origin).toString();
  return (
    <div className="flex min-w-0 items-center gap-2 pb-1 text-xs text-fg-tertiary">
      <span className="min-w-0 flex-1 truncate" title={absolute}>
        {absolute}
      </span>
      <a
        href={absolute}
        target="_blank"
        rel="noopener noreferrer"
        className="flex shrink-0 items-center gap-1 text-fg-secondary hover:text-fg-primary"
      >
        Open
        <ExternalLink size={12} aria-hidden />
      </a>
    </div>
  );
}

/**
 * A page drawn at a device's width, scaled down to fit the column.
 *
 * Never scaled up: a phone-width page in a wide column is drawn at its size and
 * centred. The page scrolls inside its own frame, which is as tall as the
 * column once scaled.
 */
function ScaledViewport({
  width,
  children,
}: {
  width: number;
  children: (height: number) => ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ width: number; height: number } | null>(
    null,
  );
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () =>
      setBox((current) =>
        current?.width === el.clientWidth && current.height === el.clientHeight
          ? current
          : { width: el.clientWidth, height: el.clientHeight },
      );
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
    return () => observer.disconnect();
  }, []);
  const scale =
    box === null || box.width === 0 ? 1 : Math.min(1, box.width / width);
  return (
    <div
      ref={ref}
      className="relative min-h-0 flex-1 overflow-hidden rounded border border-border-primary bg-bg-secondary"
    >
      {box !== null && box.width > 0 && box.height > 0 && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: Math.max(0, (box.width - width * scale) / 2),
            width,
            height: box.height / scale,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        >
          {children(box.height / scale)}
        </div>
      )}
    </div>
  );
}
