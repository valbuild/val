import {
  Internal,
  ModuleFilePath,
  PatchId,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import { HotspotMarker } from "./fields/HotspotMarker";
import { deepEqual, ReadonlyJSONValue } from "@valbuild/core/patch";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { usePatchSetsWorker } from "../patchsets/usePatchSetsWorker";
import classNames from "classnames";
import {
  ArrowRight,
  Check,
  ChevronDown,
  CircleAlert,
  ChevronRight,
  Equal,
  History,
  Lock,
  Minus,
  Pencil,
  Plus,
  Save,
  Undo2,
  User,
  Loader2,
} from "lucide-react";
import { SerializedPatchSet } from "../utils/PatchSets";
import {
  ChangeTreeNode,
  ChangeTreePatch,
  ChangeType,
} from "../utils/computeChangedSourcePaths";
import type { SourceOverride } from "./ValFieldProvider";
import {
  FieldSourceOverrideContext,
  useFilePatchIds,
  useSchemaAtPath,
  useSchemaWithResolvedPath,
  useSchemas,
  useServerSourceAtPath,
  useSourceAtPath,
} from "./ValFieldProvider";
import { getFilenameFromRef, getRefParts } from "../utils/getFilenameFromRef";
import {
  useCommittedPatches,
  useCurrentAuthorId,
  useDeletePatches,
  useNoOpSourcePaths,
  useDeployingCommitShas,
  useDeployments,
  Profile,
} from "./ValProvider";
import type { ValEnrichedDeployment } from "../utils/mergeCommitsAndDeployments";
import { relativeLocalDate } from "../utils/relativeLocalDate";
import { discardAllDescription } from "./discardAllDescription";
import { useValPortal } from "./ValPortalProvider";
import { AnyField } from "./AnyField";
import { PrimitiveListDiff } from "./PrimitiveListDiff";
import { AuthorPatchInfo, FieldPatchAuthorsPure } from "./FieldPatchAuthors";
import { Button } from "./designSystem/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./designSystem/popover";
import { Skeleton } from "./designSystem/skeleton";
import { getInitials } from "../utils/getInitials";
import { prettifyFilename } from "../utils/prettifyFilename";
import { prettifyModulePath } from "../utils/prettifyText";
import { FieldPathLink } from "./FieldPathLink";
import { useNavLink } from "./navLink";
import { refToUrl } from "./MediaPicker/refToUrl";
import {
  HeldSummary,
  StagingBulkActions,
  StagingToggle,
} from "./StagingToggle";
import { splitTreesByStaging } from "../utils/splitTreesByStaging";
import { usePatchStaging } from "./PatchStagingProvider";

/**
 * ComparePatchSets renders a "review changes" view over a `SerializedPatchSet`.
 *
 * Visual model
 * ------------
 * - One card per module file. Each row inside is a single patch set that can
 *   be discarded independently of any other.
 * - Color lives only on a 3px coloured left rail per change-side: green for
 *   added/after, red for removed/before. There are no fills.
 * - Field-level edits (`field-change`) render in a side-by-side "Before /
 *   After" grid at >=lg breakpoints; below that they stack with the same
 *   rails.
 * - Wholesale add/remove of a node renders as a single column capped at
 *   `max-w-xl`, always left-aligned, so its rail aligns with the "Before"
 *   rail in the side-by-side rows above it.
 *
 * Page-level chrome (titles, global Publish/Discard) is intentionally NOT
 * part of this component — it lives in the surrounding screen.
 *
 * Nothing here is editable
 * ------------------------
 * Every field this view renders is `readonly`, without exception, and the fields
 * are not a way in. It used to be possible to type into the "After" side, which
 * reads as a feature and is not one: the value under the cursor is the result of
 * a chain of patch sets, each with its own author and its own Discard button, so
 * an edit made here belongs to none of them and lands as yet another patch on
 * top — while the row it was typed into goes on describing the change it used to
 * describe. Reviewing and editing are different jobs; this view does the first
 * one, and the editor is one click away on the row's own link.
 *
 * `canDiscard` is therefore about the DISCARD controls only. It was one boolean
 * for both, which is why turning editing off would have taken discarding with
 * it — and discarding is what this view is for.
 *
 * The deploy line
 * ---------------
 * In `http` mode a published patch STAYS in the chain and is re-applied until the
 * commit it went out in has been deployed and the server drops it. So this view
 * shows two different things at once: work that is still yours, and work that is
 * already on its way to production. They are separated by a divider, the
 * committed side comes second, and its discard controls are gone rather than
 * disabled — the commit exists, and there is nothing a Discard button could
 * honestly do about it. Editing the field and publishing again is the way back.
 *
 * The trees arrive already grouped and ordered for this: see
 * `computeChangedSourcePaths`, which splits a patch set that holds both kinds and
 * sorts the unshipped side first.
 */
export function ComparePatchSets({
  patchSets,
  profilesByAuthorIds,
  mode = "unknown",
  canDiscard = false,
  reloadKey,
  committedPatchIds,
  deployment,
}: {
  patchSets: SerializedPatchSet;
  profilesByAuthorIds: Record<string, Profile>;
  mode?: "fs" | "http" | "unknown";
  canDiscard?: boolean;
  /**
   * Change to rebuild the view from scratch instead of leaving the previous
   * result on screen while the new one is computed. See `usePatchSetsWorker`.
   */
  reloadKey?: unknown;
  /**
   * Which patches have shipped, when the caller already knows.
   *
   * Read from the store otherwise, which is what the app does. The override is
   * for a story or a test rendering this without a mounted system.
   */
  committedPatchIds?: ReadonlySet<PatchId>;
  /**
   * The deploy the divider should describe, when the caller already knows.
   *
   * Read from `ValContext` otherwise. Present-but-null is a real answer — "shipped,
   * and the deploy feed has nothing on it yet" — so this is distinguished by being
   * PASSED at all, which is what lets a story render the line without standing up
   * a `ValProvider`.
   */
  deployment?: ValEnrichedDeployment | null;
}) {
  const portalContainer = useValPortal();
  const schemas = useSchemas();
  const storeCommittedPatchIds = useCommittedPatches();
  const committed = committedPatchIds ?? storeCommittedPatchIds;
  const { trees, isComputing, hasComputed } = usePatchSetsWorker(
    patchSets,
    reloadKey,
    committed,
  );

  const flatRows = useMemo(() => trees.flatMap(flattenChanges), [trees]);
  const summary = useCompareSummary(trees);

  /*
   * Which modules are pending work that amounts to nothing.
   *
   * Asked once, for every pending tree at once, rather than per row: the rows
   * inside a module already ask it for their own "Unchanged" badge, but the
   * decision to leave a module OUT of the list has to be made where the list
   * is, and a whole-list view must not take a subscription per row.
   *
   * Committed trees are never candidates. Their two sides are equal BECAUSE
   * the change shipped, which is the opposite of nothing having happened.
   */
  const pendingModulePaths = useMemo(
    () =>
      trees
        .filter((tree) => !tree.isCommitted)
        .map((tree) => tree.sourcePath as SourcePath),
    [trees],
  );
  const noOpModulePaths = useNoOpSourcePaths(pendingModulePaths);
  const { changing, reverted, committedTrees } = useMemo(() => {
    const changing: ChangeTreeNode[] = [];
    const reverted: ChangeTreeNode[] = [];
    const committedTrees: ChangeTreeNode[] = [];
    for (const tree of trees) {
      if (tree.isCommitted) committedTrees.push(tree);
      else if (noOpModulePaths.has(tree.sourcePath as SourcePath)) {
        reverted.push(tree);
      } else changing.push(tree);
    }
    return { changing, reverted, committedTrees };
  }, [trees, noOpModulePaths]);
  const revertedPatchIds = useMemo(
    () => collectPatchIds(reverted.flatMap(flattenChanges)),
    [reverted],
  );
  /*
   * Every unshipped patch, straight off the patch sets.
   *
   * Not every no-op leaves a TREE to notice. `determineChangeType` returns
   * `null` for an add followed by a remove at the same path — the two cancel,
   * so there is nothing to describe — and `insertHalf` drops the patch set
   * entirely. A chain made only of those produces no trees at all, which used
   * to take the "No pending changes" path: the patches were real, Publish was
   * disabled, and the view said there was nothing there and offered no way to
   * clear it. So the empty case is answered from the patch sets, which still
   * know about them, rather than from the trees, which by design do not.
   */
  const unshippedPatches = useMemo(() => {
    const ids: PatchId[] = [];
    const authors = new Set<string>();
    const seen = new Set<string>();
    for (const set of patchSets) {
      for (const patch of set.patches) {
        if (committed.has(patch.patchId) || seen.has(patch.patchId)) continue;
        seen.add(patch.patchId);
        ids.push(patch.patchId);
        if (patch.author !== null) authors.add(patch.author);
      }
    }
    return { ids, authorIds: [...authors] };
  }, [patchSets, committed]);
  // Until the first result is in, an empty `trees` means "not computed yet",
  // not "nothing changed": showing the empty state here would flash "No
  // pending changes" at every reader before the real changes appear. Once
  // there is a result, keep it on screen while a recomputation runs - the
  // changes are still the ones the reader is looking at.
  if (!hasComputed || (isComputing && trees.length === 0)) {
    return <CompareLoading />;
  }

  if (flatRows.length === 0) {
    // Patches with nothing to show for them still have to be reachable: this
    // is the add-then-remove chain, where the grouping deliberately produces
    // no rows. See `unshippedPatches`.
    if (unshippedPatches.ids.length > 0) {
      return (
        <div className="mx-auto max-w-7xl min-w-0">
          <AllRevertedNotice
            patchIds={unshippedPatches.ids}
            authorIds={unshippedPatches.authorIds}
            profilesByAuthorIds={profilesByAuthorIds}
            canDiscard={canDiscard}
            portalContainer={portalContainer}
          />
        </div>
      );
    }
    return (
      <div className="text-sm text-fg-secondary py-8 text-center">
        No pending changes.
      </div>
    );
  }

  const schemasData = schemas.status === "success" ? schemas.data : undefined;

  return (
    /*
     * `min-w-0`, not a minimum width.
     *
     * This was `min-w-[380px]`, which is wider than the content box of a 360px
     * phone — so the whole review view scrolled sideways before a single change
     * had been read. The rows inside stack below `lg` and are fine at any width;
     * the floor was protecting nothing.
     */
    <div className="mx-auto max-w-7xl flex flex-col gap-6 lg:gap-8 min-w-0">
      {/*
       * The summary, always, because this view is the whole column.
       *
       * It used to be the surrounding screen's job — the classic layout kept the
       * strip in its sticky header — and the shell, which has no header, simply
       * never rendered one. So the count was missing and there was no way to
       * discard everything at all in the layout the Studio opens in.
       */}
      <CompareSummaryStrip
        authorIds={summary.authorIds}
        pendingAuthorIds={summary.pendingAuthorIds}
        profilesByAuthorIds={profilesByAuthorIds}
        mode={mode}
        pendingPatchIds={summary.pendingPatchIds}
        deployingCount={summary.deployingCount}
        canDiscard={canDiscard}
        portalContainer={portalContainer}
      />
      {/*
       * Nothing here will ship — said plainly, where the changes would be.
       *
       * Publish is disabled in this state, so Discard is the only way forward
       * and it has to be in reach rather than in a menu. Without this the view
       * showed a list of rows with the same value on both sides and a dead
       * Publish button, which reads as the Studio having lost the changes.
       */}
      {changing.length === 0 && reverted.length > 0 && (
        <AllRevertedNotice
          patchIds={revertedPatchIds}
          authorIds={summary.pendingAuthorIds}
          profilesByAuthorIds={profilesByAuthorIds}
          canDiscard={canDiscard}
          portalContainer={portalContainer}
        />
      )}
      {/*
       * Only `changing` is split into Staged / Unstaged. A committed tree has
       * already shipped and a reverted one has no net change to publish, so
       * neither is something a person can stage or unstage — offering the
       * choice there would be offering a control that cannot do anything.
       */}
      <StagedSections
        trees={changing}
        profilesByAuthorIds={profilesByAuthorIds}
        portalContainer={portalContainer}
        mode={mode}
        schemas={schemasData}
        canDiscard={canDiscard}
      />
      {reverted.length > 0 && (
        <RevertedHistory count={revertedPatchIds.length}>
          {reverted.map((tree) => (
            <ModuleGroup
              key={`reverted-${tree.sourcePath}`}
              tree={tree}
              profilesByAuthorIds={profilesByAuthorIds}
              portalContainer={portalContainer}
              mode={mode}
              schemas={schemasData}
              canDiscard={canDiscard}
            />
          ))}
        </RevertedHistory>
      )}
      {committedTrees.length > 0 &&
        (deployment === undefined ? (
          <DeployedDivider />
        ) : (
          <DeployedDividerPure deployment={deployment} />
        ))}
      {committedTrees.map((tree) => (
        <ModuleGroup
          key={`committed-${tree.sourcePath}`}
          tree={tree}
          profilesByAuthorIds={profilesByAuthorIds}
          portalContainer={portalContainer}
          mode={mode}
          schemas={schemasData}
          canDiscard={canDiscard}
        />
      ))}
    </div>
  );
}

type SectionProps = {
  /** The trees with a real pending change — not committed, not reverted. */
  trees: ChangeTreeNode[];
  profilesByAuthorIds: Record<string, Profile>;
  portalContainer: HTMLElement | null;
  mode: "fs" | "http" | "unknown";
  schemas: Record<ModuleFilePath, SerializedSchema> | undefined;
  canDiscard: boolean;
};

/**
 * The module list, split into what will publish and what is held back.
 *
 * Two sections only when staging is on. With it off — FS mode, or a content API
 * without patch groups — this renders exactly the flat list it always did, which
 * is the point: the section headers describe a choice that cannot be made there,
 * and chrome for an absent feature is worse than no chrome.
 *
 * Staged first. It is what Publish will ship, so it is what a person opening this
 * screen is deciding about; the held section is the exception below it.
 *
 * The deploy divider lives in the staged section. A committed patch has shipped,
 * so it is not held by anyone and could not be — there is nothing to unstage.
 */
function StagedSections({
  trees,
  profilesByAuthorIds,
  portalContainer,
  mode,
  schemas,
  canDiscard,
}: SectionProps) {
  const staging = usePatchStaging();
  const { staged, held } = useMemo(
    () =>
      staging.enabled
        ? splitTreesByStaging(trees, staging.stateOf)
        : { staged: trees, held: [] },
    [trees, staging.enabled, staging.stateOf],
  );

  const renderTrees = (list: ChangeTreeNode[], side: "staged" | "held") =>
    list.map((tree) => (
      <ModuleGroup
        key={`${side}-${tree.sourcePath}`}
        tree={tree}
        profilesByAuthorIds={profilesByAuthorIds}
        portalContainer={portalContainer}
        mode={mode}
        schemas={schemas}
        canDiscard={canDiscard}
      />
    ));

  if (!staging.enabled) {
    return <>{renderTrees(staged, "staged")}</>;
  }

  return (
    <>
      <SectionHeading
        title="Staged"
        detail="Publish ships these."
        count={countRows(staged)}
        actions={
          <StagingBulkActions
            patchIds={collectPatchIds(staged.flatMap(flattenChanges))}
            profilesByAuthorIds={profilesByAuthorIds}
            side="staged"
          />
        }
      />
      {staged.length === 0 ? (
        <EmptySection>
          Nothing is staged, so Publish has nothing to ship. Stage a change
          below to publish it.
        </EmptySection>
      ) : (
        renderTrees(staged, "staged")
      )}
      <SectionHeading
        title="Unstaged"
        detail="Held back. These stay pending and can be staged again."
        count={countRows(held)}
        actions={
          <StagingBulkActions
            patchIds={collectPatchIds(held.flatMap(flattenChanges))}
            profilesByAuthorIds={profilesByAuthorIds}
            side="held"
          />
        }
      />
      {held.length === 0 ? (
        <EmptySection>Nothing is held back.</EmptySection>
      ) : (
        renderTrees(held, "held")
      )}
    </>
  );
}

function countRows(trees: ChangeTreeNode[]): number {
  return trees.flatMap(flattenChanges).length;
}

function SectionHeading({
  title,
  detail,
  count,
  actions,
}: {
  title: string;
  detail: string;
  count: number;
  /** Bulk stage/unstage for this section. Renders nothing when it is empty. */
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-border-primary pb-2">
      <span className="text-sm font-medium text-fg-primary">{title}</span>
      <span className="text-sm text-fg-tertiary tabular-nums">{count}</span>
      <span className="text-xs text-fg-tertiary truncate">{detail}</span>
      {/*
       * `ml-auto` on the actions rather than a spacer, and `flex-wrap` above, so a
       * narrow screen drops the buttons to their own line instead of squeezing the
       * heading — the buttons are the widest thing here once there are per-author
       * ones.
       */}
      <span className="ml-auto">{actions}</span>
    </div>
  );
}

function EmptySection({ children }: { children: ReactNode }) {
  return <div className="text-xs text-fg-tertiary px-1">{children}</div>;
}

/**
 * The display names behind a set of author ids, for a confirm that names names.
 *
 * Everyone but you: the sentence these feed is about work that is not yours, so
 * your own name in it is noise at best, and at worst it makes a project where
 * you are the only editor read as if someone else had a stake in the changes.
 *
 * Ids with no profile are dropped rather than shown raw: a discard confirm is
 * not the place to show someone a uuid.
 */
function useAuthorNames(
  authorIds: string[],
  profilesByAuthorIds: Record<string, Profile> | undefined,
): string[] {
  const currentAuthorId = useCurrentAuthorId();
  return useMemo(
    () =>
      authorIds
        .filter((id) => id !== currentAuthorId)
        .map((id) => profilesByAuthorIds?.[id]?.fullName)
        .filter((name): name is string => !!name),
    [authorIds, profilesByAuthorIds, currentAuthorId],
  );
}

/**
 * The banner for "every pending change cancels itself out".
 *
 * This is a state the Studio could previously only express by contradiction: a
 * list of rows each showing the same value twice, above a Publish button that
 * would not press. Saying it once, and putting Discard next to the sentence, is
 * the whole fix — the changes themselves are still reachable under History.
 */
function AllRevertedNotice({
  patchIds,
  authorIds,
  profilesByAuthorIds,
  canDiscard,
  portalContainer,
}: {
  patchIds: PatchId[];
  authorIds: string[];
  profilesByAuthorIds: Record<string, Profile> | undefined;
  canDiscard: boolean;
  portalContainer: HTMLElement | null;
}) {
  const { deletePatches } = useDeletePatches();
  const authorNames = useAuthorNames(authorIds, profilesByAuthorIds);
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border-primary bg-bg-secondary px-4 py-3 sm:flex-row sm:items-center">
      <Equal size={16} className="shrink-0 text-fg-secondary" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-fg-primary">
          {patchIds.length === 1
            ? "The one pending change has been reverted."
            : "Every pending change has been reverted."}
        </p>
        <p className="text-xs text-fg-secondary">
          The content matches what is published, so there is nothing to publish.
        </p>
      </div>
      {canDiscard && patchIds.length > 0 && (
        <DiscardConfirmPopover
          description={discardAllDescription(patchIds.length, authorNames)}
          title={`Discard ${patchIds.length} ${
            patchIds.length === 1 ? "change" : "changes"
          }?`}
          confirmLabel={`Discard ${patchIds.length}`}
          onConfirm={() => deletePatches(patchIds)}
          portalContainer={portalContainer}
          ariaLabel={`Discard all ${patchIds.length} reverted ${
            patchIds.length === 1 ? "change" : "changes"
          }`}
          label="Discard all"
        />
      )}
    </div>
  );
}

