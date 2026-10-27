import { Internal, ModuleFilePath, SourcePath } from "@valbuild/core";
import { NavItemErrors } from "./types";

export type ErrorsMap = Record<SourcePath, { message: string }[]>;

/**
 * The validation errors, grouped once per render instead of scanned per node.
 *
 * Both nav trees used to walk the WHOLE error map for every row, which is
 * O(rows x errors) on every validation update - i.e. per keystroke, in the
 * component that renders the entire project's navigation. One pass builds the
 * two groupings the trees need and every lookup after that is O(1).
 */
export type NavErrorsIndex = {
  /** Keyed by the sitemap entry's own source path. */
  byEntry: Map<string, NavItemErrors>;
  /** Keyed by module file path, for explorer files. */
  byModule: Map<string, NavItemErrors>;
};

function add(
  target: Map<string, NavItemErrors>,
  key: string,
  errors: { message: string }[],
) {
  const existing = target.get(key);
  if (existing) {
    existing.ownCount += errors.length;
    // Keep the FIRST message seen, matching the scan this replaces.
    if (!existing.firstMessage) {
      existing.firstMessage = errors[0]?.message;
    }
    return;
  }
  target.set(key, {
    ownCount: errors.length,
    firstMessage: errors[0]?.message,
  });
}

export function indexNavErrors(errorsMap: ErrorsMap): NavErrorsIndex {
  const byEntry = new Map<string, NavItemErrors>();
  const byModule = new Map<string, NavItemErrors>();
  for (const keyString in errorsMap) {
    const errors = errorsMap[keyString as SourcePath];
    if (!errors || errors.length === 0) {
      continue;
    }
    const [moduleFilePath, modulePath] =
      Internal.splitModuleFilePathAndModulePath(keyString as SourcePath);
    add(byModule, moduleFilePath, errors);

    // A sitemap entry is the module plus ONE key, and every error inside the
    // entry - however deep - belongs to that row.
    const segments = Internal.splitModulePath(modulePath);
    const entryPath =
      segments.length > 0
        ? Internal.createValPathOfItem(
            moduleFilePath as string as SourcePath,
            segments[0],
          )
        : (moduleFilePath as string as SourcePath);
    if (entryPath) {
      add(byEntry, entryPath, errors);
    }
  }
  return { byEntry, byModule };
}

/** Errors that resolve to one sitemap row (the entry and anything under it). */
export function errorsForSitemapEntry(
  index: NavErrorsIndex,
  sourcePath: SourcePath,
): NavItemErrors | undefined {
  return index.byEntry.get(sourcePath);
}

/** Errors that resolve to one explorer file. */
export function errorsForModuleFilePath(
  index: NavErrorsIndex,
  fullPath: string,
): NavItemErrors | undefined {
  return index.byModule.get(fullPath as ModuleFilePath);
}
