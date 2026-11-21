import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCurrentProposal } from "../ValProvider";
import { createProposalsClient } from "../../proposals/proposalsClient";
import { useProposalBuild } from "../../proposals/useProposalBuild";
import {
  setQuickPreviewRunner,
  setStagedPreview,
  stagedPreview,
} from "../../proposals/quickPreviewControl";
import { useSettledProjectSeq } from "../shell/canvas/useServedBuild";
import type { QuickPreviewStorer } from "../shell/canvas/CanvasFrame";
import type { CodeModeBuild } from "./CodeModeStatus";
import { useQuickPreview, type QuickPreviewState } from "./useQuickPreview";

/**
 * While the assistant works on a turn, how long its writes have to pause
 * before what is staged is shown: see {@link useCodeModeQuickPreview}.
 */
export const QUICK_PREVIEW_PAUSE_MS = 4_000;

/**
 * The quick preview in the Studio's own canvas, in a proposal: the
 * proposal's client code built by Val Build and shown on the page in seconds,
 * with what runs on the server still the last build's (`quickPreview.ts` in
 * `@valbuild/shared`).
 *
 * - **By itself**, for staged files the served build does not have, and
 *   only where Val Build makes it: never a bundle in this page or a builder
 *   tab nobody asked for, and nothing said when it fails (`useQuickPreview`'s
 *   `auto`). WHEN is the rule below.
 * - **When asked**: the assistant's `quick_preview`, registered for it in
 *   `quickPreviewControl`.
 * - **Until the next build is served**: a served build has everything a
 *   quick preview shows and what it cannot, so the canvas goes back to it.
 *
 * ## When one starts by itself
 *
 * A quick preview is a bundle made by Val Build and another document in the
 * canvas, so one per write is one per HALF of a change: the assistant's
 * edits to one change arrive seconds apart, and each used to be built and
 * loaded under the person, most of them a state the change was never meant
 * to be seen in (and often one that does not build).
 *
 * - **The assistant is not working** (the turn ended, a staging made by a
 *   person's action, or by someone else's assistant): at once. The staging
 *   is the whole change as far as this Studio knows.
 * - **The assistant is working** on a turn here: once its writes have paused
 *   for {@link QUICK_PREVIEW_PAUSE_MS}. A long turn still shows progress --
 *   the model reading, thinking, asking the person something -- and a burst
 *   of edits is one quick preview, of the last.
 * - **The turn ends**: at once, whatever the pause had left.
 * - **One is running**: after it, of the newest files, never two at once
 *   (`useQuickPreview`'s `autoAgain`).
 * - **Never twice for the same staged files**: shown is shown, and one that
 *   failed is not tried again until the files change.
 *
 * It starts from what the staging ANSWERED (`proposalStaged`, announced by
 * the proposals client): nothing is read between a staging made here and
 * the request for its quick preview. The proposal is still read when its
 * `seq` moves, which is how a staging made elsewhere is heard of, and when
 * the build store says the code moved, which is how a build is.
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
   * What is staged. From this Studio's own stagings as each answered
   * (`build.staged`), and read from the proposal whenever the code may have
   * moved some other way: a build (`changed`, `buildEpoch`), or anyone
   * else's staging -- another person's assistant staging files moves the
   * proposal's `seq`, which every Studio open on it hears of. A quick
   * preview is for staged files the served build does not have.
   */
  const build = useProposalBuild(proposals).state;
  const changed = build.changed;
  const seq = useSettledProjectSeq();
  const [staged, setStaged] = useState<{
    inputs: string;
    buildRequired: boolean;
  } | null>(null);
  const local =
    build.staged !== null && build.staged.name === name ? build.staged : null;
  const localCount = local?.count ?? 0;
  const localInputs = local?.inputs ?? null;
  const localBuildRequired = local?.buildRequired ?? false;
  /** Which of this Studio's stagings `staged` has taken in. */
  const taken = useRef(localCount);
  useEffect(() => {
    if (localCount === taken.current) return;
    taken.current = localCount;
    setStaged(
      localInputs === null
        ? null
        : { inputs: localInputs, buildRequired: localBuildRequired },
    );
  }, [localCount, localInputs, localBuildRequired]);
  /*
   * A read under way: what is known may be about to change (a build was
   * served, someone staged files), so nothing starts by itself on it.
   */
  const [reading, setReading] = useState(false);
  const lastRead = useRef<{
    name: string | null;
    seq: number | null;
    buildEpoch: number;
    count: number;
  } | null>(null);
  useEffect(() => {
    const before = lastRead.current;
    lastRead.current = { name, seq, buildEpoch, count: localCount };
    if (name === null) {
      setStaged(null);
      return;
    }
    /*
     * Only the build store moved, and a staging was made here since the
     * last read: that is the staging saying so (a code tool answers, then
     * says the code changed), and its own answer is newer than anything a
     * read would say.
     */
    if (
      before !== null &&
      before.name === name &&
      before.seq === seq &&
      before.buildEpoch === buildEpoch &&
      before.count !== localCount
    ) {
      return;
    }
    let cancelled = false;
    const readAt = taken.current;
    setReading(true);
    proposals
      .get(name)
      .then((proposal) => {
        if (cancelled) return;
        // A staging made here since this was asked answered with newer
        // files than this read may have seen: it stands.
        if (taken.current !== readAt) return;
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
      // Not read: what was known stands until it is.
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setReading(false);
      });
    return () => {
      cancelled = true;
      setReading(false);
    };
    // `localCount` is read, not followed: a staging here is taken in above.
  }, [name, proposals, changed, seq, buildEpoch]);

  const run = quick.run;
  const isShown = quick.isShown;
  const stagedInputs = staged?.inputs ?? null;
  const buildRequired = staged?.buildRequired ?? false;
  const working = build.assistantWorking;
  /** The staged files a quick preview was last started for, by itself. */
  const started = useRef<string | null>(null);
  // The served build has what is staged: said for whoever waits to know
  // the staged files are seen (`waitForStagedPreview`).
  useEffect(() => {
    if (name === null || stagedInputs === null || buildRequired || reading) {
      return;
    }
    const said = stagedPreview();
    if (said?.inputs === stagedInputs && said.status === "served") return;
    setStagedPreview({ inputs: stagedInputs, status: "served" });
  }, [name, stagedInputs, buildRequired, reading]);
  useEffect(() => {
    if (name === null || stagedInputs === null || !buildRequired) return;
    if (!pageLive || reading) return;
    if (started.current === stagedInputs || isShown(stagedInputs)) return;
    const timer = setTimeout(
      () => {
        started.current = stagedInputs;
        void run({ auto: true, inputs: stagedInputs });
      },
      working ? QUICK_PREVIEW_PAUSE_MS : 0,
    );
    return () => clearTimeout(timer);
  }, [
    name,
    stagedInputs,
    buildRequired,
    pageLive,
    reading,
    working,
    run,
    isShown,
  ]);

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
  const forgetShown = quick.forgetShown;
  const lastEpoch = useRef(buildEpoch);
  useEffect(() => {
    if (buildEpoch === lastEpoch.current) return;
    lastEpoch.current = buildEpoch;
    setDropped(shownId);
    dismiss();
    /*
     * Nothing is known of what is staged against THIS build until the
     * proposal is read again (the read above, on `buildEpoch`): a build of
     * the staged files needs no quick preview, and a build of older ones
     * needs the quick preview shown over it again.
     */
    forgetShown();
    started.current = null;
    setStaged(null);
  }, [buildEpoch, shownId, dismiss, forgetShown]);
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
