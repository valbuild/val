"use client";

import { ValPreviewBridgeCore } from "@valbuild/react/internal";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

/**
 * EXPERIMENTAL: the preview route's side of its conversation with the Studio.
 * Wrap what `unstable_renderValComponent` returns in it.
 *
 * It keeps the frame as tall as the component, sends a click on content to
 * the Studio so it can open that field, and re-runs the Server Component with
 * the new content (`router.refresh()`) when an edit is made. See
 * `ValPreviewBridgeCore` in `@valbuild/react/internal` for the details.
 *
 * @example
 * // app/val-preview/page.tsx
 * return (
 *   <ValPreviewBridge>
 *     {await unstable_renderValComponent({ valModules, sourcePath, fetchVal })}
 *   </ValPreviewBridge>
 * );
 */
export function ValPreviewBridge({ children }: { children: ReactNode }) {
  const router = useRouter();
  return (
    <ValPreviewBridgeCore onRefresh={() => router.refresh()}>
      {children}
    </ValPreviewBridgeCore>
  );
}
