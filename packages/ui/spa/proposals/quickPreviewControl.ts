import type { QuickPreviewResult } from "./proposalCode";

/**
 * The quick preview of the proposal this Studio is open in, as whoever shows
 * it registered it: the shell, whose canvas is where it is shown
 * (`useCodeModeQuickPreview`). The assistant's `quick_preview` runs it from
 * here, as its `build_proposal` runs the build from `proposalBuildStore`:
 * the chat is not inside the shell's tree, and the canvas is not inside the
 * chat's.
 *
 * `null` where there is nothing to show it in: on the site, or before the
 * canvas has mounted.
 */
export type QuickPreviewRunner = () => Promise<QuickPreviewResult>;

let runner: QuickPreviewRunner | null = null;

/** Register the quick preview; the returned function takes it back. */
export function setQuickPreviewRunner(next: QuickPreviewRunner): () => void {
  runner = next;
  return () => {
    if (runner === next) runner = null;
  };
}

/** The quick preview to run, or `null` where none can be shown. */
export function quickPreviewRunner(): QuickPreviewRunner | null {
  return runner;
}
