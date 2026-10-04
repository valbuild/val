import React from "react";

const subscribeNever = () => () => {};

/**
 * `false` for the server's render and for this component's hydration render,
 * `true` for every render after.
 *
 * Per component, which is the point: React reads `getServerSnapshot` while it
 * hydrates a component and `getSnapshot` otherwise, and re-renders the
 * component right after hydrating it when the two differ. So a component that
 * hydrates late -- a route split out into its own chunk -- still renders its
 * hydration pass as the server did, however long after the rest of the page.
 */
export function useHydrated(): boolean {
  return React.useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}