/**
 * Reverted work, folded away but not thrown away.
 *
 * Collapsed by default: it is by definition not what the reader came to review.
 * Kept, and kept discardable, because the patches are real — they are in the
 * chain, they belong to someone, and until they are discarded they are the
 * reason Publish is off.
 */
function RevertedHistory({
  count,
  children,
}: {
  /**
   * Patches, not modules — the unit every other count in this view uses. The
   * summary strip and Review's badge both count patches, and a disclosure that
   * counted something else would look like a disagreement.
   */
  count: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="flex flex-col gap-4">
      <button
        type="button"
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        aria-expanded={open}
        className="flex items-center gap-2 self-start rounded-md px-1 py-1 text-xs text-fg-secondary hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
      >
        <ChevronRight
          size={14}
          aria-hidden
          className={classNames("transition-transform", {
            "rotate-90": open,
          })}
        />
        <History size={13} aria-hidden />
        <span>
          {count === 1 ? "1 reverted change" : `${count} reverted changes`}
        </span>
      </button>
      {open && <div className="flex flex-col gap-6 lg:gap-8">{children}</div>}
    </section>
  );
}

/**
 * Everything the summary strip needs, counted once.
 *
 * Shared by this view and by the classic layout's sticky header, which is the
 * point: two copies of "what is the total" is two places for the number under
 * Discard to stop agreeing with the number beside it. Derived from the TREES
 * rather than from the flat rows, because which side of the deploy line a change
 * is on is a property of its tree.
 */
