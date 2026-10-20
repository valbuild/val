import { normalizePath } from "./pnpmLayout";

/**
 * Files in memory, with directory symlinks: enough of a disk for
 * TypeScript's module resolution to see `node_modules` as pnpm leaves it.
 *
 * Files are written at their real paths. A link maps a path to the directory
 * it points at, and every read goes through `realpath` first, so
 * `/project/node_modules/react/index.d.ts` reads the file written at
 * `/project/node_modules/.pnpm/react@19.3.0/node_modules/react/index.d.ts`.
 *
 * The directory index is what makes resolution work, and it needs two things
 * a list of files does not give: every directory a file is in (TypeScript
 * asks `directoryExists` before it looks inside), and every linked directory
 * -- a link's own name is listed in its parent, and the directory it points
 * at exists even before anything has been written into it. Without the
 * first, packages are reported missing; without the second, so are packages
 * whose files have not been fetched, and `node_modules/@types` cannot be
 * listed.
 *
 * Every lookup of a path is also reported to `onLookup`, with the real path
 * it resolved to, so that a caller can tell which packages TypeScript went
 * looking in.
 */
export class LinkedFileSystem {
  private readonly files = new Map<string, string>();
  /** Real directory → the names of its entries, files and directories (links included). */
  private readonly directories = new Map<
    string,
    { files: Set<string>; directories: Set<string> }
  >();
  private readonly links: Map<string, string>;
  /** The links never change, so neither does a path's real path. */
  private readonly realpaths = new Map<string, string>();
  onLookup: ((realPath: string) => void) | null = null;

  constructor(links: Map<string, string>) {
    this.links = links;
    this.addDirectory("/");
    for (const [link, target] of links) {
      this.addDirectory(target);
      this.addEntry(link, "directory");
    }
  }

  private entriesOf(realDir: string) {
    let entries = this.directories.get(realDir);
    if (!entries) {
      entries = { files: new Set(), directories: new Set() };
      this.directories.set(realDir, entries);
    }
    return entries;
  }

  /** `dir` and every directory above it. */
  private addDirectory(dir: string) {
    for (let at = dir; ; at = parentOf(at)) {
      const known = this.directories.has(at);
      this.entriesOf(at);
      if (at === "/") return;
      this.entriesOf(parentOf(at)).directories.add(baseName(at));
      if (known) return;
    }
  }

  /** Lists `path` in its parent; the parent's real path, as `path` may sit under a link. */
  private addEntry(path: string, kind: "file" | "directory") {
    const parent = this.realpath(parentOf(path));
    this.addDirectory(parent);
    const entries = this.entriesOf(parent);
    if (kind === "file") entries.files.add(baseName(path));
    else entries.directories.add(baseName(path));
  }

  /** Resolves every link along `path`, as `fs.realpathSync` does. */
  realpath(path: string): string {
    const known = this.realpaths.get(path);
    if (known !== undefined) return known;
    const real = this.resolveLinks(path);
    this.realpaths.set(path, real);
    return real;
  }

  private resolveLinks(path: string): string {
    let current = normalizePath(path);
    for (let hops = 0; hops < 40; hops++) {
      const segments = current.split("/").slice(1);
      let resolved: string | null = null;
      for (let i = segments.length; i > 0; i--) {
        const prefix = `/${segments.slice(0, i).join("/")}`;
        const target = this.links.get(prefix);
        if (target !== undefined) {
          const rest = segments.slice(i).join("/");
          resolved = rest === "" ? target : `${target}/${rest}`;
          break;
        }
      }
      if (resolved === null) return current;
      current = resolved;
    }
    return current;
  }

  writeFile(realPath: string, text: string) {
    const path = normalizePath(realPath);
    this.files.set(path, text);
    this.addEntry(path, "file");
  }

  private lookup(path: string): string {
    const real = this.realpath(path);
    this.onLookup?.(real);
    return real;
  }

  readFile(path: string): string | undefined {
    return this.files.get(this.lookup(path));
  }

  fileExists(path: string): boolean {
    return this.files.has(this.lookup(path));
  }

  directoryExists(path: string): boolean {
    return this.directories.has(this.lookup(path));
  }

  /** The directories in `path`, links to directories included. */
  getDirectories(path: string): string[] {
    const entries = this.directories.get(this.lookup(path));
    return entries ? [...entries.directories].sort() : [];
  }

  /** The files in `path`. */
  getFiles(path: string): string[] {
    const entries = this.directories.get(this.lookup(path));
    return entries ? [...entries.files].sort() : [];
  }

  /** Every file written, by real path. */
  allFiles(): IterableIterator<string> {
    return this.files.keys();
  }
}

export function parentOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash <= 0 ? "/" : path.slice(0, slash);
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}
