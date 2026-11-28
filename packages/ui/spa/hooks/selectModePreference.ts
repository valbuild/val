import { useCallback, useState } from "react";

/**
 * What Content's Select does with a pick on the page:
 *
 * - `select` opens the picked field in the Studio's column, as a pick always
 *   has;
 * - `edit` puts the caret in a picked TEXT where the page shows it
 *   (`useCanvasInlineEdit`), and opens anything else in the column.
 *
 * Which one a person used last is kept per browser, like the assistant's
 * model (`aiModelPreference.ts`) and for the same reason: it is one person's
 * way of working on one machine, not something the project says. `edit`
 * until they choose otherwise ({@link DEFAULT_SELECT_MODE}): it does
 * everything `select` does for what is not a text, and a text is most often
 * picked to be typed in.
 *
 * Only a choice AWAY from the default is stored, so the default can change
 * again without anyone being held to one they never picked. It was `select`
 * at first, when only `edit` was stored: a browser from then has either
 * `edit` or nothing, and reads as `edit` both ways.
 */
export type CanvasSelectMode = "select" | "edit";

/** What Select does in a browser where nobody has chosen. */
export const DEFAULT_SELECT_MODE: CanvasSelectMode = "edit";

const STORAGE_KEY = "val:canvas:select-mode";

/*
 * Reading and writing storage can throw outright -- a private window, a
 * browser set to block site data -- and a preference that cannot be kept is
 * not worth an error: it is simply the default next time.
 */
export function readSelectModePreference(): CanvasSelectMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === "select"
      ? "select"
      : DEFAULT_SELECT_MODE;
  } catch {
    return DEFAULT_SELECT_MODE;
  }
}

export function writeSelectModePreference(mode: CanvasSelectMode): void {
  try {
    if (mode === DEFAULT_SELECT_MODE) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, mode);
    }
  } catch {
    // Nothing to do: it still works until the page is closed.
  }
}

export function useSelectModePreference(): [
  CanvasSelectMode,
  (mode: CanvasSelectMode) => void,
] {
  const [mode, setMode] = useState(readSelectModePreference);
  const change = useCallback((next: CanvasSelectMode) => {
    writeSelectModePreference(next);
    setMode(next);
  }, []);
  return [mode, change];
}
