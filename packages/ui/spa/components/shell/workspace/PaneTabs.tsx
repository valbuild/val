import { createContext, useContext, type ReactNode } from "react";

/**
 * Sketch and the Assistant's tabs, while the two share a column
 * (`placePanes`'s `tabs`), for the pane in front to put in its own header:
 * on the right, with what the pane does on the left -- Build for Sketch
 * (the plan's "Sketch and Assistant's header").
 *
 * A context rather than a prop because the Sketch pane is the app's
 * (`sketchPane`): the shell places it and does not render its header. The
 * Assistant's header is the shell's own, so it is handed the tabs directly.
 */
const PaneTabsContext = createContext<ReactNode>(null);

export function PaneTabsProvider({
  tabs,
  children,
}: {
  tabs: ReactNode;
  children: ReactNode;
}) {
  return (
    <PaneTabsContext.Provider value={tabs}>{children}</PaneTabsContext.Provider>
  );
}

/** The tabs to put in this pane's header, or `null` in a column of its own. */
export function usePaneTabs(): ReactNode {
  return useContext(PaneTabsContext);
}
