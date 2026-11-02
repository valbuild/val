"use client";
import { ValExternalStore } from "@valbuild/react/stega";
import React from "react";

/*
 * The page's store of what the Studio sent it is the same in both frameworks,
 * and lives in `@valbuild/react` with the reader that answers from it
 * (`overlaySource`). Re-exported because this is where the provider and its
 * tests have always found it.
 */
export { ValExternalStore };

export const ValOverlayContext = React.createContext<{
  readonly store?: ValExternalStore;
  readonly draftMode: boolean | null;
  // Whether the hooks may suspend until draft data is loaded (`overlaySource`, in @valbuild/react). False
  // during SSR and hydration (the server store is empty unless ValProvider was
  // given a server-read `draft`, in which case it already holds the draft;
  // otherwise draft data arrives via browser CustomEvents only); activated by ValProvider after
  // hydration — inside a transition, so static content stays visible while
  // hooks suspend — when its `suspend` prop is set and the Val Enable cookie
  // is present. Never deactivated once active.
  readonly suspend: boolean;
  /**
   * Resolves once `draftMode` is known — see `ValNextProvider`.
   *
   * `null` draft mode is not "off": the content reader treats it as off, so a
   * render while it is unknown resolves against committed source, and for a
   * route that only exists in an uncommitted patch that is a `notFound()` no
   * later answer can undo.
   */
  readonly draftModeReady?: Promise<void>;
  /**
   * Whether the editor has said it sent every draft source it holds.
   *
   * Until then a missing module may still be coming; after it, a missing module
   * has no draft and committed source is the draft. Without it the only way to
   * find out was `waitForLoad`'s timeout, once per unedited module.
   */
  readonly draftSourcesSynced?: boolean;
  /**
   * Whether this page was rendered from a server-read draft (`<ValProvider
   * draft>`). Then the hooks leave the edit tags out of what a component
   * renders on the server and while it hydrates -- see `useEncodesEditTags`.
   */
  readonly serverDraft?: boolean;
}>({
  store: undefined,
  draftMode: false,
  suspend: false,
  draftModeReady: undefined,
  draftSourcesSynced: false,
});

export function ValOverlayProvider({
  store,
  draftMode,
  suspend,
  draftModeReady,
  draftSourcesSynced,
  serverDraft,
  children,
}: {
  store?: ValExternalStore;
  draftMode: boolean | null;
  suspend: boolean;
  draftModeReady?: Promise<void>;
  draftSourcesSynced?: boolean;
  serverDraft?: boolean;
  children: React.ReactNode;
}) {
  return (
    <ValOverlayContext.Provider
      value={{
        store,
        draftMode,
        suspend,
        draftModeReady,
        draftSourcesSynced,
        serverDraft,
      }}
    >
      {children}
    </ValOverlayContext.Provider>
  );
}

export const useValOverlayContext = () => {
  return React.useContext(ValOverlayContext);
};
