import { createContext, ReactNode, useContext, useMemo } from "react";
import type { TourRun } from "./tourSteps";

/**
 * The shell's guided tour, for something inside the shell that wants to run
 * one: the assistant's `show_guide`.
 *
 * The shell owns whether a tour is open and which, the same as it owns the
 * open panel (`shellPanelLink`), and the assistant is many components below
 * it in a slot, so the request travels through here.
 */
export type ShellTour = {
  /** Open `run`, in place of whatever tour is open. */
  start: (run: TourRun) => void;
  /** Close the tour, if `run` is the one open. Its `onClose` is told. */
  stop: (run: TourRun) => void;
  /**
   * What a step could point at right now: the `data-val-tour` names on
   * screen and not covered. See `tourTargetsOnScreen`.
   */
  targetsOnScreen: () => string[];
};

const ShellTourContext = createContext<ShellTour | null>(null);

export function ShellTourProvider({
  start,
  stop,
  targetsOnScreen,
  children,
}: ShellTour & { children: ReactNode }) {
  const value = useMemo<ShellTour>(
    () => ({ start, stop, targetsOnScreen }),
    [start, stop, targetsOnScreen],
  );
  return (
    <ShellTourContext.Provider value={value}>
      {children}
    </ShellTourContext.Provider>
  );
}

/**
 * The shell's tour, or null outside a shell (Storybook, a test, the classic
 * Studio): there, the assistant's guide says it cannot be shown.
 */
export function useShellTour(): ShellTour | null {
  return useContext(ShellTourContext);
}
