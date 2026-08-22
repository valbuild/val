import fs from "fs";
import path from "path";
import { Internal } from "@valbuild/core";

/**
 * Lists the files a Val module may reference.
 *
 * Val stores referenced files under `/public/val` by convention (configurable
 * via `files.directory` in val.config), and a reference is written as the path
 * *including* the `/public` prefix — so this returns Val-style refs directly.
 */

/** Default directory, matching `files.directory` in val.config. */
export const DEFAULT_FILES_DIRECTORY = "/public/val";

/**
 * How long a directory listing is reused.
 *
 * Completions are requested per keystroke, so re-walking the tree every time is
 * wasteful; a short window keeps newly added files appearing promptly without a
 * filesystem watcher to invalidate and tear down.
 */
const CACHE_TTL_MS = 2000;

export type PublicValFile = {
  /** Val-style reference, for example `/public/val/images/logo.png`. */
  ref: string;
  /** Absolute path on disk. */
  filePath: string;
  /** Mime type derived from the extension, when recognised. */
  mimeType?: string;
};

type CacheEntry = { at: number; files: PublicValFile[] };

export type PublicValFiles = {
  /** Files under `directory`, defaulting to the project's files directory. */
  list(directory?: string): PublicValFile[];
  /** As {@link list}, but only files whose mime type starts with `image/`. */
  images(directory?: string): PublicValFile[];
  invalidate(): void;
};

export function createPublicValFiles({
  valRoot,
  directory = DEFAULT_FILES_DIRECTORY,
  now = () => Date.now(),
}: {
  valRoot: string;
  directory?: string;
  now?: () => number;
}): PublicValFiles {
  // Keyed by directory: a project has one files directory, but each gallery
  // declares its own, and completions need whichever one is in scope.
  const cache = new Map<string, CacheEntry>();

  function read(directory: string): PublicValFile[] {
    const root = path.join(valRoot, directory);
    const files: PublicValFile[] = [];

    function walk(dir: string): void {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        // Directory does not exist yet, or is not readable: no candidates.
        return;
      }
      for (const entry of entries) {
        // Skip dotfiles: .DS_Store and friends are never valid references.
        if (entry.name.startsWith(".")) {
          continue;
        }
        const absolute = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(absolute);
          continue;
        }
        const relative = path
          .relative(path.join(valRoot, directory), absolute)
          .split(path.sep)
          .join("/");
        files.push({
          ref: `${directory}/${relative}`,
          filePath: absolute,
          // Val's own extension -> mime table, rather than a vendored copy.
          mimeType: Internal.filenameToMimeType(entry.name),
        });
      }
    }
    walk(root);

    files.sort((a, b) => a.ref.localeCompare(b.ref));
    return files;
  }

  function list(dir: string = directory): PublicValFile[] {
    const at = now();
    const hit = cache.get(dir);
    if (hit && at - hit.at < CACHE_TTL_MS) {
      return hit.files;
    }
    const files = read(dir);
    cache.set(dir, { at, files });
    return files;
  }

  return {
    list,
    images: (dir) => list(dir).filter((f) => f.mimeType?.startsWith("image/")),
    invalidate: () => {
      cache.clear();
    },
  };
}
