import { useCallback, useState } from "react";
import {
  clampColumn,
  type ColumnWidths,
  type SidePane,
} from "./workspaceLayout";

const STORAGE_KEY = "val:workspace-widths";
const PANES: readonly SidePane[] = ["content", "sketch", "chat"];

/**
 * What was stored, if it is widths at all: anything else -- another
 * version's shape, a hand edit, storage that throws -- is no widths, and
 * every column is at its designed width.
 */
function read(): ColumnWidths {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const widths: ColumnWidths = {};
    for (const pane of PANES) {
      const value: unknown = Reflect.get(parsed, pane);
      if (typeof value === "number" && Number.isFinite(value)) {
        widths[pane] = clampColumn(pane, value);
      }
    }
    return widths;
  } catch {
    return {};
  }
}

function write(widths: ColumnWidths) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(widths));
  } catch {
    // A private window, or storage switched off: the widths last as long as
    // the page does.
  }
}

/**
 * The widths someone dragged the workspace's columns to, remembered in this
 * browser: a convenience of the person at this screen, like a window's size,
 * not something anyone else should be handed. `null` puts a column back to
 * its designed width.
 */
export function useColumnWidths(): [
  ColumnWidths,
  (panes: readonly SidePane[], width: number | null) => void,
] {
  const [widths, setWidths] = useState<ColumnWidths>(read);
  const setWidth = useCallback(
    (panes: readonly SidePane[], width: number | null) => {
      setWidths((current) => {
        const next: ColumnWidths = { ...current };
        for (const pane of panes) {
          if (width === null) delete next[pane];
          else next[pane] = clampColumn(pane, width);
        }
        write(next);
        return next;
      });
    },
    [],
  );
  return [widths, setWidth];
}