function useCompareSummary(trees: ChangeTreeNode[]): {
  authorIds: string[];
  pendingAuthorIds: string[];
  pendingPatchIds: PatchId[];
  deployingCount: number;
} {
  return useMemo(() => {
    const pendingRows = trees
      .filter((tree) => !tree.isCommitted)
      .flatMap(flattenChanges);
    const committedRows = trees
      .filter((tree) => tree.isCommitted)
      .flatMap(flattenChanges);
    return {
      authorIds: collectAuthorIds(trees.flatMap(flattenChanges)),
      pendingAuthorIds: collectAuthorIds(pendingRows),
      pendingPatchIds: collectPatchIds(pendingRows),
      deployingCount: collectPatchIds(committedRows).length,
    };
  }, [trees]);
}

/**
 * Every patch id in these rows, once, in the order they were met.
 */
function collectPatchIds(rows: ChangeTreeNode[]): PatchId[] {
  const ids: PatchId[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const id of row.change?.patchIds ?? []) {
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
  }
  return ids;
}

/** Every author in these rows, once, in the order they were met. */
function collectAuthorIds(rows: ChangeTreeNode[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const id of row.change?.authors ?? []) {
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
  }
  return ids;
}

/**
 * Loading placeholder for the compare view.
 *
 * Exported so that every stage before the changes can be rendered - waiting
 * for the sync engine, waiting for the patch sets to be turned into change
 * trees - shows the same thing. Swapping between differently shaped
 * placeholders on the way to the content is the flicker this replaces.
 */
