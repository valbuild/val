import {
  Internal,
  ModuleFilePath,
  PatchId,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import { HotspotMarker } from "./fields/HotspotMarker";
import { deepEqual, ReadonlyJSONValue } from "@valbuild/core/patch";
import { Fragment, useMemo, useState } from "react";
import { usePatchSetsWorker } from "../patchsets/usePatchSetsWorker";
import classNames from "classnames";
import {
  ArrowRight,
  ChevronDown,
  Equal,
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
import { useDeletePatches, Profile } from "./ValProvider";
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
import { servedPath } from "../utils/mediaPath";

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
 */
export function ComparePatchSets({
  patchSets,
  profilesByAuthorIds,
  mode = "unknown",
  canDiscard = false,
  reloadKey,
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
}) {
  const portalContainer = useValPortal();
  const schemas = useSchemas();
  const { trees, isComputing, hasComputed } = usePatchSetsWorker(
    patchSets,
    reloadKey,
  );

  const flatRows = useMemo(() => trees.flatMap(flattenChanges), [trees]);

  // Until the first result is in, an empty `trees` means "not computed yet",
  // not "nothing changed": showing the empty state here would flash "No
  // pending changes" at every reader before the real changes appear. Once
  // there is a result, keep it on screen while a recomputation runs - the
  // changes are still the ones the reader is looking at.
  if (!hasComputed || (isComputing && trees.length === 0)) {
    return <CompareLoading />;
  }

  if (flatRows.length === 0) {
    return (
      <div className="text-sm text-fg-secondary py-8 text-center">
        No pending changes.
      </div>
    );
  }

  const schemasData = schemas.status === "success" ? schemas.data : undefined;

  return (
    <div className="mx-auto max-w-7xl flex flex-col gap-8 min-w-[380px]">
      {trees.map((tree) => (
        <ModuleGroup
          key={tree.sourcePath}
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

export function CompareSummaryStrip({
  authorIds,
  profilesByAuthorIds,
  mode,
  allPatchIds,
  canDiscard,
  portalContainer,
}: {
  authorIds: string[];
  profilesByAuthorIds: Record<string, Profile>;
  mode: "fs" | "http" | "unknown";
  allPatchIds: PatchId[];
  canDiscard: boolean;
  portalContainer: HTMLElement | null;
}) {
  const { deletePatches } = useDeletePatches();

  return (
    <div className="flex items-center gap-4 flex-1 min-w-0">
      <div className="flex items-center gap-2">
        <span className="text-xl font-medium leading-none text-fg-primary">
          {allPatchIds.length}
        </span>
        <span className="text-sm text-fg-secondary whitespace-nowrap">
          {allPatchIds.length === 1 ? "change" : "changes"} to review
        </span>
      </div>
      <div className="ml-auto flex items-center gap-3 shrink-0">
        {canDiscard && allPatchIds.length > 0 && (
          <DiscardConfirmPopover
            description="Discard all pending changes? This cannot be undone."
            onConfirm={() => deletePatches(allPatchIds)}
            portalContainer={portalContainer}
            ariaLabel="Discard all changes"
            label="Discard"
          />
        )}
        <AvatarStack
          authorIds={authorIds}
          profilesByAuthorIds={profilesByAuthorIds}
          mode={mode}
        />
      </div>
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

  const rowProps: RowProps = {
    moduleFilePath,
    isRouterModule,
    profilesByAuthorIds,
    portalContainer,
    mode,
    canDiscard,
  };

  return (
    <section
      data-val-studio-path={tree.sourcePath}
      className="border border-border-primary rounded-lg bg-bg-primary overflow-hidden"
    >
      <header className="flex items-center gap-2 px-5 py-4 border-b border-border-primary min-w-0">
        <ModulePathLabel moduleFilePath={moduleFilePath} />
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {canDiscard && modulePatchIds.length > 0 && (
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

// #region refToUrl (shared with ModuleGallery)

function refToUrl(
  ref: string,
  filePatchIds: ReadonlyMap<string, string>,
): string {
  const patchId = filePatchIds.get(ref);
  let filePath = ref;
  const remoteRefRes = Internal.remote.splitRemoteRef(ref);
  if (remoteRefRes.status === "success") {
    filePath = `/${remoteRefRes.filePath}`;
  }
  if (patchId) {
    return filePath.startsWith("/public")
      ? `/api/val/files${filePath}?patch_id=${patchId}`
      : `${filePath}?patch_id=${patchId}`;
  }
  return servedPath(ref);
}

/**
 * Return the static serving URL for an original (unpached) file.
 * For `/public/foo/bar.png` this returns `/foo/bar.png`.
 */
function staticFileUrl(ref: string): string {
  const remoteRefRes = Internal.remote.splitRemoteRef(ref);
  const filePath =
    remoteRefRes.status === "success" ? `/${remoteRefRes.filePath}` : ref;
  return servedPath(filePath);
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
        className="flex items-center gap-1.5 min-w-0 rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
}: {
  row: ChangeTreeNode;
  moduleFilePath: ModuleFilePath;
  isRouterModule: boolean;
  profilesByAuthorIds: Record<string, Profile>;
  portalContainer: HTMLElement | null;
  mode: "fs" | "http" | "unknown";
  canDiscard: boolean;
}) {
  const { deletePatches } = useDeletePatches();
  const [now] = useState(() => new Date());
  const [isExpanded, setIsExpanded] = useState(true);

  const sourcePath = row.sourcePath as SourcePath;
  const beforeSource = useServerSourceAtPath(sourcePath);
  const afterSource = useSourceAtPath(sourcePath);
  const isEqual =
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
        portalContainer={portalContainer}
        mode={mode}
        now={now}
        onDiscard={() => deletePatches(patchIds)}
        isExpanded={isExpanded}
        onToggleExpand={() => setIsExpanded((prev) => !prev)}
        isEqual={isEqual}
        canDiscard={canDiscard}
      />
      {isExpanded && (
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
  parentMediaType,
}: {
  row: ChangeTreeNode;
  moduleFilePath: ModuleFilePath;
  isRouterModule: boolean;
  profilesByAuthorIds: Record<string, Profile>;
  portalContainer: HTMLElement | null;
  mode: "fs" | "http" | "unknown";
  canDiscard: boolean;
  parentMediaType?: "images" | "files";
}) {
  const { deletePatches } = useDeletePatches();
  const [now] = useState(() => new Date());
  const change = row.change;
  const [isExpanded, setIsExpanded] = useState(
    change?.changeType !== "removed",
  );

  const sourcePath = row.sourcePath as SourcePath;
  const beforeSource = useServerSourceAtPath(sourcePath);
  const afterSource = useSourceAtPath(sourcePath);

  if (!change) return null;

  const isEqual =
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

  return (
    <article
      data-val-studio-path={row.sourcePath}
      className={classNames("px-5 py-5", {
        "opacity-60": isEqual,
        "bg-bg-error-secondary/30": change.changeType === "removed",
        "bg-bg-brand-primary/5": change.changeType === "added",
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
        parentMediaType={parentMediaType}
      />
      <div className="mt-4">
        <ChangeRowBody
          sourcePath={sourcePath}
          changeType={change.changeType}
          isExpanded={isExpanded}
          isEqual={isEqual}
          parentMediaType={parentMediaType}
        />
      </div>
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
  portalContainer,
  mode,
  now,
  onDiscard,
  isExpanded,
  onToggleExpand,
  isEqual,
  canDiscard,
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
  portalContainer: HTMLElement | null;
  mode: "fs" | "http" | "unknown";
  now: Date;
  onDiscard: () => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
  isEqual: boolean;
  canDiscard: boolean;
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
        <CollapseToggle
          isOpen={isExpanded}
          onToggle={onToggleExpand}
          openLabel="Collapse"
          closedLabel="Expand"
        />
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
        {before}
      </div>
      <div
        className="hidden lg:flex items-center justify-center text-fg-tertiary"
        aria-hidden
      >
        <MiddleIcon size={14} />
      </div>
      <div className="pl-4 lg:pl-1 pr-3 py-2 min-w-0">{after}</div>
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
  onConfirm,
  portalContainer,
  ariaLabel,
  label,
}: {
  description: string;
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
        className="w-auto max-w-xs p-3"
        side="bottom"
        align="end"
      >
        <p className="text-sm text-fg-secondary mb-3">{description}</p>
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="xs" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="xs"
            onClick={() => {
              onConfirm();
              setOpen(false);
            }}
          >
            Discard
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
