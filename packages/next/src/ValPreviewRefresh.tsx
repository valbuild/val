"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export const VAL_PREVIEW_REFRESH_MESSAGE = "val-preview-refresh";

/**
 * EXPERIMENTAL: re-renders the preview route when the Val UI says the content
 * changed.
 *
 * The Val UI runs in the parent frame, so the patch is applied there: the
 * preview iframe has no way of knowing about it. The UI therefore posts a
 * message to the iframe, and this component turns that into a Next.js
 * `router.refresh()`, which re-runs the Server Component with the new content.
 *
 * Render it next to `unstable_renderValComponent` output.
 */
export function ValPreviewRefresh() {
  const router = useRouter();
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) {
        return;
      }
      if (event.data?.type === VAL_PREVIEW_REFRESH_MESSAGE) {
        router.refresh();
      }
    };
    window.addEventListener("message", listener);
    return () => {
      window.removeEventListener("message", listener);
    };
  }, [router]);
  return null;
}
