import { createContext, useContext } from "react";
import type { PickedElement } from "@valbuild/shared/internal";
import type {
  PageCamera,
  PageInteractor,
  PageLogReader,
  PageReader,
} from "./CanvasFrame";
import type { SendContext } from "../../AIChat";

/**
 * The page in the preview, as the assistant sees it: what the person pointed
 * it at with the Assistant's Select, and how to read the page.
 *
 * A context because the two ends are far apart: the preview and its frame are
 * the Studio's (`ValShell`), the chat that sends the pick and runs the
 * assistant's tools is mounted in the shell's panel (`AIChatSurface`). Absent
 * outside the Studio -- a story, a test -- where the chat simply has no page.
 */
export type AssistantPage = {
  /**
   * Code mode: the Assistant's Select picks any element, in the proposal's
   * colour. Otherwise it picks fields, which are what can be changed.
   */
  codeMode: boolean;
  /** Whether the Assistant's Select is picking on the page. Once, then off. */
  selecting: boolean;
  setSelecting: (selecting: boolean) => void;
  /** What the next message is about: shown above the composer, removable. */
  pointedAt: PickedElement | null;
  setPointedAt: (element: PickedElement | null) => void;
  /** The page in the preview, for `read_page`: `null` while none is open. */
  readPage: () => PageReader | null;
  /** A picture of the page in the preview, for `screenshot_page`. */
  screenshotPage: () => PageCamera | null;
  /** What the page logged as going wrong, for `read_page_log`. */
  readPageLog: () => PageLogReader | null;
  /** Using the page in the preview, for `interact_page`. */
  interactPage: () => PageInteractor | null;
};

export const AssistantPageContext = createContext<AssistantPage | null>(null);

export function useAssistantPage(): AssistantPage | null {
  return useContext(AssistantPageContext);
}

/**
 * What a message is about: what was picked when it was QUEUED, if it waited
 * (`context`), and otherwise what is picked now -- which then goes with this
 * message and no other, so the pick is taken off the composer.
 */
export function takePointedAt(
  context: SendContext | undefined,
  page: Pick<AssistantPage, "pointedAt" | "setPointedAt"> | null,
): PickedElement | null {
  if (context !== undefined) return context.pointedAt;
  const pointedAt = page?.pointedAt ?? null;
  if (pointedAt !== null) page?.setPointedAt(null);
  return pointedAt;
}
