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

/**
 * How the last quick preview of some staged files ended, as whoever shows
 * them says it (`useCodeModeQuickPreview`): what a caller that staged files
 * waits on to know the person can SEE them.
 *
 * - `shown`: the page in the preview is a document made of these inputs,
 *   and it has said it is there. Not "asked for", not "built", not "loading".
 * - `served`: the build the address serves already has them; nothing to show.
 * - `failed`: they could not be shown as a quick preview (they do not
 *   bundle, the page did not take them). A build is what shows them.
 * - `off`: Val Build makes no quick previews for this project.
 */
export type StagedPreview = {
  /** The staged inputs this is about. */
  inputs: string;
  status: "shown" | "served" | "failed" | "off";
  /** Why, when `failed`. */
  message?: string;
};

let preview: StagedPreview | null = null;
const previewListeners = new Set<() => void>();

/** Say how the preview of some staged files ended: for whoever shows them. */
export function setStagedPreview(next: StagedPreview | null): void {
  preview = next;
  for (const listener of Array.from(previewListeners)) listener();
}

/** The last one said, or `null` before any. */
export function stagedPreview(): StagedPreview | null {
  return preview;
}

export function subscribeStagedPreview(listener: () => void): () => void {
  previewListeners.add(listener);
  return () => previewListeners.delete(listener);
}

/**
 * Wait until the staged files `inputs` name are in front of the person, or
 * it is known they will not be shown without a build. `timeout` after
 * `timeoutMs`: nothing was said of them -- no page in the preview to show
 * them in, someone typing in it, or newer files staged since.
 */
export function waitForStagedPreview(
  inputs: string,
  timeoutMs: number,
): Promise<StagedPreview | { inputs: string; status: "timeout" }> {
  const now = preview;
  if (now !== null && now.inputs === inputs) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = (
      answer: StagedPreview | { inputs: string; status: "timeout" },
    ) => {
      clearTimeout(timer);
      unsubscribe();
      resolve(answer);
    };
    const unsubscribe = subscribeStagedPreview(() => {
      if (preview !== null && preview.inputs === inputs) done(preview);
    });
    const timer = setTimeout(
      () => done({ inputs, status: "timeout" }),
      timeoutMs,
    );
  });
}
