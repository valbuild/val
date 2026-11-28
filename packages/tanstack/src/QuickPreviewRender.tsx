import React, { Suspense, useLayoutEffect, useState } from "react";

/**
 * The site's part of a quick preview's page, RENDERED by the new code
 * rather than hydrated: what `ValProvider` wraps its children in when the
 * page was opened as a quick preview (`?val_quick=`), and nothing anywhere
 * else.
 *
 * A quick preview (`quickPreview.ts` in `@valbuild/shared`) is the HTML the
 * LAST build's server rendered, run by a proposal's NEW code for the
 * browser. Hydrating the one with the other cannot work: React keeps the
 * server's attributes where only those differ -- so a change to classes,
 * most of what the assistant changes, did not show -- and reports a
 * hydration failure (React error 418) where text differs, which the page
 * check took for the site's own error. Taking the markup out first, as the
 * quick preview used to, showed the classes, but React then reported the
 * empty page as a hydration failure, on EVERY quick preview.
 *
 * So this part is never hydrated:
 *
 * 1. On the server it renders the children inside a `<Suspense>` boundary,
 *    so the page's markup is there, between the boundary's markers.
 * 2. In the browser, while the page hydrates, the boundary suspends: React
 *    leaves what the server rendered in place and compares none of it.
 *    The old page stays on screen; nothing is blank.
 * 3. As the page's hydration commits, the boundary is replaced by a new
 *    one (another `key`): React removes the server's markup and renders the
 *    children with the new code, before the browser paints. A render, so
 *    nothing can fail to hydrate.
 *
 * Everything else on the page -- `ValProvider` itself and what is outside
 * it, `__root`'s `<html>`, `<head>`, `<body>` and scripts -- hydrates as
 * always. A visitor never gets here: `quickPreview` is false for every
 * page but one the Studio's canvas opened as a quick preview, and then this
 * is exactly `children`.
 */
export function QuickPreviewRender({
  quickPreview,
  onServer,
  children,
}: {
  /**
   * The page was opened as a quick preview. Read once, when the page is
   * first rendered, and on the server and in the browser alike: a boundary
   * that came or went with a later navigation would remount the site.
   */
  quickPreview: boolean;
  /**
   * Rendering on the server (the router's `isServer`), where the children
   * are rendered for the markup to be there. Not `typeof window`: what the
   * router decides by is what the rest of the app's render goes by.
   */
  onServer: boolean;
  children: React.ReactNode;
}): React.ReactNode {
  const [rendered, setRendered] = useState(false);
  /*
   * A layout effect: the swap is rendered in the same task as the hydration
   * that ran it, before the browser paints and before any passive effect --
   * the canvas bridge's "this page is ready" among them -- so the first
   * frame the Studio is told about already shows the new code.
   */
  useLayoutEffect(() => {
    if (quickPreview) setRendered(true);
  }, [quickPreview]);
  if (!quickPreview) return children;
  // Only in the browser, and only until the page has hydrated: the server
  // renders the children, which is the markup left in place meanwhile.
  const holding = !onServer && !rendered;
  return (
    <Suspense key={rendered ? "rendered" : "hydrating"} fallback={null}>
      {holding ? <HoldServerMarkup /> : children}
    </Suspense>
  );
}

/** Never resolved: the boundary keeps the server's markup until replaced. */
const NEVER = new Promise<never>(() => {});

function HoldServerMarkup(): React.ReactNode {
  throw NEVER;
}
