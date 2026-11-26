import type { ReactNode } from "react";
import {
  createRoot,
  hydrateRoot,
  type HydrationOptions,
  type Root,
} from "react-dom/client";
import { isQuickPreviewUrl } from "@valbuild/shared/client";

/**
 * `hydrateRoot` from `react-dom/client`, except in a quick preview of a
 * proposal, where the page is RENDERED by its code instead: a drop-in for the
 * call in a TanStack Start client entry (`src/client.tsx`).
 *
 * A quick preview (`quickPreview.ts` in `@valbuild/shared`) is the HTML the
 * LAST build's server rendered, with the proposal's new code for the
 * browser. There is nothing for the new code to hydrate: hydrating keeps the
 * old markup's classes (React mends text, never attributes), so the worker
 * takes the markup out first -- and React, hydrating a body with nothing in
 * it, reports a hydration failure (#418) as an uncaught error, on every
 * quick preview, which the Studio's page check took for the site's own.
 * Rendered with `createRoot` there is no hydration, so nothing fails, and
 * React draws the whole document -- `<html>`, `<head>` and `<body>` -- from
 * the new code, keeping the scripts and stylesheets already in it.
 *
 * Everywhere else -- every visitor, every page of a build, local
 * development -- it is `hydrateRoot`, called exactly as given, so a real
 * hydration bug is reported as it always was. Only a document opened at a
 * quick preview's address (`?val_quick=`), which only the Studio's canvas
 * opens, is rendered.
 *
 * ```tsx
 * // src/client.tsx
 * import { StrictMode, startTransition } from "react";
 * import { StartClient } from "@tanstack/react-start/client";
 * import { hydrateValRoot } from "@valbuild/tanstack/entry-client";
 *
 * startTransition(() => {
 *   hydrateValRoot(
 *     document,
 *     <StrictMode>
 *       <StartClient />
 *     </StrictMode>,
 *   );
 * });
 * ```
 */
export function hydrateValRoot(
  container: Document | Element,
  children: ReactNode,
  options?: HydrationOptions,
): Root {
  if (
    typeof window !== "undefined" &&
    isQuickPreviewUrl(window.location.href)
  ) {
    // The options `createRoot` shares with `hydrateRoot`: how errors are
    // reported is the app's, here too. `formState` is hydration's alone.
    const root = createRoot(container, {
      ...(options?.identifierPrefix !== undefined
        ? { identifierPrefix: options.identifierPrefix }
        : {}),
      ...(options?.onUncaughtError !== undefined
        ? { onUncaughtError: options.onUncaughtError }
        : {}),
      ...(options?.onCaughtError !== undefined
        ? { onCaughtError: options.onCaughtError }
        : {}),
      ...(options?.onRecoverableError !== undefined
        ? { onRecoverableError: options.onRecoverableError }
        : {}),
    });
    root.render(children);
    return root;
  }
  return hydrateRoot(container, children, options);
}
