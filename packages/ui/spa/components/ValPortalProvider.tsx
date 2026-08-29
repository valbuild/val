import React, { useContext, useMemo, useState } from "react";
import { useTheme } from "./ValThemeProvider";

type ValPortalContextValue = {
  portalNode: HTMLDivElement | null;
};

const ValPortalContext = React.createContext<ValPortalContextValue>(
  new Proxy(
    {},
    {
      get: () => {
        throw new Error(
          "Cannot use ValPortalContext outside of ValPortalProvider",
        );
      },
    },
  ) as ValPortalContextValue,
);

/**
 * The one element every Studio popup portals into.
 *
 * It has to be inside the shadow root — a portal to `document.body` lands
 * outside it and loses every Val style — and it has to be a real node before a
 * consumer can use it, which is a commit and not a render.
 *
 * ## Held in STATE, not read off a ref during render
 *
 * `useValPortal()` used to return `portalRef.current`, read in the render body.
 * A ref is attached at commit, so the answer was `null` on any render that
 * happened before this provider's own commit and an element on every render
 * after — a change React was never told about, delivered to whichever consumer
 * happened to re-render next, for its own unrelated reason.
 *
 * That is exactly the kind of untracked prop change `quirks.md` warns about,
 * and it cost the rich text editor its content: the editor took the container
 * as a dependency of the effect that builds its `EditorView`, so the switch
 * from `null` to the element destroyed and rebuilt the view — and the rebuild
 * re-parsed a `defaultValue` that was not there. The field went blank and
 * stayed blank, because nothing about the SOURCE had changed to re-seed it.
 *
 * A callback ref into state makes the arrival a real update: one extra render
 * at mount, and consumers that memoise or key on the container are correct by
 * construction rather than by luck.
 */
export function ValPortalProvider({ children }: { children: React.ReactNode }) {
  const [portalNode, setPortalNode] = useState<HTMLDivElement | null>(null);
  const { theme } = useTheme();
  // Memoised, because a context value built inline is a fresh object every
  // render — harmless until something downstream takes it as a dependency, and
  // then it is the whole subtree recomputing. See `quirks.md`.
  const value = useMemo<ValPortalContextValue>(
    () => ({ portalNode }),
    [portalNode],
  );

  return (
    <ValPortalContext.Provider value={value}>
      <div
        data-val-portal="true"
        ref={setPortalNode}
        {...(theme ? { "data-mode": theme } : {})}
      ></div>
      {children}
    </ValPortalContext.Provider>
  );
}

export function useValPortal() {
  const { portalNode } = useContext(ValPortalContext);
  return portalNode;
}
