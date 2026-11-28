import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Internal, type ModuleFilePath, type SourcePath } from "@valbuild/core";
import { createStudioPublishClient } from "@valbuild/shared/publish";
import type { ComparePageView, CompareSide } from "../compare/types";
import { Spinner } from "../components/designSystem/spinner";
import { useDescriptions } from "../components/useDescriptions";
import { useFilePatchIds, useSchemas } from "../components/ValFieldProvider";
import {
  useCommittedPatches,
  useCurrentProposal,
  useModuleSourcesNowAndBase,
  usePatchSets,
  useProfilesByAuthorId,
  useValMode,
} from "../components/ValProvider";
import {
  useNavigation,
  useReviewCompareParam,
  VAL_CHANGES_ROUTE,
} from "../components/ValRouter";
import { ProposalPage } from "../proposals/ProposalPageCompare";
import { createProposalsClient } from "../proposals/proposalsClient";
import { siteOrigin } from "../proposals/sitePageUrl";
import { useProposalBuild } from "../proposals/useProposalBuild";
import type { SiteChanges } from "../proposals/useSiteChanges";
import { reviewSourcePath } from "../review/toReviewModel";
import { useValSystem } from "../stores/react/SystemContext";
import { pendingPatchSets } from "../utils/computeChangedSourcePaths";
import type { SerializedPatchSet } from "../utils/PatchSets";
import { isSourcePath } from "../utils/sourcePath";
import { ReviewPage } from "./ReviewPage";
import { toReviewCode } from "./toReviewCode";
import {
  locateInReview,
  nameReviewPanes,
  toReviewPageModel,
  type ReviewEdit,
  type ReviewModuleInput,
} from "./toReviewPageModel";
import { REVIEW_CODE_ID, type ReviewCode } from "./types";

/**
 * `/val/review`, wired up: what is about to go out, as what would change.
 *
 * Two comparisons through one page. On the site, what is published against
 * what is pending. In a proposal, the site against the proposal, saved and
 * unsaved alike, with its code changes and the pages side by side. Which one
 * it is decides only what the two sides ARE; the diff, the page and the words
 * for a change are the same (`toReviewPageModel`).
 *
 * Nothing here reverts anything. "Changes and revert" leads to
 * `/val/changes`, where the pending edits are listed as the steps they were
 * made in.
 */
export function ReviewPageRoute({
  siteChanges,
  siteUrl,
  onCode,
  renderCode,
}: {
  /** In a proposal: the site's Source against the proposal's. */
  siteChanges: SiteChanges;
  /** Where the site is served; null until the proposals list has said. */
  siteUrl: string | null;
  /** Open on the code changes: code mode's "Code changes" leads here. */
  onCode: boolean;
  /**
   * Code mode's own view of the code changes, while code mode is on. With
   * it, Code is listed even before anything is staged.
   */
  renderCode?: () => ReactNode;
}) {
  /*
   * A field writes on a pause in typing, so arriving here a moment after an
   * edit could show a diff that is missing the last word. This page's whole
   * job is to be the truth about what is going out.
   */
  const val = useValSystem();
  useEffect(() => {
    if (val === null) return;
    void val.system.patchSync.flush();
  }, [val]);

  const patchSets = usePatchSets();
  const committed = useCommittedPatches();
  const pending = useMemo<SerializedPatchSet>(
    () =>
      patchSets.status === "success"
        ? pendingPatchSets(patchSets.data, committed)
        : NO_PATCH_SETS,
    [patchSets, committed],
  );
  const proposal = useCurrentProposal();

  if (proposal !== null) {
    return (
      <ProposalReview
        name={proposal.name}
        siteChanges={siteChanges}
        siteUrl={siteUrl}
        pending={pending}
        onCode={onCode}
        renderCode={renderCode}
      />
    );
  }
  if (patchSets.status === "not-asked") {
    return <Waiting>Reading what is pending…</Waiting>;
  }
  if (patchSets.status === "error") {
    return (
      <Failed message="The pending changes could not be read.">
        {patchSets.error}
      </Failed>
    );
  }
  return <SiteReview pending={pending} />;
}

const NO_PATCH_SETS: SerializedPatchSet = [];
const NO_CODE_YET: ReviewCode = { groups: [] };

