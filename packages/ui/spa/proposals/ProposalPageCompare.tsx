import { useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import {
  isValCanvasPageMessage,
  VAL_CANVAS_MESSAGE,
  withValCanvasParam,
} from "@valbuild/shared/internal";
import { CanvasFrame } from "../components/shell/canvas/CanvasFrame";
import { SitePreview } from "../components/shell/canvas/SitePreview";
import type { CanvasDevice } from "../components/shell/canvas/types";
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
  return page.side === "left" ? (
    <SitePage siteUrl={siteUrl} url={page.url} device={page.device} />
  ) : (
    <ProposalSidePage url={page.url} device={page.device} />
  );
}

function SitePage({
  siteUrl,
  url,
  device,
}: {
  siteUrl: string;
  url: string;
  device: CanvasDevice;
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
    <SitePreview
      device={device}
      headerEnd={
        <div className="min-w-0 flex-1">
          <PageAddress href={href} />
          {isDraft && (
            <p role="status" className="text-xs text-fg-warning-primary">
              Preview is on for the site in this browser, so this shows the site
              with its own unpublished changes.
            </p>
          )}
        </div>
      }
      renderPage={({ width, height, reloadKey }) => (
        <iframe
          // A reload is a new frame: the site is not Val's to navigate.
          key={reloadKey}
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
    />
  );
}

/**
 * The proposal's side: the Studio's own preview, as on the canvas -- preview
 * mode turned on by itself, the notice when it is not, reload and zoom.
 */
function ProposalSidePage({
  url,
  device,
}: {
  url: string;
  device: CanvasDevice;
}) {
  return (
    <SitePreview
      device={device}
      headerEnd={
        <div className="min-w-0 flex-1">
          <PageAddress href={url} />
        </div>
      }
      renderPage={(viewport) => (
        <CanvasFrame
          url={url}
          width={viewport.width}
          height={viewport.height}
          reloadKey={viewport.reloadKey}
          isPicking={false}
          highlightedPath={null}
          enableKey={viewport.enableKey}
          onStatusChange={viewport.onStatusChange}
          onRefreshingChange={viewport.onRefreshingChange}
          onPinch={viewport.onPinch}
          onZoom={viewport.onZoom}
        />
      )}
    />
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
