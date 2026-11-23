import { createContext, useContext } from "react";
import {
  QUICK_PREVIEW_SERVICE_WORKER_PATH,
  storeQuickPreview,
} from "@valbuild/shared/internal";
import type { QuickPreviewStorer } from "../shell/canvas/CanvasFrame";
import type { CanvasInlineEdit } from "../shell/canvas/useCanvasInlineEdit";
import type { CanvasSelectMode } from "../../hooks/selectModePreference";

/**
 * Which build of the site's code the component previews are rendered with,
 * handed down by the shell, which owns code mode's quick preview
 * (`useCodeModeQuickPreview`) as it does for the canvas.
 *
 * - `quickId`: the quick preview to open the previews as (`?val_quick=`), or
 *   `null` for the served build. A component is the site's own code, so a
 *   change the assistant makes to it in code mode reaches its previews the
 *   way it reaches the page in the canvas: the preview route is in the same
 *   app bundle the quick preview replaces.
 * - `documentKey`: moves when another build is served, or code mode asks
 *   for the page again; every preview loads again with it.
 * - `onDocument`: a preview came up as this quick preview (or the served
 *   build), which is how code mode's status knows one is in front.
 */
export type ComponentsCode = {
  quickId: string | null;
  documentKey: string;
  onDocument?: (document: { quick: string | null }) => void;
  /**
   * The project's selection colours, as the canvas is given them
   * (`canvasSelectionColors`): the outline a pick in a preview draws, and
   * the caret's field when typing in one.
   */
  selection?: { selection: string; selectionSoft: string };
  /**
   * Content's Select mode, the one beside a page's preview: the same state,
   * not a second copy of the remembered choice, so switching it in either
   * place switches it in both.
   */
  select?: {
    mode: CanvasSelectMode;
    onModeChange: (mode: CanvasSelectMode) => void;
  };
  /**
   * Editing on the page, from the Studio's side: the shell's one
   * `useCanvasInlineEdit`, so what is typed in a component's preview is
   * written, and given its formatting controls, as it is in the canvas.
   */
  inlineEdit?: CanvasInlineEdit;
};

export const ComponentsCodeContext = createContext<ComponentsCode>({
  quickId: null,
  documentKey: "",
});

export function useComponentsCode(): ComponentsCode {
  return useContext(ComponentsCodeContext);
}

/**
 * Store a quick preview's files from the Studio's own page, for the
 * Components view, where there is no canvas page to hand them to.
 *
 * The canvas has its page's bridge store them; the files land in one service
 * worker for the whole origin either way, and the Studio is on the site's
 * origin (the canvas frames the site it is on), so this is the same call the
 * bridge makes, made here: any document opened with `?val_quick=<id>` - a
 * component's preview included - is then served the new code.
 */
export const storeQuickPreviewHere: QuickPreviewStorer = (id, files) =>
  storeQuickPreview(id, files, {
    swUrl: `/api/val${QUICK_PREVIEW_SERVICE_WORKER_PATH}`,
  });
