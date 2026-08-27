import { ChevronRight } from "lucide-react";
import { Fragment } from "react";
import { Internal, ModuleFilePath, SourcePath } from "@valbuild/core";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./designSystem/command";
import { cn } from "./designSystem/cn";
import { DropdownPreviewRow, DropdownPreviewImage } from "./DropdownPreviewRow";
import { useRefPreview } from "./useRefPreview";
import { useAllSources, useSchemas } from "./ValFieldProvider";
import { getNavPathFromAll } from "./getNavPath";
import { prettifyFilename } from "../utils/prettifyFilename";

export type ReferencesListItem = {
  path: SourcePath;
  moduleFilePath: ModuleFilePath;
  /** Module-internal path segments (record key / field path) following the module file path. */
  patchPath: string[];
  /**
   * Whether the target module is a router (`s.record().router()`). When true the
   * first {@link patchPath} segment is a route key (e.g. `/blogs/blog2`) and is
   * rendered as a route path; the remaining segments are the field inside it.
   */
  isRouter?: boolean;
  /** Render-derived preview for this reference, if available. */
  preview?: {
    title: string;
    subtitle?: string | null;
    image?: DropdownPreviewImage;
  } | null;
  /** Fallback label shown when no `preview` is available. Used as the search/filter value too. */
  fallbackLabel: string;
};

/**
 * The rows, grouped by the module they are in.
 *
 * Which is how the canvas's fields column shows a page's content, and a
 * references list has the same shape: several fields in one or two modules. Flat,
 * every row repeated its module path as a subtitle — the same string over and
 * over, taking a line per row from the part that differs.
 *
 * Insertion order is kept: the scan produces references in tree order, which puts
 * the module the reader is already in first more often than any sort would.
 */
function groupByModule(items: readonly ReferencesListItem[]): {
  moduleFilePath: ModuleFilePath;
  label: string;
  items: ReferencesListItem[];
}[] {
  const groups = new Map<ModuleFilePath, ReferencesListItem[]>();
  for (const item of items) {
    const existing = groups.get(item.moduleFilePath);
    if (existing) existing.push(item);
    else groups.set(item.moduleFilePath, [item]);
  }
  return Array.from(groups.entries()).map(([moduleFilePath, groupItems]) => ({
    moduleFilePath,
    label: prettifyModuleFilePath(moduleFilePath),
    items: groupItems,
  }));
}

export interface ReferencesListProps {
  items: ReferencesListItem[];
  currentPath?: SourcePath | null;
  onSelect: (item: ReferencesListItem) => void;
  /** Placeholder for the search input. */
  searchPlaceholder?: string;
}

export function ReferencesList({
  items,
  currentPath,
  onSelect,
  searchPlaceholder = "Filter",
}: ReferencesListProps) {
  return (
    <Command>
      <CommandInput placeholder={searchPlaceholder} />
      <CommandList>
        {items.length === 0 ? (
          <CommandEmpty>No references found.</CommandEmpty>
        ) : (
          groupByModule(items).map((group) => (
            <CommandGroup
              key={group.moduleFilePath}
              heading={group.label}
              // The module path in full on hover: the heading is prettified, and
              // the path is what a developer wants.
              title={group.moduleFilePath}
            >
              {group.items.map((item) => (
                <ReferenceRow
                  key={item.path}
                  item={item}
                  isCurrent={currentPath === item.path}
                  onSelect={() => onSelect(item)}
                />
              ))}
            </CommandGroup>
          ))
        )}
      </CommandList>
    </Command>
  );
}

export interface ConnectedReferencesListProps {
  refs: SourcePath[];
  currentPath?: SourcePath | null;
  /**
   * Called with the resolved "best" navigational target (the nearest navigable
   * schema stop, via {@link getNavPathFromAll}) and the original full reference
   * path to scroll to once navigated.
   */
  onSelect: (
    navPath: SourcePath | ModuleFilePath,
    opts: { scrollToPath: SourcePath },
  ) => void;
  searchPlaceholder?: string;
}

/**
 * Connected variant of {@link ReferencesList} that hydrates each row with
 * render-derived preview data (title/subtitle/image) from {@link useRefPreview}.
 * The pure component is preferred for stories and tests.
 */
export function ConnectedReferencesList({
  refs,
  currentPath,
  onSelect,
  searchPlaceholder = "Filter",
}: ConnectedReferencesListProps) {
  const schemasRes = useSchemas();
  const schemas = schemasRes.status === "success" ? schemasRes.data : undefined;
  const allSources = useAllSources();
  const items = refs.map((ref) => {
    const item = buildBaseItem(ref);
    const schema = schemas?.[item.moduleFilePath];
    return {
      ...item,
      isRouter: schema?.type === "record" && Boolean(schema.router),
    };
  });
  return (
    <Command>
      <CommandInput placeholder={searchPlaceholder} />
      <CommandList>
        {items.length === 0 ? (
          <CommandEmpty>No references found.</CommandEmpty>
        ) : (
          groupByModule(items).map((group) => (
            <CommandGroup
              key={group.moduleFilePath}
              heading={group.label}
              title={group.moduleFilePath}
            >
              {group.items.map((item) => (
                <ConnectedReferenceRow
                  key={item.path}
                  item={item}
                  isCurrent={currentPath === item.path}
                  onSelect={() => {
                    const navPath =
                      getNavPathFromAll(item.path, allSources, schemas) ??
                      item.path;
                    onSelect(navPath, { scrollToPath: item.path });
                  }}
                />
              ))}
            </CommandGroup>
          ))
        )}
      </CommandList>
    </Command>
  );
}