/** The site of a project: what is published against what is pending. */
function SiteReview({ pending }: { pending: SerializedPatchSet }) {
  const mode = useValMode();
  const moduleFilePaths = useMemo<ModuleFilePath[]>(
    () =>
      [...new Set(pending.map((patchSet) => patchSet.moduleFilePath))].sort(),
    [pending],
  );
  const sources = useModuleSourcesNowAndBase(moduleFilePaths);
  const schemas = useSchemas();
  const modules = useMemo<ReviewModuleInput[] | null>(() => {
    if (sources === null || schemas.status !== "success") return null;
    return moduleFilePaths.map((moduleFilePath) => ({
      moduleFilePath,
      schema: schemas.data[moduleFilePath],
      before: sources.base[moduleFilePath],
      after: sources.now[moduleFilePath],
    }));
  }, [sources, schemas, moduleFilePaths]);
  if (modules === null) return <Waiting>Reading what is pending…</Waiting>;
  return (
    <ReviewOf
      modules={modules}
      pending={pending}
      // An fs project SAVES: there is nothing outside the machine to publish to.
      left={mode === "fs" ? ON_DISK : PUBLISHED}
      right={mode === "fs" ? AFTER_SAVE : AFTER_PUBLISH}
    />
  );
}

const PUBLISHED: CompareSide = {
  label: "Published",
  caption: "What is live now",
};
const AFTER_PUBLISH: CompareSide = { label: "After publish" };
const ON_DISK: CompareSide = { label: "On disk", caption: "What is saved now" };
const AFTER_SAVE: CompareSide = { label: "After save" };
const THE_SITE: CompareSide = {
  label: "The site",
  caption: "What visitors see now",
};
const THIS_PROPOSAL: CompareSide = {
  label: "This proposal",
  caption: "What publishing it makes live",
};

/** A proposal: the site against the proposal, with its code and its pages. */
function ProposalReview({
  name,
  siteChanges,
  siteUrl,
  pending,
  onCode,
  renderCode,
}: {
  name: string;
  siteChanges: SiteChanges;
  siteUrl: string | null;
  pending: SerializedPatchSet;
  onCode: boolean;
  renderCode?: () => ReactNode;
}) {
  const staged = useReviewCode(name);
  const code = staged ?? (renderCode !== undefined ? NO_CODE_YET : undefined);
  /*
   * Without the site's address there is no left page, and with one that is
   * not a whole URL the side would resolve against THIS origin and show the
   * proposal under a heading that says the site.
   */
  const renderPage = useMemo(
    () =>
      siteUrl === null || siteOrigin(siteUrl) === null
        ? undefined
        : (page: ComparePageView) => (
            <ProposalPage siteUrl={siteUrl} page={page} />
          ),
    [siteUrl],
  );
  if (siteChanges.status === "error") {
    return (
      <Failed
        message="The site's content could not be read, so there is nothing to compare this proposal with."
        onRetry={siteChanges.retry}
      >
        {siteChanges.message}
      </Failed>
    );
  }
  if (siteChanges.status !== "ready") {
    return <Waiting>Reading the site…</Waiting>;
  }
  return (
    <ReviewOf
      /*
       * Opened on the code, which arrives after the content: the page picks
       * what it opens on once, so it is mounted again when the code is there.
       */
      key={onCode && code !== undefined ? "code" : "content"}
      modules={siteChanges.modules}
      pending={pending}
      left={THE_SITE}
      right={THIS_PROPOSAL}
      code={code}
      renderCode={renderCode}
      renderPage={renderPage}
      initialSelected={
        onCode && code !== undefined ? REVIEW_CODE_ID : undefined
      }
    />
  );
}

