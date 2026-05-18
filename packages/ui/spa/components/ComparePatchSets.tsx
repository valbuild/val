import {
  Internal,
  ModuleFilePath,
  PatchId,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import { deepEqual, ReadonlyJSONValue } from "@valbuild/core/patch";
import { Fragment, useMemo, useState } from "react";
import { usePatchSetsWorker } from "../patchsets/usePatchSetsWorker";
import classNames from "classnames";
import {
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  Equal,
  ExternalLink,
  Globe,
  Loader2,
  Minus,
  Pencil,
  Plus,
  Save,
  Undo2,
  User,
} from "lucide-react";
import { SerializedPatchSet } from "../utils/PatchSets";
import { ChangeTreeNode, ChangeType } from "../utils/computeChangedSourcePaths";
import {
  FieldSourceOverrideContext,
  useAllSources,
  useFilePatchIds,
  useLoadingStatus,
  useSchemaAtPath,
  useSchemaWithResolvedPath,
  useSchemas,
  useServerSourceAtPath,
  useSourceAtPath,
} from "./ValFieldProvider";
import { getFilenameFromRef, getRefParts } from "../utils/getFilenameFromRef";
import { useDeletePatches, Profile } from "./ValProvider";
import { useAllValidationErrors } from "./ValErrorProvider";
import { useNavigation } from "./ValRouter";
import { useValPortal } from "./ValPortalProvider";
import { AnyField } from "./AnyField";
import { AuthorPatchInfo, FieldPatchAuthorsPure } from "./FieldPatchAuthors";
import { Button } from "./designSystem/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./designSystem/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./designSystem/tooltip";
import { getInitials } from "../utils/getInitials";
import { prettifyFilename } from "../utils/prettifyFilename";
import { urlOf } from "@valbuild/shared/internal";
import { getNavPathFromAll } from "./getNavPath";

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
 */
export function ComparePatchSets({
  patchSets,
  profilesByAuthorIds,
  mode = "unknown",
  readonly = true,
}: {
  patchSets: SerializedPatchSet;
  profilesByAuthorIds: Record<string, Profile>;
  mode?: "fs" | "http" | "unknown";
  readonly?: boolean;
}) {
  const portalContainer = useValPortal();
  const schemas = useSchemas();
  const { trees, isComputing } = usePatchSetsWorker(patchSets);

  const flatRows = useMemo(() => trees.flatMap(flattenChanges), [trees]);

  if (isComputing && trees.length === 0) {
    return (
      <div className="text-sm text-fg-secondary py-8 text-center animate-pulse">
        Computing changes&hellip;
      </div>
    );
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
          readonly={readonly}
        />
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
  readonly,
  portalContainer,
}: {
  authorIds: string[];
  profilesByAuthorIds: Record<string, Profile>;
  mode: "fs" | "http" | "unknown";
  allPatchIds: PatchId[];
  readonly: boolean;
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
        {!readonly && allPatchIds.length > 0 && (
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
  readonly: boolean;
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
  readonly,
}: {
  tree: ChangeTreeNode;
  profilesByAuthorIds: Record<string, Profile>;
  portalContainer: HTMLElement | null;
  mode: "fs" | "http" | "unknown";
  schemas?: Record<ModuleFilePath, SerializedSchema>;
  readonly: boolean;
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
    readonly,
  };

  return (
    <section
      id={`compare-${tree.sourcePath}`}
      className="border border-border-primary rounded-lg bg-bg-primary overflow-hidden"
    >
      <header className="flex items-center gap-2 px-5 py-4 border-b border-border-primary min-w-0">
        <ModulePathLabel moduleFilePath={moduleFilePath} />
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {!readonly &&
            modulePatchIds.length > 0 &&
            (isModuleEqual ? (
              <Button
                variant="default"
                size="icon-sm"
                onClick={() => deletePatches(modulePatchIds)}
                aria-label="Discard all unchanged in this module"
              >
                <Undo2 size={14} />
              </Button>
            ) : (
              <DiscardConfirmPopover
                description="Discard all changes in this module? This cannot be undone."
                onConfirm={() => deletePatches(modulePatchIds)}
                portalContainer={portalContainer}
                ariaLabel="Discard all changes in this module"
              />
            ))}
          {Object.keys(modulePatchesByAuthorIds).length > 0 && (
            <FieldPatchAuthorsPure
              patchesByAuthorIds={modulePatchesByAuthorIds}
              profilesByAuthorIds={profilesByAuthorIds}
              now={now}
              portalContainer={portalContainer}
              mode={mode}
            />
          )}
          <button
            onClick={() => setIsCollapsed((v) => !v)}
            className={classNames(
              "size-5 flex items-center justify-center text-fg-secondary hover:text-fg-primary transition-transform",
              { "rotate-180": !isCollapsed },
            )}
            aria-label={isCollapsed ? "Expand module" : "Collapse module"}
          >
            <ChevronDown size={14} />
          </button>
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

function RenderTree({
  node,
  rowProps,
}: {
  node: ChangeTreeNode;
  rowProps: RowProps;
}) {
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
  return ref.startsWith("/public") ? filePath.slice("/public".length) : ref;
}

/**
 * Return the static serving URL for an original (unpached) file.
 * For `/public/foo/bar.png` this returns `/foo/bar.png`.
 */
function staticFileUrl(ref: string): string {
  const remoteRefRes = Internal.remote.splitRemoteRef(ref);
  const filePath =
    remoteRefRes.status === "success" ? `/${remoteRefRes.filePath}` : ref;
  return filePath.startsWith("/public")
    ? filePath.slice("/public".length)
    : filePath;
}

function hasAnyChange(node: ChangeTreeNode): boolean {
  if (node.change) return true;
  return node.children.some(hasAnyChange);
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

  const childRowProps: RowProps = mediaType
    ? { ...rowProps, parentMediaType: mediaType }
    : rowProps;

  return (
    <>
      {parent.children
        .filter((c) => hasAnyChange(c))
        .map((child) => (
          <RenderTree
            key={child.sourcePath}
            node={child}
            rowProps={childRowProps}
          />
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
  return (
    <h2 className="text-sm font-medium text-fg-primary truncate flex items-center gap-1.5 min-w-0">
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
    </h2>
  );
}

// #region ChangeRow

function ChangeRow({
  row,
  moduleFilePath,
  isRouterModule,
  profilesByAuthorIds,
  portalContainer,
  mode,
  readonly,
  parentMediaType,
}: {
  row: ChangeTreeNode;
  moduleFilePath: ModuleFilePath;
  isRouterModule: boolean;
  profilesByAuthorIds: Record<string, Profile>;
  portalContainer: HTMLElement | null;
  mode: "fs" | "http" | "unknown";
  readonly: boolean;
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
      id={`compare-${row.sourcePath}`}
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
        readonly={readonly}
        parentMediaType={parentMediaType}
      />
      <div className="mt-4">
        <ChangeRowBody
          sourcePath={sourcePath}
          changeType={change.changeType}
          readonly={readonly}
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
  readonly,
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
  readonly: boolean;
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
        {!readonly &&
          (isEqual ? (
            <Button
              variant="default"
              size="icon-sm"
              onClick={onDiscard}
              aria-label="Discard unchanged"
            >
              <Undo2 size={14} />
            </Button>
          ) : (
            <DiscardConfirmPopover
              description="Discard this change? This cannot be undone."
              onConfirm={onDiscard}
              portalContainer={portalContainer}
              ariaLabel="Discard this change"
            />
          ))}
        <FieldPatchAuthorsPure
          patchesByAuthorIds={patchesByAuthorIds}
          profilesByAuthorIds={profilesByAuthorIds}
          now={now}
          portalContainer={portalContainer}
          mode={mode}
        />
        <button
          onClick={onToggleExpand}
          className={classNames(
            "size-5 flex items-center justify-center text-fg-secondary hover:text-fg-primary transition-transform",
            { "rotate-180": isExpanded },
          )}
          aria-label={isExpanded ? "Collapse" : "Expand"}
        >
          <ChevronDown size={14} />
        </button>
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
  const { navigate } = useNavigation();
  const schemas = useSchemas();
  const allSources = useAllSources();
  const codeCls =
    "font-mono text-sm px-2 py-0.5 rounded bg-bg-secondary text-fg-primary truncate cursor-pointer hover:bg-bg-tertiary transition-colors min-w-0 block";

  const handleNavigate = () => {
    const schemasData = schemas.status === "success" ? schemas.data : undefined;
    const navPath = getNavPathFromAll(sourcePath, allSources, schemasData);
    const target = navPath ?? sourcePath;
    navigate(target, {
      scrollToId: target !== sourcePath ? sourcePath : undefined,
    });
  };

  if (parentMediaType) {
    const { filename, folder } = getRefParts(segment);
    return (
      <button onClick={handleNavigate} className={codeCls}>
        {`${folder}/${filename}`}
      </button>
    );
  }

  if (!modulePath) {
    return (
      <button onClick={handleNavigate} className={codeCls}>
        {prettifyFilename(
          Internal.splitModuleFilePath(moduleFilePath).pop() ?? "",
        )}
      </button>
    );
  }
  if (isRouterPageKey) {
    const previewHref = urlOf("/api/val/enable", {
      redirect_to:
        (typeof window !== "undefined" ? window.location.origin : "") + segment,
    });
    return (
      <span className="inline-flex items-center gap-1.5 truncate min-w-0">
        <Globe size={12} className="shrink-0 text-fg-tertiary" />
        <button onClick={handleNavigate} className={codeCls}>
          {segment}
        </button>
        <a
          href={previewHref}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-fg-tertiary hover:text-fg-primary transition-colors"
          title={`Preview ${segment}`}
        >
          <ExternalLink size={12} />
        </a>
      </span>
    );
  }
  return (
    <button onClick={handleNavigate} className={classNames(codeCls, "min-w-0")}>
      {prettifyModulePath(modulePath)}
    </button>
  );
}

function prettifyModulePath(modulePath: string): string {
  // Show "home / title" instead of '"home"."title"'.
  if (!modulePath) return modulePath;
  // splitModulePath accepts the same string the engine uses internally; it's
  // a branded type at the boundary but the existing helpers are tolerant.
  const segments = Internal.splitModulePath(
    modulePath as Parameters<typeof Internal.splitModulePath>[0],
  );
  return segments.join(" / ");
}

function ValidationErrorLink({ sourcePath }: { sourcePath: SourcePath }) {
  const { navigate } = useNavigation();
  const schemas = useSchemas();
  const allSources = useAllSources();
  const validationErrors = useAllValidationErrors();
  const loadingStatus = useLoadingStatus();
  const isLoading = loadingStatus === "loading";
  const messages: string[] = [];
  if (validationErrors) {
    for (const errorPath in validationErrors) {
      if (errorPath.startsWith(sourcePath)) {
        for (const err of validationErrors[errorPath as SourcePath] ?? []) {
          messages.push(err.message);
        }
      }
    }
  }
  if (messages.length === 0) return <div className="size-6 shrink-0" />;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={() => {
            const schemasData =
              schemas.status === "success" ? schemas.data : undefined;
            const navPath = getNavPathFromAll(
              sourcePath,
              allSources,
              schemasData,
            );
            navigate(navPath ?? sourcePath, {
              scrollToId: sourcePath,
            });
          }}
          className={classNames(
            "inline-flex items-center justify-center size-6 rounded bg-bg-error-secondary text-fg-error hover:bg-bg-error-primary transition-colors",
            { "opacity-80": isLoading },
          )}
          aria-label="Go to validation error"
        >
          {isLoading ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <AlertTriangle size={16} />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="right"
        className="max-w-xs bg-bg-error-secondary text-fg-error border-fg-error/20"
      >
        {messages.length === 1 ? (
          <p className="text-xs">{messages[0]}</p>
        ) : (
          <ul className="text-xs list-disc pl-3 space-y-0.5">
            {messages.map((msg, i) => (
              <li key={i}>{msg}</li>
            ))}
          </ul>
        )}
      </TooltipContent>
    </Tooltip>
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
  readonly,
  isExpanded,
  isEqual,
  parentMediaType,
}: {
  sourcePath: SourcePath;
  changeType: ChangeType;
  readonly: boolean;
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
        readonly={readonly}
        isExpanded={isExpanded}
        isEqual={isEqual}
      />
    );
  }
  if (changeType === "field-change") {
    return (
      <FieldChangeDiff
        sourcePath={sourcePath}
        readonly={readonly}
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
        readonly={readonly}
      />
    );
  }
  if (changeType === "removed") {
    return <RemovedSideContent sourcePath={sourcePath} />;
  }
  // moved: just show after for now
  return (
    <SingleSideContent
      sourcePath={sourcePath}
      side="after"
      diffStyle="added"
      readonly={readonly}
    />
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
  readonly,
  showValidation = false,
}: {
  sourcePath: SourcePath;
  readonly: boolean;
  showValidation?: boolean;
}) {
  const altPath = Internal.createValPathOfItem(sourcePath, "alt");
  const schemaAtPath = useSchemaAtPath(altPath as SourcePath);
  if (schemaAtPath.status !== "success") return null;
  return (
    <div>
      <label className="text-sm font-medium mb-1 block">Alt</label>
      <div className="flex items-center gap-1">
        <div className="flex-1 min-w-0">
          <AnyField
            path={altPath as SourcePath}
            schema={schemaAtPath.data}
            readonly={readonly}
          />
        </div>
        {showValidation && <ValidationErrorLink sourcePath={sourcePath} />}
      </div>
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
        {hotspot && (
          <div
            className="absolute pointer-events-none"
            style={{
              top: `${hotspot.y * 100}%`,
              left: `${hotspot.x * 100}%`,
              transform: "translate(-50%, -50%)",
              zIndex: 10,
            }}
          >
            <div
              style={{
                width: "14px",
                height: "14px",
                borderRadius: "50%",
                border: "1.5px solid white",
                boxShadow:
                  "0 0 0 1px rgba(0,0,0,0.3), inset 0 0 0 1px rgba(0,0,0,0.3)",
              }}
            />
            <div
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                width: "3px",
                height: "3px",
                borderRadius: "50%",
                backgroundColor: "white",
                boxShadow: "0 0 2px rgba(0,0,0,0.5)",
              }}
            />
          </div>
        )}
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
  readonly,
  isExpanded,
  isEqual,
}: {
  sourcePath: SourcePath;
  changeType: ChangeType;
  mediaType: "images" | "files";
  readonly: boolean;
  isExpanded: boolean;
  isEqual: boolean;
}) {
  const fileRef = useMediaEntryRef(sourcePath);
  const filePatchIds = useFilePatchIds();
  const isImage = mediaType === "images";

  const afterSource = useSourceAtPath(sourcePath);
  const [moduleFilePath] = useMemo(
    () => Internal.splitModuleFilePathAndModulePath(sourcePath),
    [sourcePath],
  );
  const beforeModuleSource = useServerSourceAtPath(moduleFilePath);
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

  const beforeOverride =
    beforeModuleSource.status === "success"
      ? { moduleFilePath, moduleSource: beforeModuleSource.data }
      : null;

  const filename = getFilenameFromRef(fileRef);

  if (!isExpanded && changeType !== "field-change") return null;

  if (isEqual && changeType === "field-change") {
    return (
      <div className="max-w-xl">
        <div className="border-l-[3px] border-border-secondary pl-3 pr-1 py-2 min-w-0">
          <div className="flex items-start gap-4">
            {isImage && (
              <MediaEntryThumbnail
                url={imageUrl}
                filename={filename}
                hotspot={afterHotspot}
              />
            )}
            <div className="flex-1 min-w-0">
              <MediaEntryAlt sourcePath={sourcePath} readonly showValidation />
            </div>
          </div>
          <MediaEntryMetadata metadata={afterMetadata} />
        </div>
      </div>
    );
  }

  if (changeType === "added" || changeType === "moved") {
    if (!isExpanded) return null;
    return (
      <div className="max-w-xl">
        <DiffSide diffStyle="added">
          <div className="flex items-start gap-4">
            {isImage && (
              <MediaEntryThumbnail
                url={imageUrl}
                filename={filename}
                diffStyle="added"
                hotspot={afterHotspot}
              />
            )}
            <div className="flex-1 min-w-0">
              <MediaEntryAlt
                sourcePath={sourcePath}
                readonly={readonly}
                showValidation
              />
            </div>
          </div>
          <MediaEntryMetadata metadata={afterMetadata} />
        </DiffSide>
      </div>
    );
  }

  if (changeType === "removed") {
    if (!isExpanded) return null;
    const originalUrl = isImage ? staticFileUrl(fileRef) : null;
    return (
      <FieldSourceOverrideContext.Provider value={beforeOverride}>
        <div className="max-w-xl">
          <DiffSide diffStyle="removed">
            <div className="flex items-start gap-4">
              {isImage && (
                <MediaEntryThumbnail
                  url={originalUrl}
                  filename={filename}
                  diffStyle="removed"
                  hotspot={beforeHotspot}
                />
              )}
              <div className="flex-1 min-w-0">
                <MediaEntryAlt sourcePath={sourcePath} readonly />
              </div>
            </div>
            <MediaEntryMetadata metadata={beforeMetadata} />
          </DiffSide>
        </div>
      </FieldSourceOverrideContext.Provider>
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
          <div className="flex items-start gap-4">
            {isImage && (
              <MediaEntryThumbnail
                url={imageUrl}
                filename={filename}
                diffStyle="added"
                hotspot={afterHotspot}
              />
            )}
            <div className="flex-1 min-w-0">
              <MediaEntryAlt
                sourcePath={sourcePath}
                readonly={readonly}
                showValidation
              />
            </div>
          </div>
          <MediaEntryMetadata metadata={afterMetadata} />
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
          <div className="grid gap-3 lg:gap-0 lg:grid-cols-[minmax(0,1fr)_24px_minmax(0,1fr)] items-start">
            <div className="pr-1 min-w-0">
              <div className="text-xs font-medium text-fg-tertiary mb-1">
                Before
              </div>
              <FieldSourceOverrideContext.Provider value={beforeOverride}>
                <MediaEntryAlt sourcePath={sourcePath} readonly />
              </FieldSourceOverrideContext.Provider>
            </div>
            <div
              className="hidden lg:flex items-center justify-center text-fg-tertiary pt-3"
              aria-hidden
            >
              <ArrowRight size={14} />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-medium text-fg-tertiary mb-1">
                After
              </div>
              <MediaEntryAlt
                sourcePath={sourcePath}
                readonly={readonly}
                showValidation
              />
            </div>
          </div>
        </div>
      </div>
      <MediaEntryMetadata metadata={afterMetadata} />
    </div>
  );
}

function RemovedSideContent({ sourcePath }: { sourcePath: SourcePath }) {
  const [moduleFilePath] = useMemo(
    () => Internal.splitModuleFilePathAndModulePath(sourcePath),
    [sourcePath],
  );
  const serverModuleSource = useServerSourceAtPath(moduleFilePath);
  const beforeOverride =
    serverModuleSource.status === "success"
      ? { moduleFilePath, moduleSource: serverModuleSource.data }
      : null;

  return (
    <FieldSourceOverrideContext.Provider value={beforeOverride}>
      <SingleSideContent
        sourcePath={sourcePath}
        side="after"
        diffStyle="removed"
        readonly
      />
    </FieldSourceOverrideContext.Provider>
  );
}

function FieldChangeDiff({
  sourcePath,
  readonly,
  isExpanded,
  isEqual,
}: {
  sourcePath: SourcePath;
  readonly: boolean;
  isExpanded: boolean;
  isEqual: boolean;
}) {
  const schemaWithPath = useSchemaWithResolvedPath(sourcePath);
  const [moduleFilePath] = useMemo(
    () => Internal.splitModuleFilePathAndModulePath(sourcePath),
    [sourcePath],
  );
  const effectivePath =
    schemaWithPath.status === "success"
      ? schemaWithPath.resolvedPath
      : sourcePath;
  const beforeModuleSource = useServerSourceAtPath(moduleFilePath);
  const beforeSource = useServerSourceAtPath(effectivePath);

  if (schemaWithPath.status !== "success") return null;
  const schema = schemaWithPath.data;

  const beforeAvailable = beforeSource.status === "success";
  const beforeIsNull = beforeAvailable && beforeSource.data === null;

  const beforeOverride =
    beforeModuleSource.status === "success"
      ? { moduleFilePath, moduleSource: beforeModuleSource.data }
      : null;

  if (!isExpanded) return null;

  if (isEqual) {
    return (
      <div className="max-w-xl flex items-stretch">
        <div className="flex-1 min-w-0 border-l-[3px] border-border-secondary pl-3 pr-1 py-2">
          <AnyField
            path={effectivePath}
            schema={schema}
            readonly={readonly}
            compact
            inline
            hideUpload
          />
        </div>
        <div className="flex items-center px-1">
          <ValidationErrorLink sourcePath={effectivePath} />
        </div>
      </div>
    );
  }

  if (beforeIsNull || !beforeAvailable) {
    return (
      <div className="max-w-xl flex items-stretch">
        <div className="flex-1 min-w-0">
          <DiffSide diffStyle="added">
            <AnyField
              path={effectivePath}
              schema={schema}
              readonly={readonly}
              compact
              inline
            />
          </DiffSide>
        </div>
        <div className="flex items-center px-1">
          <ValidationErrorLink sourcePath={effectivePath} />
        </div>
      </div>
    );
  }

  {
    /* Side-by-side before/after.
       The coloured border lives on the left column (not an outer wrapper)
       so the grid is fully symmetric and the arrow sits exactly midway
       between the two content areas.
       Both columns reserve a trailing size-6 slot (spacer left,
       ValidationErrorLink right) so AnyField gets identical width. */
  }
  return (
    <div className="grid gap-3 lg:gap-0 lg:grid-cols-[minmax(0,1fr)_24px_minmax(0,1fr)] items-stretch">
      <div className="border-l-[3px] border-fg-brand-primary pl-3 pr-1 py-2 min-w-0 flex items-stretch gap-1">
        <div className="flex-1 min-w-0">
          <FieldSourceOverrideContext.Provider value={beforeOverride}>
            <AnyField
              path={effectivePath}
              schema={schema}
              readonly
              compact
              inline
              hideUpload
            />
          </FieldSourceOverrideContext.Provider>
        </div>
        <div className="flex items-center px-1">
          <div className="size-6 shrink-0" />
        </div>
      </div>
      <div
        className="hidden lg:flex items-center justify-center text-fg-tertiary"
        aria-hidden
      >
        <ArrowRight size={14} />
      </div>
      <div className="pl-3 pr-1 py-2 min-w-0 flex items-stretch gap-1">
        <div className="flex-1 min-w-0">
          <AnyField
            path={effectivePath}
            schema={schema}
            readonly={readonly}
            compact
            inline
          />
        </div>
        <div className="flex items-center px-1">
          <ValidationErrorLink sourcePath={effectivePath} />
        </div>
      </div>
    </div>
  );
}

function SingleSideContent({
  sourcePath,
  side,
  diffStyle,
  readonly,
}: {
  sourcePath: SourcePath;
  side: "before" | "after";
  diffStyle: "added" | "removed";
  readonly: boolean;
}) {
  const [moduleFilePath] = useMemo(
    () => Internal.splitModuleFilePathAndModulePath(sourcePath),
    [sourcePath],
  );
  const beforeModuleSource = useServerSourceAtPath(moduleFilePath);

  if (side === "before") {
    const beforeOverride =
      beforeModuleSource.status === "success"
        ? { moduleFilePath, moduleSource: beforeModuleSource.data }
        : null;
    return (
      <FieldSourceOverrideContext.Provider value={beforeOverride}>
        <SingleSideContentInner
          sourcePath={sourcePath}
          diffStyle={diffStyle}
          readonly={readonly}
        />
      </FieldSourceOverrideContext.Provider>
    );
  }

  return (
    <SingleSideContentInner
      sourcePath={sourcePath}
      diffStyle={diffStyle}
      readonly={readonly}
    />
  );
}

function SingleSideContentInner({
  sourcePath,
  diffStyle,
  readonly,
}: {
  sourcePath: SourcePath;
  diffStyle: "added" | "removed";
  readonly: boolean;
}) {
  const schemaAtPath = useSchemaAtPath(sourcePath);
  if (schemaAtPath.status !== "success") return null;
  const schema = schemaAtPath.data;

  return (
    <div className="max-w-xl flex items-stretch">
      <div className="flex-1 min-w-0">
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
              />
            </div>
          ) : (
            <AnyField
              path={sourcePath}
              schema={schema}
              readonly={readonly}
              compact
              inline
            />
          )}
        </DiffSide>
      </div>
      {diffStyle === "added" && (
        <div className="flex items-center px-1">
          <ValidationErrorLink sourcePath={sourcePath} />
        </div>
      )}
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