/**
 * Row used by the pure {@link ReferencesList}. The render-derived preview image
 * (if any) is taken from the item; the label is always derived from the path.
 */
function ReferenceRow({
  item,
  isCurrent,
  onSelect,
}: {
  item: ReferencesListItem;
  isCurrent: boolean;
  onSelect: () => void;
}) {
  return (
    <ReferenceRowView
      item={item}
      isCurrent={isCurrent}
      onSelect={onSelect}
      image={item.preview?.image ?? null}
    />
  );
}

/** Connected row: only the preview image is hydrated; the label is path-derived. */
function ConnectedReferenceRow({
  item,
  isCurrent,
  onSelect,
}: {
  item: ReferencesListItem;
  isCurrent: boolean;
  onSelect: () => void;
}) {
  const preview = useRefPreview(item.path);
  return (
    <ReferenceRowView
      item={item}
      isCurrent={isCurrent}
      onSelect={onSelect}
      image={preview?.image ?? null}
    />
  );
}

function ReferenceRowView({
  item,
  isCurrent,
  onSelect,
  image,
}: {
  item: ReferencesListItem;
  isCurrent: boolean;
  onSelect: () => void;
  image: DropdownPreviewImage;
}) {
  const hasPatchPath = item.patchPath.length > 0;
  const moduleFilePathLabel = prettifyModuleFilePath(item.moduleFilePath);
  return (
    <CommandItem
      value={`${item.preview?.title ?? ""} ${item.fallbackLabel}`}
      onSelect={onSelect}
      // The canvas's field row, in a menu: a bordered card, and the one you are
      // already on marked by its border rather than by a tick in a gutter every
      // other row leaves empty.
      className={cn(
        "flex items-center gap-2 rounded-lg border px-2.5 py-2 text-[0.8125rem]",
        isCurrent
          ? "border-border-brand-primary bg-bg-float-raised"
          : "border-border-float",
      )}
      title={item.path}
    >
      <DropdownPreviewRow
        title={
          hasPatchPath ? (
            <ReferenceLabel
              patchPath={item.patchPath}
              isRouter={item.isRouter ?? false}
            />
          ) : (
            moduleFilePathLabel
          )
        }
        // No module path here: the group heading above says it, once, instead of
        // every row saying the same thing.
        image={image}
        imageSize="sm"
      />
    </CommandItem>
  );
}

/**
 * Primary label for a reference row. The first {@link patchPath} segment is the
 * "entry": for routers it is a route key (e.g. `/blogs/blog2`) rendered as a
 * `/`-separated route path; otherwise it is a record/array key shown verbatim.
 * The remaining segments are the field inside, prettified and `/`-joined, set
 * off with a chevron. Wraps (no truncation) so long labels flow onto new lines.
 */
function ReferenceLabel({
  patchPath,
  isRouter,
}: {
  patchPath: string[];
  isRouter: boolean;
}) {
  const [entryKey, ...fields] = patchPath;
  return (
    <span className="block truncate">
      {isRouter ? (
        <RouteKey route={entryKey} />
      ) : (
        <span className="text-fg-primary">{entryKey}</span>
      )}
      {fields.length > 0 && (
        <>
          <ChevronRight
            size={12}
            className="mx-0.5 inline-block shrink-0 text-fg-tertiary align-[-1px]"
          />
          {fields.map((field, index) => (
            <Fragment key={index}>
              {index > 0 && <span className="text-fg-tertiary"> / </span>}
              <span className="text-fg-primary">{prettifyFilename(field)}</span>
            </Fragment>
          ))}
        </>
      )}
    </span>
  );
}

/** Renders a route key (e.g. `/blogs/blog2`) as a `/`-separated path with muted slashes. */
function RouteKey({ route }: { route: string }) {
  const parts = route.split("/").filter((part) => part.length > 0);
  if (parts.length === 0) {
    return <span className="text-fg-primary">{route}</span>;
  }
  return (
    <span>
      {parts.map((part, index) => (
        <Fragment key={index}>
          <span className="text-fg-tertiary">/</span>
          <span className="text-fg-primary">{part}</span>
        </Fragment>
      ))}
    </span>
  );
}

/** Prettified, `/`-separated module file path, e.g. `App / Blogs / Blog`. */
function prettifyModuleFilePath(moduleFilePath: ModuleFilePath): string {
  return Internal.splitModuleFilePath(moduleFilePath)
    .map(prettifyFilename)
    .join(" / ");
}

export function buildBaseItem(path: SourcePath): ReferencesListItem {
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(path);
  const patchPath = Internal.createPatchPath(modulePath);
  const moduleLabel = prettifyFilename(
    Internal.splitModuleFilePath(moduleFilePath).pop() || "",
  );
  const fallbackLabel = patchPath.length
    ? `${moduleLabel} → ${patchPath.join(" → ")}`
    : moduleLabel;
  return {
    path,
    moduleFilePath,
    patchPath,
    fallbackLabel,
  };
}
