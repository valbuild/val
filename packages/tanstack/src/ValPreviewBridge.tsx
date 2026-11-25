import { useRouter } from "@tanstack/react-router";
import { SET_AUTO_TAG_JSX_ENABLED } from "@valbuild/react/stega";
import { ValPreviewBridgeCore } from "@valbuild/react/internal";
import type { ReactNode } from "react";

/**
 * EXPERIMENTAL: the preview route's side of its conversation with the Studio.
 * Wrap `Unstable_ValComponentPreview` in it.
 *
 * It keeps the frame as tall as the component, sends a click on content to
 * the Studio so it can open that field, and reads the content again when an
 * edit is made - `router.invalidate()`, which re-runs the route's loader. See
 * `ValPreviewBridgeCore` in `@valbuild/react/internal` for the details.
 *
 * It also switches on the edit tags. Everywhere else `ValProvider` does that,
 * once hydration has told it the Studio is open; the preview route is not
 * under the site's `ValProvider`, and is rendered in the browser only
 * (`ssr: false`), so it can tag from its first render.
 *
 * @example
 * // src/routes/val-preview.tsx
 * <ValPreviewBridge>
 *   <Unstable_ValComponentPreview
 *     valModules={valModules}
 *     source={Route.useLoaderData()}
 *   />
 * </ValPreviewBridge>
 */
export function ValPreviewBridge({ children }: { children: ReactNode }) {
  const router = useRouter();
  // Before the children render, so their JSX is created with the tags on.
  // A global switch, and idempotent: setting it again on a re-render is free.
  SET_AUTO_TAG_JSX_ENABLED(true);
  return (
    <ValPreviewBridgeCore onRefresh={() => router.invalidate()}>
      {children}
    </ValPreviewBridgeCore>
  );
}