function ReviewOf({
  modules,
  pending,
  left,
  right,
  code,
  renderCode,
  renderPage,
  initialSelected,
}: {
  modules: ReviewModuleInput[];
  /** The pending edits: who each change is by. */
  pending: SerializedPatchSet;
  left: CompareSide;
  right: CompareSide;
  code?: ReviewCode;
  renderCode?: () => ReactNode;
  renderPage?: (page: ComparePageView) => ReactNode;
  initialSelected?: string;
}) {
  const navigation = useNavigation();
  const mode = useValMode();
  const profiles = useProfilesByAuthorId();
  const filePatchIds = useFilePatchIds();
  const edits = useMemo<ReviewEdit[]>(
    () =>
      pending.map((patchSet) => ({
        sourcePath: reviewSourcePath(patchSet),
        authorIds: patchSet.authors,
      })),
    [pending],
  );
  const unnamed = useMemo(
    () =>
      toReviewPageModel({
        modules,
        left,
        right,
        profiles,
        edits,
        /*
         * A pending upload is served by the patch that holds it. What it
         * replaces is published, and is served from where it always was.
         */
        mediaUrl: (path, side) => {
          const patchId = side === "after" ? filePatchIds.get(path) : undefined;
          return Internal.mediaUrl(
            patchId !== undefined ? { path, patch_id: patchId } : { path },
          );
        },
        ...(code !== undefined ? { code } : {}),
      }),
    [modules, left, right, profiles, edits, filePatchIds, code],
  );
  /*
   * Named in a second step: the panes have to exist before anything knows
   * which previews to ask for. One list of paths, because the count moves as
   * edits land and a hook per pane is a hook in a loop.
   */
  const panePaths = useMemo<SourcePath[]>(
    () =>
      Object.values(unnamed.panes).flatMap((pane) =>
        pane.sourcePath !== undefined && isSourcePath(pane.sourcePath)
          ? [pane.sourcePath]
          : [],
      ),
    [unnamed],
  );
  const descriptions = useDescriptions(panePaths);
  const model = useMemo(
    () =>
      nameReviewPanes(unnamed, (sourcePath) => {
        if (!isSourcePath(sourcePath)) return null;
        const description = descriptions.describe(sourcePath);
        // Only a name someone wrote. The fallback is the key, said already.
        return description.origin.title === "preview"
          ? description.title
          : null;
      }),
    [unnamed, descriptions],
  );

  /*
   * A link to one change (`?compare=<path>`): the pane it is in, and the row.
   * A link to a change that is not here opens the page as it would open
   * anyway: it shipped, or was reverted, since the link was made.
   */
  const { reviewCompare } = useReviewCompareParam();
  const linked = reviewCompare?.sourcePath ?? null;
  const focus = useMemo(
    () => (linked === null ? null : locateInReview(model, linked)),
    // Where the link lands is decided when it is followed, not on every
    // edit, so the model is deliberately not a dependency.
    [linked],
  );

  return (
    <ReviewPage
      key={linked ?? ""}
      model={model}
      initialSelected={focus?.paneId ?? initialSelected}
      initialRowId={focus?.rowId ?? null}
      onOpenChanges={() => navigation.navigate(VAL_CHANGES_ROUTE)}
      renderPage={renderPage}
      renderCode={renderCode}
      mode={mode}
    />
  );
}

/**
 * The proposal's code changes, read again whenever its code moves (a
 * staging, a build). Undefined while they are read, when there are none, and
 * when they could not be read: Review's content does not wait on its code.
 */
function useReviewCode(name: string): ReviewCode | undefined {
  const proposals = useMemo(
    () => createProposalsClient({ api: "/api/val" }),
    [],
  );
  const changed = useProposalBuild(proposals).state.changed;
  const [code, setCode] = useState<ReviewCode | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // A client per read: one keeps the first answer for the site's source.
        const publish = createStudioPublishClient({ api: "/api/val" });
        const [files, site] = await Promise.all([
          proposals.files(name),
          publish.projectSource(),
        ]);
        if (cancelled) return;
        setCode(toReviewCode(site ?? {}, files.files, files.staged.files));
      } catch (error) {
        if (cancelled) return;
        Internal.log.warn(
          "Review could not read the proposal's code changes, so it shows the content changes only.",
          error,
        );
        setCode(undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [name, proposals, changed]);
  return code;
}

function Waiting({ children }: { children: string }) {
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 py-16 text-sm text-fg-tertiary"
    >
      <Spinner size={14} />
      {children}
    </div>
  );
}

function Failed({
  message,
  onRetry,
  children,
}: {
  /** What happened, in the reader's terms. */
  message: string;
  /** Ask again. Absent where asking again cannot help. */
  onRetry?: () => void;
  /** What the request said, for support. */
  children: string;
}) {
  return (
    <div
      role="alert"
      className="mx-auto flex max-w-sm flex-col items-center gap-3 py-16 text-center"
    >
      <p className="text-sm text-fg-primary">{message}</p>
      {onRetry !== undefined && (
        <button
          type="button"
          onClick={onRetry}
          className="h-8 rounded-md border border-border-primary px-3 text-xs font-medium text-fg-primary hover:bg-bg-secondary"
        >
          Try again
        </button>
      )}
      <details className="text-xs text-fg-tertiary">
        <summary className="cursor-pointer">Details</summary>
        {children}
      </details>
    </div>
  );
}
