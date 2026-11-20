import { useCallback, useState } from "react";

/**
 * Whether this editor has turned on editing on the page: a click on a text
 * in the preview puts the caret in it there, instead of opening its field in
 * the Studio's column. A beta, off until someone turns it on.
 *
 * Per browser, like the assistant's model (`aiModelPreference.ts`) and for
 * the same reason: it is one person's way of working on one machine, not
 * something the project says. When Val has somewhere to keep what a person
 * prefers, this file is the one that changes.
 */
const STORAGE_KEY = "val:beta:inline-editing";

/*
 * Reading and writing storage can throw outright -- a private window, a
 * browser set to block site data -- and a preference that cannot be kept is
 * not worth an error: it is simply off next time.
 */
export function readInlineEditingPreference(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeInlineEditingPreference(enabled: boolean): void {
  try {
    if (enabled) {
      localStorage.setItem(STORAGE_KEY, "1");
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Nothing to do: it still works until the page is closed.
  }
}

export function useInlineEditingPreference(): [
  boolean,
  (enabled: boolean) => void,
] {
  const [enabled, setEnabled] = useState(readInlineEditingPreference);
  const change = useCallback((next: boolean) => {
    writeInlineEditingPreference(next);
    setEnabled(next);
  }, []);
  return [enabled, change];
}
