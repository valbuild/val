import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCurrentProposal } from "../ValProvider";
import { createProposalsClient } from "../../proposals/proposalsClient";
import { useProposalBuild } from "../../proposals/useProposalBuild";
import { setQuickPreviewRunner } from "../../proposals/quickPreviewControl";
import { useSettledProjectSeq } from "../shell/canvas/useServedBuild";
import type { QuickPreviewStorer } from "../shell/canvas/CanvasFrame";
import type { CodeModeBuild } from "./CodeModeStatus";
import { useQuickPreview, type QuickPreviewState } from "./useQuickPreview";

/** How long after the staged files stop changing they are shown as a quick preview. */
export const AUTO_QUICK_PREVIEW_DELAY_MS = 1_000;

/**
 * The quick preview in the Studio's own canvas, in a proposal: the
 * proposal's client code built by Val Build and shown on the page in seconds,
 * with what runs on the server still the last build's (`quickPreview.ts` in
 * `@valbuild/shared`).
 *
 * - **By itself**, a second after the staged files stop changing -- the
 *   assistant's `write_files`, or anyone's -- and only where Val Build makes
 *   it: never a bundle in this page or a builder tab nobody asked for, and
 *   nothing said when it fails (`useQuickPreview`'s `auto`).
 * - **When asked**: the assistant's `quick_preview`, registered for it in
 *   `quickPreviewControl`.
 * - **Until the next build is served**: a served build has everything a
 *   quick preview shows and what it cannot, so the canvas goes back to it.
 *
 * The shell owns it because the canvas is the shell's: it opens the page as
 * `quickId` (`CanvasFrame`'s `quickPreviewId`), hands the frame's storer in,
 * and passes on which document the page says it is (`onDocument`), which is
 * when a quick preview is in front.
 */
export function useCodeModeQuickPreview({
  pageLive,
  buildEpoch,
}: {
  /** The page in the canvas answers: it is what takes the files. */
  pageLive: boolean;
  /** Moves when another build is served (`useBuildEpoch`). */
  buildEpoch: number;
}): {
  /** The quick preview the canvas should open, or `null` for the served build. */
  quickId: string | null;
  setStorer: (store: QuickPreviewStorer | null) => void;
  /**
   * A page in the canvas said it is there, and which quick preview it is
   * (`CanvasFrame`'s `onDocument`): that one is in front.
   */
  onDocument: (document: { quick: string | null }) => void;
  state: QuickPreviewState;
  /** The canvas shows a quick preview rather than the served build. */
  shown: boolean;
} {
  const here = useCurrentProposal();
  const name = here?.name ?? null;
  const proposals = useMemo(
    () => createProposalsClient({ api: "/api/val" }),
    [],
  );
  const quick = useQuickPreview(name ?? "", proposals);

  /*
   * What is staged, read again whenever the code moves: a staging or a build
   * from this Studio (`changed`), or from anyone's -- another person's
   * assistant staging files moves the proposal's `seq`, which every Studio
   * open on it hears of. A quick preview is for staged files the served
   * build does not have.
   */
  const changed = useProposalBuild(proposals).state.changed;
  const seq = useSettledProjectSeq();
  const [staged, setStaged] = useState<{
    inputs: string;
    buildRequired: boolean;
  } | null>(null);
  useEffect(() => {
    if (name === null) {
      setStaged(null);
      return;
    }
    let cancelled = false;
    proposals
      .get(name)
      .then((proposal) => {
        if (cancelled) return;
        const inputs = proposal.staged?.inputs ?? null;
        setStaged(
          proposal.status === "open" && inputs !== null
            ? {
                inputs,
                buildRequired: proposal.staged?.buildRequired ?? false,
              }
            : null,
        );
      })
      // Not read: no quick preview by itself until it is.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [name, proposals, changed, seq]);

  const run = quick.run;
  const stagedInputs = staged?.inputs ?? null;
  const buildRequired = staged?.buildRequired ?? false;
  useEffect(() => {
    if (name === null || stagedInputs === null || !buildRequired) return;
    if (!pageLive) return;
    const timer = setTimeout(
      () => void run({ auto: true }),
      AUTO_QUICK_PREVIEW_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [name, stagedInputs, buildRequired, pageLive, run]);

  // The assistant's `quick_preview`.
  useEffect(() => {
    if (name === null) return;
    return setQuickPreviewRunner(() => run());
  }, [name, run]);

  /*
   * A build served after a quick preview was shown: the canvas goes back to
   * the served build, which has all of it, and a failure is forgotten.
   */
  const [dropped, setDropped] = useState<string | null>(null);
  const shownId = quick.shownId;
  const dismiss = quick.dismiss;
  const lastEpoch = useRef(buildEpoch);
  useEffect(() => {
    if (buildEpoch === lastEpoch.current) return;
    lastEpoch.current = buildEpoch;
    setDropped(shownId);
    dismiss();
  }, [buildEpoch, shownId, dismiss]);
  const quickId = name !== null && shownId !== dropped ? shownId : null;

  /*
   * What the page in the canvas IS, as it says when it loads: a document
   * swapped in can wait while someone uses the page (`CanvasFrame`), so
   * what was asked for is not yet what is shown.
   */
  const [shown, setShown] = useState(false);
  const front = quick.onFront;
  const onDocument = useCallback(
    (document: { quick: string | null }) => {
      setShown(document.quick !== null);
      front(document);
    },
    [front],
  );

  return {
    quickId,
    setStorer: quick.setStorer,
    onDocument,
    state: quick.state,
    shown,
  };
}

/**
 * Code mode's status, with the quick preview in it: while the change is
 * not built yet ("behind"), the preview can still show it -- being shown,
 * or shown.
 */
export function withQuickPreviewState(
  build: CodeModeBuild,
  quick: { state: QuickPreviewState; shown: boolean },
): CodeModeBuild {
  if (build.state !== "behind") return build;
  if (quick.state.status === "running") return { state: "previewing" };
  if (quick.shown) return { state: "quick" };
  return build;
}
