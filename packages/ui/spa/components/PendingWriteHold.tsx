import { createContext, ReactNode, useContext } from "react";

/**
 * Whether writing is held for everything in this subtree.
 *
 * Two callers, one meaning. The Studio holds writes while something the fields
 * depend on is still loading; the history pane holds them forever, because the
 * past is not editable. Both are "you may look at this field but not change
 * it", which is why they share a mechanism rather than growing a second one.
 *
 * The one reader is {@link AnyField}, which folds this into the `readonly` it
 * already computes — so the hold reuses the guard every readonly field already
 * has (`ReadonlyGuard`) instead of inventing a second way to make a field
 * uneditable.
 *
 * A context rather than a prop because the fields are rendered by whatever the
 * route resolves to, several layers below the thing that knows about the wait,
 * and threading a boolean through every field component would put a
 * "loading" parameter on components that have nothing to do with loading.
 *
 * Deliberately narrower than the hold it replaced. That one was `inert` on the
 * whole editor subtree, which also took out everything in it that merely
 * NAVIGATES: a record's rows, the scope trail in the header, a reference to
 * another module. None of those can write anything, and being unable to move
 * around while waiting is worse than the stale value the hold exists to prevent.
 */
const PendingWriteHoldContext = createContext(false);

export function PendingWriteHoldProvider({
  held,
  children,
}: {
  held: boolean;
  children: ReactNode;
}) {
  return (
    <PendingWriteHoldContext.Provider value={held}>
      {children}
    </PendingWriteHoldContext.Provider>
  );
}

/** True while fields must not be written to. Defaults to false. */
export function usePendingWriteHold(): boolean {
  return useContext(PendingWriteHoldContext);
}
