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
 * way of working on one machine, not something the project says. `select`
 * until they choose otherwise, since it is what a click on the page did
 * before there was a choice, and what the tour and every link into the
 * Studio assume.
 */
export type CanvasSelectMode = "select" | "edit";

const STORAGE_KEY = "val:canvas:select-mode";

/*
 * Reading and writing storage can throw outright -- a private window, a
 * browser set to block site data -- and a preference that cannot be kept is
 * not worth an error: it is simply `select` next time.
 */
export function readSelectModePreference(): CanvasSelectMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === "edit" ? "edit" : "select";
  } catch {
    return "select";
  }
}

export function writeSelectModePreference(mode: CanvasSelectMode): void {
  try {
    if (mode === "edit") {
      localStorage.setItem(STORAGE_KEY, mode);
    } else {
      localStorage.removeItem(STORAGE_KEY);
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