export function CompareLoading() {
  return (
    <div
      className="mx-auto max-w-7xl flex flex-col gap-8 min-w-[380px]"
      aria-busy="true"
      aria-live="polite"
      aria-label="Loading changes"
    >
      {/*
       * Said as well as drawn.
       *
       * The skeleton alone reads as "something will appear here", which is not
       * the same as knowing that the comparison is being built — and building it
       * is the slow part on a long chain. Shown only before the FIRST result:
       * afterwards the previous comparison stays on screen while a new one
       * computes, because swapping to a placeholder for content that is still
       * accurate is the flicker this whole file is careful about.
       */}
      <p className="flex items-center gap-2 text-sm text-fg-secondary">
        <Loader2 size={14} className="animate-spin" aria-hidden />
        Building the comparison…
      </p>
      {[0, 1].map((i) => (
        <section
          key={i}
          className="border border-border-primary rounded-lg bg-bg-primary overflow-hidden"
        >
          <header className="flex items-center gap-2 px-5 py-4 border-b border-border-primary">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="ml-auto h-6 w-6 rounded-full" />
          </header>
          <div className="divide-y divide-border-primary">
            {[0, 1].map((j) => (
              <div key={j} className="px-5 py-4 flex flex-col gap-3">
                <Skeleton className="h-3 w-32" />
                <div className="grid gap-4 lg:grid-cols-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// #region SummaryStrip

/**
 * The count, who made the changes, and the one control that throws them away.
 *
 * The pending patches and the shipped ones are counted SEPARATELY by the caller
 * rather than filtered apart in here, because the strip has to be able to say
 * "1 change to review · 2 deploying" — and because what Discard offers is the
 * pending subset and nothing else. A committed patch has shipped; a button
 * claiming to undo it would be lying.
 */
function CompareSummaryStrip({
  authorIds,
  pendingAuthorIds,
  profilesByAuthorIds,
  mode,
  pendingPatchIds,
  deployingCount,
  canDiscard,
  portalContainer,
}: {
  /** Everyone whose work is on screen — the avatar stack shows all of them. */
  authorIds: string[];
  /**
   * Everyone whose work Discard would actually throw away.
   *
   * Separate from `authorIds` because the confirm names names, and naming the
   * author of a change that is deploying — one this button cannot touch — would
   * be describing the wrong act. Defaults to `authorIds`, which is the same list
   * whenever nothing has shipped.
   */
  pendingAuthorIds?: string[];
  profilesByAuthorIds: Record<string, Profile>;
  mode: "fs" | "http" | "unknown";
  /** The patches Discard would remove. Never includes a committed one. */
  pendingPatchIds: PatchId[];
  /** How many of the patches on screen have shipped and are on their way out. */
  deployingCount: number;
  canDiscard: boolean;
  portalContainer: HTMLElement | null;
}) {
  const { deletePatches } = useDeletePatches();
  const authorNames = useAuthorNames(
    pendingAuthorIds ?? authorIds,
    profilesByAuthorIds,
  );

  /*
   * "0 changes to review" when there is nothing at all.
   *
   * Only the DEPLOYING count switches the wording, and only when there is
   * something deploying — testing `pendingPatchIds.length === 0` alone made an
   * empty project read "0 changes deploying", which the classic layout's header
   * renders as soon as the grouping is computed.
   */
  const isAllDeploying = pendingPatchIds.length === 0 && deployingCount > 0;
  const count = isAllDeploying ? deployingCount : pendingPatchIds.length;

  /*
   * Two rows on a phone, one from `sm` up.
   *
   * At 336px of content the single row had to give something up, and what it gave
   * up was the Discard button's label — leaving a bare undo arrow beside other
   * people's avatars as the control that throws away the whole project's
   * unpublished work. The count and the faces belong together; the action and
   * what it acts on belong together; so the break goes between those pairs.
   */
  return (
    <div className="flex flex-1 min-w-0 flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-xl font-medium leading-none text-fg-primary tabular-nums">
          {count}
        </span>
        <span className="text-sm text-fg-secondary truncate">
          {isAllDeploying
            ? `${count === 1 ? "change" : "changes"} deploying`
            : `${count === 1 ? "change" : "changes"} to review`}
        </span>
        <span className="ml-auto sm:hidden">
          <AvatarStack
            authorIds={authorIds}
            profilesByAuthorIds={profilesByAuthorIds}
            mode={mode}
          />
        </span>
      </div>
      <HeldSummary />
      <div className="flex items-center gap-3 shrink-0 sm:ml-auto border-t border-border-primary pt-2 sm:border-t-0 sm:pt-0">
        {deployingCount > 0 && pendingPatchIds.length > 0 && (
          <span className="text-xs text-fg-tertiary whitespace-nowrap">
            {deployingCount} deploying
          </span>
        )}
        {canDiscard && pendingPatchIds.length > 0 && (
          <DiscardConfirmPopover
            description={discardAllDescription(
              pendingPatchIds.length,
              authorNames,
            )}
            title={`Discard ${pendingPatchIds.length} ${
              pendingPatchIds.length === 1 ? "change" : "changes"
            }?`}
            confirmLabel={`Discard ${pendingPatchIds.length}`}
            onConfirm={() => deletePatches(pendingPatchIds)}
            portalContainer={portalContainer}
            ariaLabel={`Discard all ${pendingPatchIds.length} pending ${
              pendingPatchIds.length === 1 ? "change" : "changes"
            }`}
            label="Discard all"
          />
        )}
        {/*
         * Said rather than left as a missing button.
         *
         * Everything is deploying, so there is nothing Discard could act on — and
         * a control that is simply absent reads as a bug in a view that had one a
         * moment ago.
         */}
        {canDiscard && pendingPatchIds.length === 0 && deployingCount > 0 && (
          <span className="inline-flex items-center gap-1.5 text-xs text-fg-tertiary whitespace-nowrap">
            <Lock size={12} aria-hidden />
            Nothing left to discard
          </span>
        )}
        <span className="ml-auto hidden sm:inline-flex">
          <AvatarStack
            authorIds={authorIds}
            profilesByAuthorIds={profilesByAuthorIds}
            mode={mode}
          />
        </span>
      </div>
    </div>
  );
}
// #region DeployedDivider

/**
 * The line between work that is still yours and work that has shipped.
 *
 * Drawn once, above the first committed module, and it carries the deploy rather
 * than merely labelling the side: the same feed the status bar reads
 * (`useDeployments`), so the two cannot end up saying different things about the
 * same commit. A deploy that failed still locks what is below it — the commit
 * exists either way, which is the whole reason those patches cannot be discarded.
 *
 * On a phone the pill becomes a full-width banner. The text is around 420px set
 * on one line, so as a centred pill between two rules it would either truncate
 * the commit or scroll the view sideways; as a banner it gets two lines, and the
 * reason gets to be a sentence instead of an aside.
 */
function DeployedDivider() {
  const { deployments } = useDeployments();
  const commitShas = useDeployingCommitShas();
  /*
   * The deploy for THIS commit, not the newest one in the feed.
   *
   * `commitShas` comes off the patches themselves, so it names the commits the
   * patches below the line actually went out in. The feed is then searched for a
   * matching entry: it may have none — dismissed, or not reported yet — in which
   * case the line still names the commit and simply says nothing about its state,
   * which is better than confidently reporting another commit's.
   */
  const deployment = useMemo(() => {
    for (const sha of commitShas) {
      const match = deployments.find((d) => d.commitSha === sha);
      if (match) return match;
    }
    return null;
  }, [deployments, commitShas]);
  return (
    <DeployedDividerPure deployment={deployment} commitShas={commitShas} />
  );
}

/**
 * The divider, given the deploy rather than reading it.
 *
 * Split out for the same reason `FieldPatchAuthorsPure` is: the connected version
 * reads `ValContext`, which throws outside a `ValProvider`, and a story or a test
 * that wants to see the deploy line should not have to stand up the whole
 * provider tree to get one.
 */
function DeployedDividerPure({
  deployment: latest,
  commitShas = [],
}: {
  deployment: ValEnrichedDeployment | null;
  /**
   * The commits the patches below the line shipped in, newest first.
   *
   * Named separately from `deployment` because the two can disagree about how
   * much is down there: one deploy entry can be found while the patches span two
   * commits, and then naming a single sha would be describing only half of them.
   */
  commitShas?: string[];
}) {
  const [now] = useState(() => new Date());
  const state = latest?.deploymentState;
  const isBuilding = state === "created" || state === "pending";
  const isFailed = state === "failure" || state === "error";
  const isLive = state === "success";

  const title = isFailed
    ? "Published — deploy failed"
    : isBuilding
      ? "Published & deploying"
      : isLive
        ? "Published — live"
        : "Published";
  const shas =
    commitShas.length > 0 ? commitShas : latest ? [latest.commitSha] : [];
  const detail =
    shas.length > 1
      ? `${shas.length} commits`
      : shas.length === 1
        ? `${shas[0].slice(0, 7)}${
            latest ? ` · ${relativeLocalDate(now, latest.updatedAt)}` : ""
          }`
        : null;

  const hairline = (
    <span
      className="hidden sm:block h-px flex-1 bg-border-primary"
      role="separator"
      aria-hidden
    />
  );

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-0 sm:gap-4">
      <span className="block sm:hidden h-px bg-border-primary" aria-hidden />
      {hairline}
      <div
        className={classNames(
          "flex items-start sm:items-center gap-2 min-w-0",
          "border rounded-lg px-3 py-2 -mt-px",
          "sm:rounded-full sm:py-1.5 sm:mt-0 sm:shrink-0",
          {
            "bg-bg-error-secondary border-border-error-secondary text-fg-error-secondary":
              isFailed,
            "bg-bg-warning-primary border-border-warning-primary text-fg-warning-primary":
              isBuilding,
            "bg-bg-brand-primary border-border-brand-primary text-fg-brand-primary":
              isLive,
            "bg-bg-secondary border-border-primary text-fg-secondary":
              !isFailed && !isBuilding && !isLive,
          },
        )}
      >
        {isBuilding ? (
          <Loader2
            size={14}
            className="animate-spin shrink-0 mt-0.5 sm:mt-0"
            aria-hidden
          />
        ) : isFailed ? (
          <CircleAlert
            size={14}
            className="shrink-0 mt-0.5 sm:mt-0"
            aria-hidden
          />
        ) : isLive ? (
          <Check size={14} className="shrink-0 mt-0.5 sm:mt-0" aria-hidden />
        ) : (
          <Lock size={14} className="shrink-0 mt-0.5 sm:mt-0" aria-hidden />
        )}
        <span className="flex flex-col sm:flex-row sm:items-center sm:gap-2 min-w-0 text-xs sm:text-[13px]">
          <span className="font-medium">{title}</span>
          <span className="opacity-80">
            {detail && <span className="tabular-nums">{detail} — </span>}
            these cannot be discarded
          </span>
        </span>
      </div>
      {hairline}
    </div>
  );
}

// #region ModuleGroup

type RowProps = {
  moduleFilePath: ModuleFilePath;
  isRouterModule: boolean;
  profilesByAuthorIds: Record<string, Profile>;
  portalContainer: HTMLElement | null;
  mode: "fs" | "http" | "unknown";
  canDiscard: boolean;
  /**
   * This row's change has shipped, so it has NO before and after left to show.
   *
   * A publish promotes the patched source to base (`SourceStore.promotePublished`),
   * so a committed patch's effect is in the "before" side and the "after" side
   * alike. Rendering the usual diff for such a row therefore does not show the
   * change that shipped — it shows whatever is still PENDING at the same path,
   * attributed to the commit. Which is how a straddling field ("A"→"B", publish,
   * "B"→"C") had both of its cards claiming `B→C`.
   *
   * There is no honest diff to put here instead: the pre-publish value is gone
   * from the store by the time the row exists. So the row states what shipped and
   * stops, and the card says why.
   */
  isCommitted: boolean;
  parentMediaType?: "images" | "files";
};

function collectModulePatchIds(node: ChangeTreeNode): PatchId[] {
  const ids: PatchId[] = [];
  const seen = new Set<string>();
  function walk(n: ChangeTreeNode) {
    for (const id of n.change?.patchIds ?? []) {
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
    for (const child of n.children) walk(child);
  }
  walk(node);
  return ids;
}

function collectModuleAuthorsAndPatches(node: ChangeTreeNode): {
  authorIds: string[];
  patchesByAuthorIds: Record<string, AuthorPatchInfo[]>;
} {
  const authorIds: string[] = [];
  const seenAuthors = new Set<string>();
  const patchesByAuthorIds: Record<string, AuthorPatchInfo[]> = {};
  function walk(n: ChangeTreeNode) {
    if (n.change) {
      for (const id of n.change.authors) {
        if (!seenAuthors.has(id)) {
          seenAuthors.add(id);
          authorIds.push(id);
        }
      }
      for (const [authorId, patches] of Object.entries(
        n.change.patchesByAuthorIds,
      )) {
        if (!patchesByAuthorIds[authorId]) {
          patchesByAuthorIds[authorId] = [];
        }
        for (const p of patches) {
          patchesByAuthorIds[authorId].push({
            createdAt: p.createdAt,
            opType: p.opType,
          });
        }
      }
    }
    for (const child of n.children) walk(child);
  }
  walk(node);
  return { authorIds, patchesByAuthorIds };
}

function ModuleGroup({
  tree,
  profilesByAuthorIds,
  portalContainer,
  mode,
  schemas,
  canDiscard,
}: {
  tree: ChangeTreeNode;
  profilesByAuthorIds: Record<string, Profile>;
  portalContainer: HTMLElement | null;
  mode: "fs" | "http" | "unknown";
  schemas?: Record<ModuleFilePath, SerializedSchema>;
  canDiscard: boolean;
}) {
  const moduleFilePath = tree.sourcePath as ModuleFilePath;
  const moduleSchema = schemas?.[moduleFilePath];
  const isRouterModule =
    moduleSchema?.type === "record" && !!moduleSchema.router;
  const [isCollapsed, setIsCollapsed] = useState(false);
  const { deletePatches } = useDeletePatches();
  const [now] = useState(() => new Date());

  const beforeModuleSource = useServerSourceAtPath(moduleFilePath);
  const afterModuleSource = useSourceAtPath(moduleFilePath);
  const isModuleEqual =
    beforeModuleSource.status === "success" &&
    afterModuleSource.status === "success" &&
    deepEqual(
      beforeModuleSource.data as ReadonlyJSONValue,
      afterModuleSource.data as ReadonlyJSONValue,
    );

  const modulePatchIds = useMemo(() => collectModulePatchIds(tree), [tree]);
  const { patchesByAuthorIds: modulePatchesByAuthorIds } = useMemo(
    () => collectModuleAuthorsAndPatches(tree),
    [tree],
  );

  /*
   * Below the deploy line nothing is discardable, and the whole module is on one
   * side of it — `computeChangedSourcePaths` splits a patch set that straddles, so
   * a tree is never half shipped. Narrowing `canDiscard` here is therefore enough
   * to take the control off every row inside as well: they all read it off
   * `rowProps`.
   */
  const canDiscardHere = canDiscard && !tree.isCommitted;

  const rowProps: RowProps = {
    moduleFilePath,
    isRouterModule,
    profilesByAuthorIds,
    portalContainer,
    mode,
    canDiscard: canDiscardHere,
    isCommitted: tree.isCommitted,
  };

  return (
    <section
      /*
       * Not unique when a module straddles the deploy line: it is then two
       * sections, both naming the same module. That is deliberate and safe in one
       * direction only — `findStudioPathTarget` takes the FIRST match, and
       * `computeChangedSourcePaths` sorts every pending tree above every
       * committed one, so the first match is the card whose changes can still be
       * acted on. The test "pending trees sort above committed ones" is what
       * holds that ordering in place.
       */
      data-val-studio-path={tree.sourcePath}
      className={classNames(
        "border rounded-lg overflow-hidden",
        // Dashed and a flatter ground for a module that has shipped: dimming
        // alone reads as "still loading", and this is the opposite — settled, and
        // no longer something you can act on.
        tree.isCommitted
          ? "border-dashed border-border-primary bg-bg-secondary"
          : "border-border-primary bg-bg-primary",
      )}
    >
      <header
        className={classNames(
          "flex items-center gap-2 px-4 lg:px-5 py-4 border-b min-w-0",
          tree.isCommitted
            ? "border-dashed border-border-primary"
            : "border-border-primary",
        )}
      >
        <ModulePathLabel moduleFilePath={moduleFilePath} />
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {tree.isCommitted && (
            /*
             * The lock, with the word only where there is room for it. On a phone
             * the divider directly above has already said "deploying", and the
             * module name is what the row is for.
             */
            <span
              className="inline-flex items-center gap-1.5 text-xs text-fg-tertiary"
              title="Published — this cannot be discarded"
            >
              <Lock size={12} aria-hidden />
              <span className="hidden sm:inline">Deploying</span>
            </span>
          )}
          {canDiscardHere && modulePatchIds.length > 0 && (
            <DiscardControl
              isEqual={isModuleEqual}
              onDiscard={() => deletePatches(modulePatchIds)}
              confirmDescription="Discard all changes in this module? This cannot be undone."
              unchangedAriaLabel="Discard all unchanged in this module"
              confirmAriaLabel="Discard all changes in this module"
              portalContainer={portalContainer}
            />
          )}
          {Object.keys(modulePatchesByAuthorIds).length > 0 && (
            <FieldPatchAuthorsPure
              patchesByAuthorIds={modulePatchesByAuthorIds}
              profilesByAuthorIds={profilesByAuthorIds}
              now={now}
              portalContainer={portalContainer}
              mode={mode}
            />
          )}
          <CollapseToggle
            isOpen={!isCollapsed}
            onToggle={() => setIsCollapsed((v) => !v)}
            openLabel="Collapse module"
            closedLabel="Expand module"
          />
        </div>
      </header>
      {!isCollapsed && (
        <div className="divide-y divide-border-primary">
          {tree.isCommitted && (
            /*
             * Why there is no before and after down here.
             *
             * Without it the section reads as a diff that failed to load. See
             * `RowProps.isCommitted`: the published value IS the base now, so
             * both sides of the comparison hold it and there is nothing left to
             * put side by side.
             */
            <p className="px-4 lg:px-5 py-3 text-xs text-fg-tertiary">
              Already part of the published content, so there is no before and
              after to compare. Open a field to see its current value.
            </p>
          )}
          <RenderTree node={tree} rowProps={rowProps} />
        </div>
      )}
    </section>
  );
}

/**
 * Whether this node is an array of primitives, whose diff belongs to the LIST.
 *
 * A hook, so the schema lookup is a hook rather than a prop threaded down from
 * the module. `undefined` while the schema is still resolving: the caller has to
 * be able to wait rather than guess, since guessing "not a list" renders the per
 * index rows and then swaps them for the list diff a moment later.
 */
function useIsPrimitiveList(
  sourcePath: SourcePath | ModuleFilePath,
): boolean | undefined {
  const schemaAtPath = useSchemaAtPath(sourcePath as SourcePath);
  if (schemaAtPath.status === "loading") {
    return undefined;
  }
  if (schemaAtPath.status !== "success" || schemaAtPath.data.type !== "array") {
    return false;
  }
  const item = schemaAtPath.data.item.type;
  return item === "string" || item === "number" || item === "boolean";
}

function RenderTree({
  node,
  rowProps,
}: {
  node: ChangeTreeNode;
  rowProps: RowProps;
}) {
  /*
   * A list of primitives is diffed AS A LIST, and its children are not rendered.
   *
   * The per-index rows were the wrong unit for a list twice over — see
   * `PrimitiveListDiff` — and showing both would be the same change described two
   * incompatible ways on the same screen.
   */
  const isPrimitiveList = useIsPrimitiveList(node.sourcePath);
  if (isPrimitiveList === undefined) {
    return null;
  }
  if (isPrimitiveList) {
    return <ListChangeRow key={node.sourcePath} row={node} {...rowProps} />;
  }

  if (node.change) {
    if (
      node.change.changeType === "added" ||
      node.change.changeType === "removed"
    ) {
      return <ChangeRow key={node.sourcePath} row={node} {...rowProps} />;
    }
    return (
      <>
        <ChangeRow key={node.sourcePath} row={node} {...rowProps} />
        {node.children.length > 0 && (
          <ChangeCluster parent={node} rowProps={rowProps} />
        )}
      </>
    );
  }

  const hasChangingChildren = node.children.some((c) => hasAnyChange(c));
  if (hasChangingChildren) {
    return <ChangeCluster parent={node} rowProps={rowProps} />;
  }

  return null;
}

/**
 * Where a committed file is served from, ignoring any pending patch.
 *
 * The compare view shows the BEFORE side, which is the committed bytes by
 * definition — so unlike {@link refToUrl} it must not consult `filePatchIds`.
 */
function staticFileUrl(ref: string): string {
  return Internal.mediaUrl({ path: ref });
}

function hasAnyChange(node: ChangeTreeNode): boolean {
  if (node.change) return true;
  return node.children.some(hasAnyChange);
}

/**
 * Fold every change inside a media entry into the entry's own row.
 *
 * `s.images()` / `s.files()` modules are records keyed by file ref, so an alt
 * text or hotspot edit produces a patch on `<ref>."alt"`, not on `<ref>`.
 * Rendering that descendant as a row of its own gives a media card for a file
 * named "alt" - `MediaEntryDiff` reads the thumbnail URL, the filename and the
 * before/after metadata off the row's path, and the path it would get ends in
 * the metadata key. Entries are therefore leaves: the card is the unit of
 * change for media, and the metadata diff belongs inside it.
 *
 * The descendants' patches are merged up so the row still credits everyone who
 * touched the entry.
 */
function asMediaEntryRow(entry: ChangeTreeNode): ChangeTreeNode {
  const patchIds: PatchId[] = [];
  const authors: string[] = [];
  const patchesByAuthorIds: Record<string, ChangeTreePatch[]> = {};
  const seenPatchIds = new Set<string>();
  const seenAuthors = new Set<string>();
  let lastUpdated = "";
  let lastUpdatedBy: string | null = null;
  function walk(node: ChangeTreeNode) {
    const change = node.change;
    if (change) {
      for (const patchId of change.patchIds) {
        if (!seenPatchIds.has(patchId)) {
          seenPatchIds.add(patchId);
          patchIds.push(patchId);
        }
      }
      for (const authorId of change.authors) {
        if (!seenAuthors.has(authorId)) {
          seenAuthors.add(authorId);
          authors.push(authorId);
        }
      }
      for (const [authorId, patches] of Object.entries(
        change.patchesByAuthorIds,
      )) {
        if (!patchesByAuthorIds[authorId]) {
          patchesByAuthorIds[authorId] = [];
        }
        patchesByAuthorIds[authorId].push(...patches);
      }
      if (node.lastUpdated > lastUpdated) {
        lastUpdated = node.lastUpdated;
        lastUpdatedBy = change.lastUpdatedBy;
      }
    }
    for (const child of node.children) walk(child);
  }
  walk(entry);
  return {
    ...entry,
    children: [],
    change: {
      changeType: entry.change?.changeType ?? "field-change",
      patchIds,
      authors,
      lastUpdatedBy,
      patchesByAuthorIds,
    },
  };
}

function ChangeCluster({
  parent,
  rowProps,
}: {
  parent: ChangeTreeNode;
  rowProps: RowProps;
}) {
  const schemaAtPath = useSchemaAtPath(parent.sourcePath as SourcePath);

  const mediaType =
    schemaAtPath.status === "success" && schemaAtPath.data.type === "record"
      ? schemaAtPath.data.mediaType
      : undefined;

  if (mediaType) {
    return (
      <>
        {parent.children
          .filter((c) => hasAnyChange(c))
          .map((child) => (
            <ChangeRow
              key={child.sourcePath}
              row={asMediaEntryRow(child)}
              {...rowProps}
              parentMediaType={mediaType}
            />
          ))}
      </>
    );
  }

  return (
    <>
      {parent.children
        .filter((c) => hasAnyChange(c))
        .map((child) => (
          <RenderTree key={child.sourcePath} node={child} rowProps={rowProps} />
        ))}
    </>
  );
}

function ModulePathLabel({
  moduleFilePath,
}: {
  moduleFilePath: ModuleFilePath;
}) {
  const parts = Internal.splitModuleFilePath(moduleFilePath);
  const moduleLink = useNavLink(moduleFilePath);
  return (
    <h2 className="text-sm font-medium text-fg-primary truncate min-w-0">
      {/*
       * The module, as somewhere you can go. A row of changes is most often read
       * on the way to fixing one of them.
       */}
      <a
        {...moduleLink}
        title={moduleFilePath}
        className="flex items-center gap-1.5 min-w-0 rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
      >
        {parts.map((part, i) => (
          <Fragment key={`${part}-${i}`}>
            {i > 0 && (
              <span className="text-fg-tertiary" aria-hidden>
                /
              </span>
            )}
            <span
              className={classNames({
                "text-fg-secondary": i < parts.length - 1,
              })}
            >
              {prettifyFilename(part)}
            </span>
          </Fragment>
        ))}
      </a>
    </h2>
  );
}

// #region ChangeRow

/**
 * One row for a whole list of primitives.
 *
 * The header is the same as any other change row; the body is the list's diff
 * rather than the touched indices. Its patch ids and authors are collected from
 * the node AND its subtree, because the per-index rows are no longer rendered and
 * their Discard has to stay reachable from somewhere.
 *
 * The change type is deliberately fixed to `field-change`: a list whose items
 * moved is not "added" or "removed" at the list's own path, whatever the ops
 * inside it were, and the badge would be claiming something about the array that
 * is only true of one of its items.
 */
function ListChangeRow({
  row,
  moduleFilePath,
  isRouterModule,
  profilesByAuthorIds,
  portalContainer,
  mode,
  canDiscard,
  isCommitted,
}: {
  row: ChangeTreeNode;
  moduleFilePath: ModuleFilePath;
  isRouterModule: boolean;
  profilesByAuthorIds: Record<string, Profile>;
  portalContainer: HTMLElement | null;
  mode: "fs" | "http" | "unknown";
  canDiscard: boolean;
  isCommitted: boolean;
}) {
  const { deletePatches } = useDeletePatches();
  const [now] = useState(() => new Date());
  const [isExpanded, setIsExpanded] = useState(true);

  const sourcePath = row.sourcePath as SourcePath;
  const beforeSource = useServerSourceAtPath(sourcePath);
  const afterSource = useSourceAtPath(sourcePath);
  // Never "unchanged" below the deploy line: the two sides are equal there
  // BECAUSE the change shipped, which is the opposite of nothing happening.
  const isEqual =
    !isCommitted &&
    beforeSource.status === "success" &&
    afterSource.status === "success" &&
    deepEqual(
      beforeSource.data as ReadonlyJSONValue,
      afterSource.data as ReadonlyJSONValue,
    );

  const patchIds = useMemo(() => collectModulePatchIds(row), [row]);
  const { patchesByAuthorIds } = useMemo(
    () => collectModuleAuthorsAndPatches(row),
    [row],
  );

  const [, modulePath] = Internal.splitModuleFilePathAndModulePath(sourcePath);
  const segments = modulePath ? Internal.splitModulePath(modulePath) : [];
  const isRouterPageKey = isRouterModule && segments.length === 1;
  const lastSegment = segments[segments.length - 1] ?? "";

  // Nothing to say: no patch touched this list, or they cancelled out.
  if (patchIds.length === 0) {
    return null;
  }

  return (
    <article
      data-val-studio-path={row.sourcePath}
      className={classNames("px-5 py-5", { "opacity-60": isEqual })}
    >
      <ChangeRowHeader
        sourcePath={sourcePath}
        changeType="field-change"
        segment={lastSegment}
        modulePath={modulePath}
        moduleFilePath={moduleFilePath}
        isRouterPageKey={isRouterPageKey}
        patchesByAuthorIds={patchesByAuthorIds}
        profilesByAuthorIds={profilesByAuthorIds}
        patchIds={patchIds}
        segmentLabel={lastSegment || modulePath || moduleFilePath}
        portalContainer={portalContainer}
        mode={mode}
        now={now}
        onDiscard={() => deletePatches(patchIds)}
        isExpanded={isExpanded}
        onToggleExpand={() => setIsExpanded((prev) => !prev)}
        isEqual={isEqual}
        canDiscard={canDiscard}
        hideExpand={isCommitted}
      />
      {isExpanded && !isCommitted && (
        <div className="mt-4">
          <PrimitiveListDiff sourcePath={sourcePath} />
        </div>
      )}
    </article>
  );
}

function ChangeRow({
  row,
  moduleFilePath,
  isRouterModule,
  profilesByAuthorIds,
  portalContainer,
  mode,
  canDiscard,
  isCommitted,
  parentMediaType,
}: {
  row: ChangeTreeNode;
  moduleFilePath: ModuleFilePath;
  isRouterModule: boolean;
  profilesByAuthorIds: Record<string, Profile>;
  portalContainer: HTMLElement | null;
  mode: "fs" | "http" | "unknown";
  canDiscard: boolean;
  isCommitted: boolean;
  parentMediaType?: "images" | "files";
}) {
  const { deletePatches } = useDeletePatches();
  const staging = usePatchStaging();
  const [now] = useState(() => new Date());
  const change = row.change;
  const [isExpanded, setIsExpanded] = useState(
    change?.changeType !== "removed",
  );

  const sourcePath = row.sourcePath as SourcePath;
  const beforeSource = useServerSourceAtPath(sourcePath);
  const afterSource = useSourceAtPath(sourcePath);

  if (!change) return null;

  // See `RowProps.isCommitted`: below the deploy line the two sides are equal
  // because the change shipped, so "Unchanged" would be exactly backwards.
  const isEqual =
    !isCommitted &&
    change.changeType === "field-change" &&
    beforeSource.status === "success" &&
    afterSource.status === "success" &&
    deepEqual(
      beforeSource.data as ReadonlyJSONValue,
      afterSource.data as ReadonlyJSONValue,
    );

  const [, modulePath] = Internal.splitModuleFilePathAndModulePath(sourcePath);
  const segments = modulePath ? Internal.splitModulePath(modulePath) : [];
  const isRouterPageKey = isRouterModule && segments.length === 1;
  const lastSegment = segments[segments.length - 1] ?? "";

  const patchesByAuthorIds: Record<string, AuthorPatchInfo[]> = {};
  for (const [authorId, patches] of Object.entries(change.patchesByAuthorIds)) {
    patchesByAuthorIds[authorId] = patches.map((p) => ({
      createdAt: p.createdAt,
      opType: p.opType,
    }));
  }

  const onDiscard = () => deletePatches(change.patchIds);

  // A held row still has to be legible and re-stageable — if unstaging hid the
  // change, unstaging would be a one-way trapdoor.
  const stagingState = staging.stateOf(change.patchIds);
  const isHeld = staging.enabled && stagingState === "held";

  return (
    <article
      data-val-studio-path={row.sourcePath}
      data-val-staging={staging.enabled ? stagingState : undefined}
      className={classNames("px-5 py-5", {
        "opacity-60": isEqual,
        "bg-bg-error-secondary/30": change.changeType === "removed",
        "bg-bg-brand-primary/5": change.changeType === "added",
        // Held: desaturated and struck through the rail, so it reads as "present
        // but not going out" rather than as an error.
        "opacity-50 grayscale": isHeld,
      })}
    >
      <ChangeRowHeader
        sourcePath={sourcePath}
        changeType={change.changeType}
        segment={lastSegment}
        modulePath={modulePath}
        moduleFilePath={moduleFilePath}
        isRouterPageKey={isRouterPageKey}
        patchesByAuthorIds={patchesByAuthorIds}
        profilesByAuthorIds={profilesByAuthorIds}
        portalContainer={portalContainer}
        mode={mode}
        now={now}
        onDiscard={onDiscard}
        isExpanded={isExpanded}
        onToggleExpand={() => setIsExpanded((prev) => !prev)}
        isEqual={isEqual}
        canDiscard={canDiscard}
        hideExpand={isCommitted}
        parentMediaType={parentMediaType}
        patchIds={change.patchIds}
        segmentLabel={lastSegment || modulePath || moduleFilePath}
      />
      {/* No diff below the deploy line — see `RowProps.isCommitted`. */}
      {!isCommitted && (
        <div className="mt-4">
          <ChangeRowBody
            sourcePath={sourcePath}
            changeType={change.changeType}
            isExpanded={isExpanded}
            isEqual={isEqual}
            parentMediaType={parentMediaType}
          />
        </div>
      )}
    </article>
  );
}

function ChangeRowHeader({
  sourcePath,
  changeType,
  segment,
  modulePath,
  moduleFilePath,
  isRouterPageKey,
  patchesByAuthorIds,
  profilesByAuthorIds,
  patchIds,
  segmentLabel,
  portalContainer,
  mode,
  now,
  onDiscard,
  isExpanded,
  onToggleExpand,
  isEqual,
  canDiscard,
  hideExpand,
  parentMediaType,
}: {
  sourcePath: SourcePath;
  changeType: ChangeType;
  segment: string;
  modulePath: string;
  moduleFilePath: ModuleFilePath;
  isRouterPageKey: boolean;
  patchesByAuthorIds: Record<string, AuthorPatchInfo[]>;
  profilesByAuthorIds: Record<string, Profile>;
  patchIds: PatchId[];
  segmentLabel: string;
  portalContainer: HTMLElement | null;
  mode: "fs" | "http" | "unknown";
  now: Date;
  onDiscard: () => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
  isEqual: boolean;
  canDiscard: boolean;
  /** No body to collapse — a committed row has no diff. See `RowProps.isCommitted`. */
  hideExpand?: boolean;
  parentMediaType?: "images" | "files";
}) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <ChangeTypeIcon changeType={changeType} isEqual={isEqual} />
      <ChangeTargetLabel
        sourcePath={sourcePath}
        segment={segment}
        modulePath={modulePath}
        moduleFilePath={moduleFilePath}
        isRouterPageKey={isRouterPageKey}
        parentMediaType={parentMediaType}
      />
      <ChangeTypeLabel changeType={changeType} isEqual={isEqual} />
      <div className="ml-auto flex items-center gap-2 shrink-0">
        {/*
         * NOT gated on `canDiscard`. That flag is about the DISCARD controls
         * only (see this file's header) and it defaults to false, so gating
         * staging on it hid the toggle everywhere it was not explicitly passed.
         * `StagingToggle` already returns null unless the provider says staging
         * is enabled, which is the condition that actually applies: choosing
         * what YOU publish is a different capability from throwing work away.
         */}
        <StagingToggle
          patchIds={patchIds}
          profilesByAuthorIds={profilesByAuthorIds}
          label={segmentLabel}
        />
        {canDiscard && (
          <DiscardControl
            isEqual={isEqual}
            onDiscard={onDiscard}
            confirmDescription="Discard this change? This cannot be undone."
            unchangedAriaLabel="Discard unchanged"
            confirmAriaLabel="Discard this change"
            portalContainer={portalContainer}
          />
        )}
        <FieldPatchAuthorsPure
          patchesByAuthorIds={patchesByAuthorIds}
          profilesByAuthorIds={profilesByAuthorIds}
          now={now}
          portalContainer={portalContainer}
          mode={mode}
        />
        {!hideExpand && (
          <CollapseToggle
            isOpen={isExpanded}
            onToggle={onToggleExpand}
            openLabel="Collapse"
            closedLabel="Expand"
          />
        )}
      </div>
    </div>
  );
}

function ChangeTargetLabel({
  sourcePath,
  segment,
  modulePath,
  moduleFilePath,
  isRouterPageKey,
  parentMediaType,
}: {
  sourcePath: SourcePath;
  segment: string;
  modulePath: string;
  moduleFilePath: ModuleFilePath;
  isRouterPageKey: boolean;
  parentMediaType?: "images" | "files";
}) {
  const label = ((): string => {
    if (parentMediaType) {
      const { filename, folder } = getRefParts(segment);
      // `folder` is "/" for a ref that sits directly in the media directory, so
      // joining the two with a slash would render "//hero.webp".
      return folder === "/" ? `/${filename}` : `${folder}/${filename}`;
    }
    if (!modulePath) {
      return prettifyFilename(
        Internal.splitModuleFilePath(moduleFilePath).pop() ?? "",
      );
    }
    if (isRouterPageKey) {
      return segment;
    }
    return prettifyModulePath(modulePath);
  })();
  return (
    <FieldPathLink
      sourcePath={sourcePath}
      previewSegment={
        isRouterPageKey && !parentMediaType && modulePath ? segment : undefined
      }
      className="min-w-0"
    >
      {label}
    </FieldPathLink>
  );
}

function ChangeTypeLabel({
  changeType,
  isEqual,
}: {
  changeType: ChangeType;
  isEqual: boolean;
}) {
  if (isEqual) {
    return (
      <span className="text-sm text-fg-tertiary px-1.5 py-0.5 rounded bg-bg-secondary shrink-0">
        Unchanged
      </span>
    );
  }
  if (changeType === "added") {
    return (
      <span className="text-sm text-fg-brand-primary shrink-0">Added</span>
    );
  }
  if (changeType === "removed") {
    return <span className="text-sm text-fg-error shrink-0">Removed</span>;
  }
  if (changeType === "moved") {
    return <span className="text-sm text-fg-warning shrink-0">Moved</span>;
  }
  return null; // field-change has no badge — the side-by-side rails carry it.
}

function ChangeTypeIcon({
  changeType,
  isEqual,
}: {
  changeType: ChangeType;
  isEqual: boolean;
}) {
  const size = 14;
  if (isEqual) {
    return (
      <Equal
        size={size}
        className="shrink-0 text-fg-tertiary"
        aria-label="Unchanged"
      />
    );
  }
  switch (changeType) {
    case "added":
      return (
        <Plus
          size={size}
          className="shrink-0 text-fg-brand-primary"
          aria-label="Added"
        />
      );
    case "removed":
      return (
        <Minus
          size={size}
          className="shrink-0 text-fg-error"
          aria-label="Removed"
        />
      );
    case "moved":
      return (
        <ArrowRight
          size={size}
          className="shrink-0 text-fg-warning"
          aria-label="Moved"
        />
      );
    case "field-change":
      return (
        <Pencil
          size={size}
          className="shrink-0 text-fg-secondary"
          aria-label="Edited"
        />
      );
  }
}

// #region ChangeRowBody

function ChangeRowBody({
  sourcePath,
  changeType,
  isExpanded,
  isEqual,
  parentMediaType,
}: {
  sourcePath: SourcePath;
  changeType: ChangeType;
  isExpanded: boolean;
  isEqual: boolean;
  parentMediaType?: "images" | "files";
}) {
  if (parentMediaType) {
    return (
      <MediaEntryDiff
        sourcePath={sourcePath}
        changeType={changeType}
        mediaType={parentMediaType}
        isExpanded={isExpanded}
        isEqual={isEqual}
      />
    );
  }
  if (changeType === "field-change") {
    return (
      <FieldChangeDiff
        sourcePath={sourcePath}
        isExpanded={isExpanded}
        isEqual={isEqual}
      />
    );
  }
  if (!isExpanded) return null;
  if (changeType === "added") {
    return (
      <SingleSideContent
        sourcePath={sourcePath}
        side="after"
        diffStyle="added"
      />
    );
  }
  if (changeType === "removed") {
    return <RemovedSideContent sourcePath={sourcePath} />;
  }
  // moved: just show after for now
  return (
    <SingleSideContent sourcePath={sourcePath} side="after" diffStyle="added" />
  );
}

// #region MediaEntryDiff

function extractHotspot(
  metadata: Record<string, unknown> | null,
): { x: number; y: number } | undefined {
  if (
    metadata &&
    typeof metadata.hotspot === "object" &&
    metadata.hotspot !== null &&
    "x" in (metadata.hotspot as Record<string, unknown>) &&
    "y" in (metadata.hotspot as Record<string, unknown>)
  ) {
    const hs = metadata.hotspot as Record<string, unknown>;
    if (typeof hs.x === "number" && typeof hs.y === "number") {
      return { x: hs.x, y: hs.y };
    }
  }
  return undefined;
}

function MediaEntryMetadata({
  metadata,
}: {
  metadata: Record<string, unknown> | null;
}) {
  const rows: { label: string; value: string }[] = [];
  if (metadata) {
    if (typeof metadata.mimeType === "string") {
      rows.push({ label: "mimeType", value: metadata.mimeType });
    }
    if (
      typeof metadata.width === "number" &&
      typeof metadata.height === "number"
    ) {
      rows.push({
        label: "dimensions",
        value: `${metadata.width} × ${metadata.height}`,
      });
    }
  }
  if (rows.length === 0) return null;
  return (
    <dl className="mt-4 text-xs text-fg-secondary grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
      {rows.map((r) => (
        <Fragment key={r.label}>
          <dt className="text-fg-tertiary">{r.label}</dt>
          <dd className="truncate">{r.value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

function MediaEntryAlt({
  sourcePath,
  showValidation = false,
}: {
  sourcePath: SourcePath;
  showValidation?: boolean;
}) {
  const altPath = Internal.createValPathOfItem(sourcePath, "alt");
  const schemaAtPath = useSchemaAtPath(altPath as SourcePath);
  if (schemaAtPath.status !== "success") return null;
  return (
    <div>
      <label className="text-sm font-medium mb-1 block">Alt</label>
      <AnyField
        path={altPath as SourcePath}
        schema={schemaAtPath.data}
        readonly
        errorDisplay={showValidation ? "compact" : "none"}
      />
    </div>
  );
}

function MediaEntryThumbnail({
  url,
  filename,
  diffStyle,
  hotspot,
}: {
  url: string | null;
  filename: string;
  diffStyle?: "added" | "removed";
  hotspot?: { x: number; y: number };
}) {
  if (!url) {
    return (
      <div className="w-[120px] flex-shrink-0">
        <div className="w-[120px] h-[90px] rounded bg-bg-secondary flex items-center justify-center text-fg-disabled text-xs">
          No preview
        </div>
        {hotspot && (
          <div className="mt-1 text-xs text-fg-tertiary">
            hotspot {Math.round(hotspot.x * 100)}%,{" "}
            {Math.round(hotspot.y * 100)}%
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="w-[120px] flex-shrink-0">
      <div className="relative w-[120px] h-[90px]">
        <img
          src={url}
          alt={filename}
          draggable={false}
          className={classNames(
            "w-full h-full object-cover rounded border border-border-primary",
            { "opacity-40": diffStyle === "removed" },
          )}
          style={
            hotspot
              ? { objectPosition: `${hotspot.x * 100}% ${hotspot.y * 100}%` }
              : undefined
          }
        />
        {hotspot && <HotspotMarker hotspot={hotspot} size="sm" />}
      </div>
      {hotspot && (
        <div className="mt-1 text-xs text-fg-tertiary">
          hotspot {Math.round(hotspot.x * 100)}%, {Math.round(hotspot.y * 100)}%
        </div>
      )}
    </div>
  );
}

function useMediaEntryRef(sourcePath: SourcePath): string {
  return useMemo(() => {
    const [, modulePath] =
      Internal.splitModuleFilePathAndModulePath(sourcePath);
    const segments = modulePath ? Internal.splitModulePath(modulePath) : [];
    return segments[segments.length - 1] ?? "";
  }, [sourcePath]);
}

function MediaEntryDiff({
  sourcePath,
  changeType,
  mediaType,
  isExpanded,
  isEqual,
}: {
  sourcePath: SourcePath;
  changeType: ChangeType;
  mediaType: "images" | "files";
  isExpanded: boolean;
  isEqual: boolean;
}) {
  const fileRef = useMediaEntryRef(sourcePath);
  const filePatchIds = useFilePatchIds();
  const isImage = mediaType === "images";

  const afterSource = useSourceAtPath(sourcePath);
  const beforeSource = useServerSourceAtPath(sourcePath);

  const afterMetadata =
    afterSource.status === "success"
      ? (afterSource.data as Record<string, unknown> | null)
      : null;
  const beforeMetadata =
    beforeSource.status === "success"
      ? (beforeSource.data as Record<string, unknown> | null)
      : null;

  const afterHotspot = extractHotspot(afterMetadata);
  const beforeHotspot = extractHotspot(beforeMetadata);

  const imageUrl = isImage ? refToUrl(fileRef, filePatchIds) : null;
  const filename = getFilenameFromRef(fileRef);

  if (!isExpanded && changeType !== "field-change") return null;

  if (isEqual && changeType === "field-change") {
    return (
      <div className="max-w-xl">
        <div className="border-l-[3px] border-border-secondary pl-3 pr-1 py-2 min-w-0">
          <MediaEntryCard
            isImage={isImage}
            url={imageUrl}
            filename={filename}
            hotspot={afterHotspot}
            metadata={afterMetadata}
            sourcePath={sourcePath}
            showValidation
          />
        </div>
      </div>
    );
  }

  if (changeType === "added" || changeType === "moved") {
    if (!isExpanded) return null;
    return (
      <div className="max-w-xl">
        <DiffSide diffStyle="added">
          <MediaEntryCard
            isImage={isImage}
            url={imageUrl}
            filename={filename}
            diffStyle="added"
            hotspot={afterHotspot}
            metadata={afterMetadata}
            sourcePath={sourcePath}
            showValidation
          />
        </DiffSide>
      </div>
    );
  }

  if (changeType === "removed") {
    if (!isExpanded) return null;
    const originalUrl = isImage ? staticFileUrl(fileRef) : null;
    return (
      <BeforeSourceOverride sourcePath={sourcePath}>
        <div className="max-w-xl">
          <DiffSide diffStyle="removed">
            <MediaEntryCard
              isImage={isImage}
              url={originalUrl}
              filename={filename}
              diffStyle="removed"
              hotspot={beforeHotspot}
              metadata={beforeMetadata}
              sourcePath={sourcePath}
            />
          </DiffSide>
        </div>
      </BeforeSourceOverride>
    );
  }

  // field-change (metadata update)
  if (!isExpanded) return null;

  const beforeAvailable = beforeSource.status === "success";
  const beforeIsNull = beforeAvailable && beforeSource.data === null;

  if (beforeIsNull || !beforeAvailable) {
    return (
      <div className="max-w-xl">
        <DiffSide diffStyle="added">
          <MediaEntryCard
            isImage={isImage}
            url={imageUrl}
            filename={filename}
            diffStyle="added"
            hotspot={afterHotspot}
            metadata={afterMetadata}
            sourcePath={sourcePath}
            showValidation
          />
        </DiffSide>
      </div>
    );
  }

  return (
    <div className="border-l-[3px] border-fg-brand-primary pl-3 py-2">
      <div className="flex items-start gap-4">
        {isImage && (
          <MediaEntryThumbnail
            url={imageUrl}
            filename={filename}
            hotspot={afterHotspot}
          />
        )}
        <div className="flex-1 min-w-0">
          <BeforeAfterLayout
            variant="media"
            before={
              <BeforeSourceOverride sourcePath={sourcePath}>
                <MediaEntryAlt sourcePath={sourcePath} />
              </BeforeSourceOverride>
            }
            after={<MediaEntryAlt sourcePath={sourcePath} showValidation />}
          />
        </div>
      </div>
      <MediaEntryMetadata metadata={afterMetadata} />
    </div>
  );
}

function RemovedSideContent({ sourcePath }: { sourcePath: SourcePath }) {
  return (
    <BeforeSourceOverride sourcePath={sourcePath}>
      <SingleSideContent
        sourcePath={sourcePath}
        side="after"
        diffStyle="removed"
      />
    </BeforeSourceOverride>
  );
}

function FieldChangeDiff({
  sourcePath,
  isExpanded,
  isEqual,
}: {
  sourcePath: SourcePath;
  isExpanded: boolean;
  isEqual: boolean;
}) {
  const schemaWithPath = useSchemaWithResolvedPath(sourcePath);
  const effectivePath =
    schemaWithPath.status === "success"
      ? schemaWithPath.resolvedPath
      : sourcePath;
  const beforeSource = useServerSourceAtPath(effectivePath);

  if (schemaWithPath.status !== "success") return null;
  const schema = schemaWithPath.data;

  const beforeAvailable = beforeSource.status === "success";
  const beforeIsNull = beforeAvailable && beforeSource.data === null;

  if (!isExpanded) return null;

  if (isEqual) {
    return (
      <BeforeAfterLayout
        variant="equal"
        before={
          <BeforeSourceOverride sourcePath={sourcePath}>
            <AnyField
              path={effectivePath}
              schema={schema}
              readonly
              compact
              inline
              hideUpload
              errorDisplay="none"
            />
          </BeforeSourceOverride>
        }
        after={
          <AnyField
            path={effectivePath}
            schema={schema}
            readonly
            compact
            inline
            hideUpload
            errorDisplay="compact"
          />
        }
      />
    );
  }

  if (beforeIsNull || !beforeAvailable) {
    return (
      <div className="max-w-xl">
        <DiffSide diffStyle="added">
          <AnyField
            path={effectivePath}
            schema={schema}
            readonly
            compact
            inline
            errorDisplay="compact"
          />
        </DiffSide>
      </div>
    );
  }

  return (
    <BeforeAfterLayout
      variant="changed"
      before={
        <BeforeSourceOverride sourcePath={sourcePath}>
          <AnyField
            path={effectivePath}
            schema={schema}
            readonly
            compact
            inline
            hideUpload
            errorDisplay="none"
          />
        </BeforeSourceOverride>
      }
      after={
        <AnyField
          path={effectivePath}
          schema={schema}
          readonly
          compact
          inline
          errorDisplay="compact"
        />
      }
    />
  );
}

function SingleSideContent({
  sourcePath,
  side,
  diffStyle,
}: {
  sourcePath: SourcePath;
  side: "before" | "after";
  diffStyle: "added" | "removed";
}) {
  const [moduleFilePath] = useMemo(
    () => Internal.splitModuleFilePathAndModulePath(sourcePath),
    [sourcePath],
  );
  const beforeModuleSource = useServerSourceAtPath(moduleFilePath);
  /**
   * Memoised because it is a CONTEXT VALUE. See {@link BeforeSourceOverride}.
   *
   * Computed unconditionally rather than inside the `before` branch: a hook
   * cannot be called conditionally, and the object is cheap. The `after` side
   * never reads it.
   */
  const beforeOverride = useMemo<SourceOverride | null>(
    () =>
      beforeModuleSource.status === "success"
        ? { moduleFilePath, moduleSource: beforeModuleSource.data }
        : null,
    [moduleFilePath, beforeModuleSource],
  );

  if (side === "before") {
    return (
      <FieldSourceOverrideContext.Provider value={beforeOverride}>
        <SingleSideContentInner sourcePath={sourcePath} diffStyle={diffStyle} />
      </FieldSourceOverrideContext.Provider>
    );
  }

  return (
    <SingleSideContentInner sourcePath={sourcePath} diffStyle={diffStyle} />
  );
}

function SingleSideContentInner({
  sourcePath,
  diffStyle,
}: {
  sourcePath: SourcePath;
  diffStyle: "added" | "removed";
}) {
  const schemaAtPath = useSchemaAtPath(sourcePath);
  if (schemaAtPath.status !== "success") return null;
  const schema = schemaAtPath.data;

  return (
    <div className="max-w-xl">
      <DiffSide diffStyle={diffStyle}>
        {diffStyle === "removed" ? (
          <div className="[&_div]:decoration-fg-error [&_pre]:decoration-fg-error line-through decoration-fg-error">
            <AnyField
              path={sourcePath}
              schema={schema}
              readonly
              compact
              inline
              hideUpload
              errorDisplay="none"
            />
          </div>
        ) : (
          <AnyField
            path={sourcePath}
            schema={schema}
            readonly
            compact
            inline
            errorDisplay="compact"
          />
        )}
      </DiffSide>
    </div>
  );
}

function DiffSide({
  diffStyle,
  children,
}: {
  diffStyle: "added" | "removed";
  children: React.ReactNode;
}) {
  return (
    <div
      className={classNames("border-l-[3px] pl-3 pr-1 py-2 min-w-0", {
        "border-fg-error": diffStyle === "removed",
        "border-fg-brand-primary": diffStyle === "added",
      })}
    >
      {children}
    </div>
  );
}

// #region AvatarStack

function AvatarStack({
  authorIds,
  profilesByAuthorIds,
  mode,
}: {
  authorIds: string[];
  profilesByAuthorIds: Record<string, Profile>;
  mode: "fs" | "http" | "unknown";
}) {
  if (authorIds.length === 0) return null;
  const visible = authorIds.slice(0, 9);
  const overflow = authorIds.length - visible.length;
  return (
    <div className="flex items-center" aria-label="Authors">
      {visible.map((id, i) => (
        <SummaryAvatar
          key={id}
          profile={profilesByAuthorIds[id] ?? null}
          isFirst={i === 0}
          mode={mode}
        />
      ))}
      {overflow > 0 && (
        <span
          className="-ml-2 w-7 h-7 rounded-full inline-flex items-center justify-center text-[11px] font-semibold bg-bg-secondary text-fg-secondary border-2 border-bg-primary"
          aria-label={`${overflow} more authors`}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}

function SummaryAvatar({
  profile,
  isFirst,
  mode,
}: {
  profile: Profile | null;
  isFirst: boolean;
  mode: "fs" | "http" | "unknown";
}) {
  const cls = classNames(
    "shrink-0 w-7 h-7 rounded-full inline-flex items-center justify-center text-[11px] font-semibold overflow-hidden border-2 border-bg-primary",
    { "-ml-2": !isFirst },
  );
  if (!profile) {
    return (
      <span
        className={classNames(cls, "bg-bg-secondary text-fg-disabled")}
        title={mode === "fs" ? "Local changes" : "Unknown author"}
      >
        {mode === "fs" ? <Save size={12} /> : <User size={12} />}
      </span>
    );
  }
  if (profile.avatar?.url) {
    return (
      <img
        src={profile.avatar.url}
        alt={profile.fullName}
        title={profile.fullName}
        className={classNames(cls, "object-cover")}
      />
    );
  }
  return (
    <span
      className={classNames(cls, "bg-bg-brand-primary text-fg-brand-primary")}
      title={profile.fullName}
    >
      {getInitials(profile.fullName)}
    </span>
  );
}

// #region CollapseToggle

function CollapseToggle({
  isOpen,
  onToggle,
  openLabel,
  closedLabel,
}: {
  isOpen: boolean;
  onToggle: () => void;
  openLabel: string;
  closedLabel: string;
}) {
  return (
    <button
      onClick={onToggle}
      className={classNames(
        "size-5 flex items-center justify-center text-fg-secondary hover:text-fg-primary transition-transform",
        { "rotate-180": isOpen },
      )}
      aria-label={isOpen ? openLabel : closedLabel}
    >
      <ChevronDown size={14} />
    </button>
  );
}

// #region DiscardControl

function DiscardControl({
  isEqual,
  onDiscard,
  confirmDescription,
  unchangedAriaLabel,
  confirmAriaLabel,
  portalContainer,
}: {
  isEqual: boolean;
  onDiscard: () => void;
  confirmDescription: string;
  unchangedAriaLabel: string;
  confirmAriaLabel: string;
  portalContainer: HTMLElement | null;
}) {
  if (isEqual) {
    return (
      <Button
        variant="default"
        size="icon-sm"
        onClick={onDiscard}
        aria-label={unchangedAriaLabel}
      >
        <Undo2 size={14} />
      </Button>
    );
  }
  return (
    <DiscardConfirmPopover
      description={confirmDescription}
      onConfirm={onDiscard}
      portalContainer={portalContainer}
      ariaLabel={confirmAriaLabel}
    />
  );
}

// #region BeforeSourceOverride

function BeforeSourceOverride({
  sourcePath,
  children,
}: {
  sourcePath: SourcePath;
  children: React.ReactNode;
}) {
  const [moduleFilePath] = useMemo(
    () => Internal.splitModuleFilePathAndModulePath(sourcePath),
    [sourcePath],
  );
  const beforeModuleSource = useServerSourceAtPath(moduleFilePath);
  /**
   * Memoised, because this is a CONTEXT VALUE and every field on the "before"
   * side reads it.
   *
   * `useShallowSourceAtPath` takes the override as a `useMemo` dependency — it
   * has to, since the override decides which source the field reads — so a fresh
   * object here recomputed the shallow source of every field under it, on every
   * render of this component. That is the whole "before" subtree re-rendering per
   * keystroke, and an input that re-renders enough loses the caret.
   *
   * `useServerSourceAtPath` is already reference-stable (it memoises on a
   * `peekBase` snapshot), so this holds for as long as the base source does.
   */
  const beforeOverride = useMemo<SourceOverride | null>(
    () =>
      beforeModuleSource.status === "success"
        ? { moduleFilePath, moduleSource: beforeModuleSource.data }
        : null,
    [moduleFilePath, beforeModuleSource],
  );
  return (
    <FieldSourceOverrideContext.Provider value={beforeOverride}>
      {children}
    </FieldSourceOverrideContext.Provider>
  );
}

// #region BeforeAfterLayout

function BeforeAfterLayout({
  variant,
  before,
  after,
}: {
  variant: "equal" | "changed" | "media";
  before: React.ReactNode;
  after: React.ReactNode;
}) {
  if (variant === "media") {
    return (
      <div className="grid gap-3 lg:gap-0 lg:grid-cols-[minmax(0,1fr)_24px_minmax(0,1fr)] items-start">
        <div className="pr-1 min-w-0">
          <div className="text-xs font-medium text-fg-tertiary mb-1">
            Before
          </div>
          {before}
        </div>
        <div
          className="hidden lg:flex items-center justify-center text-fg-tertiary pt-3"
          aria-hidden
        >
          <ArrowRight size={14} />
        </div>
        <div className="pl-1 min-w-0">
          <div className="text-xs font-medium text-fg-tertiary mb-1">After</div>
          {after}
        </div>
      </div>
    );
  }
  const borderColor =
    variant === "equal" ? "border-border-secondary" : "border-fg-brand-primary";
  const MiddleIcon = variant === "equal" ? Equal : ArrowRight;
  return (
    <div className="grid gap-3 lg:gap-0 lg:grid-cols-[minmax(0,1fr)_24px_minmax(0,1fr)] items-stretch">
      <div
        className={classNames(
          "border-l-[3px] pl-3 pr-12 lg:pr-1 py-2 min-w-0",
          borderColor,
        )}
      >
        {/*
         * Labelled only while STACKED.
         *
         * Side by side, position says which is which and the arrow between them
         * says which way it went. Stacked, all of that is gone: below `lg` the two
         * values sit one under the other, told apart by a coloured left rail — and
         * vertically that reads as two list items rather than as before and after.
         * The media variant above has always labelled them; this is the same fix
         * for the field variant, at the breakpoint where it is needed and no
         * wider, so the dense desktop row does not grow two redundant captions.
         */}
        <StackedSideLabel>Before</StackedSideLabel>
        {before}
      </div>
      <div
        className="hidden lg:flex items-center justify-center text-fg-tertiary"
        aria-hidden
      >
        <MiddleIcon size={14} />
      </div>
      <div className="pl-4 lg:pl-1 pr-3 py-2 min-w-0">
        <StackedSideLabel>After</StackedSideLabel>
        {after}
      </div>
    </div>
  );
}

/** A "Before" / "After" caption that exists only below `lg`. See `BeforeAfterLayout`. */
function StackedSideLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="lg:hidden text-[10px] uppercase tracking-wider font-medium text-fg-tertiary mb-1">
      {children}
    </div>
  );
}

// #region MediaEntryCard

function MediaEntryCard({
  isImage,
  url,
  filename,
  hotspot,
  diffStyle,
  metadata,
  sourcePath,
  showValidation,
}: {
  isImage: boolean;
  url: string | null;
  filename: string;
  hotspot?: { x: number; y: number };
  diffStyle?: "added" | "removed";
  metadata: Record<string, unknown> | null;
  sourcePath: SourcePath;
  showValidation?: boolean;
}) {
  return (
    <>
      <div className="flex items-start gap-4">
        {isImage && (
          <MediaEntryThumbnail
            url={url}
            filename={filename}
            diffStyle={diffStyle}
            hotspot={hotspot}
          />
        )}
        <div className="flex-1 min-w-0">
          <MediaEntryAlt
            sourcePath={sourcePath}
            showValidation={showValidation}
          />
        </div>
      </div>
      <MediaEntryMetadata metadata={metadata} />
    </>
  );
}

// #region DiscardConfirmPopover

function DiscardConfirmPopover({
  description,
  title,
  confirmLabel,
  onConfirm,
  portalContainer,
  ariaLabel,
  label,
}: {
  description: string;
  /**
   * The question, above the description.
   *
   * Optional: a per-row discard has the row right next to it and does not need
   * one. The discard-all does, and it names its count — "Discard all pending
   * changes?" was true and never said how much was about to go.
   */
  title?: string;
  /** Defaults to "Discard". Name the count where there is one to name. */
  confirmLabel?: string;
  onConfirm: () => void;
  portalContainer: HTMLElement | null;
  ariaLabel: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size={label ? "sm" : "icon-sm"}
          aria-label={ariaLabel}
          className={label ? "gap-2" : undefined}
        >
          <Undo2 size={14} />
          {label && <span>{label}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        container={portalContainer}
        // Near the full width of a small phone, capped from `sm` up. The default
        // `max-w-xs` is 320px, which on a 360px screen leaves 8px of margin on
        // each side once the popover is aligned to the strip's edge.
        className="w-[calc(100vw-24px)] sm:w-auto sm:max-w-xs p-3"
        side="bottom"
        align="end"
      >
        {title && (
          <p className="flex items-start gap-2 text-sm font-medium text-fg-primary mb-1.5">
            <CircleAlert
              size={15}
              className="shrink-0 mt-0.5 text-fg-error-on-surface"
              aria-hidden
            />
            <span>{title}</span>
          </p>
        )}
        <p className="text-sm text-fg-secondary mb-3">{description}</p>
        {/*
         * Half and half on a phone, so each action is a target a thumb can find
         * rather than two `xs` buttons crowded into the bottom-right corner.
         * Right-aligned and back to their own widths from `sm` up.
         */}
        <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center sm:justify-end">
          <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              onConfirm();
              setOpen(false);
            }}
          >
            {confirmLabel ?? "Discard"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// #region helpers

export function flattenChanges(node: ChangeTreeNode): ChangeTreeNode[] {
  const out: ChangeTreeNode[] = [];
  // Pre-order so a parent change appears above its children if both exist.
  if (node.change) {
    out.push(node);
  }
  // For an "added" parent we don't recurse — the entire subtree is part of
  // the added value and rendering each descendant as its own row would be
  // noise. Same for "removed".
  if (
    !node.change ||
    (node.change.changeType !== "added" && node.change.changeType !== "removed")
  ) {
    for (const child of node.children) {
      for (const leaf of flattenChanges(child)) {
        out.push(leaf);
      }
    }
  }
  return out;
}
