import { LinkedFileSystem, parentOf } from "./linkedFileSystem";
import type { LayoutPackage, PnpmLayout } from "./pnpmLayout";
import type { CompilerBundle, TypeScript } from "./typescriptCompiler";

/**
 * adept's `/types/<partition>/<name>@<version>`: a package version's
 * declaration files and every `package.json`, by path relative to the
 * package's root, and the names of its JavaScript files.
 */
export type TypesBundle = { files: Record<string, string>; stubs: string[] };

export type PackageRef = {
  name: string;
  version: string;
  integrity: string | null;
};

/**
 * Where bundles and compilers come from. In the Studio that is adept,
 * through the Studio's server (`adeptSources.ts`); tests and Node scripts
 * give their own.
 */
export type TypecheckSources = {
  types(pkg: PackageRef): Promise<TypesBundle>;
  compiler(version: string): Promise<CompilerBundle>;
};

/**
 * A failed request for a bundle or a compiler, by what can be done about it.
 * `status` 401 means signed out, and stops the whole check: every other
 * request would fail the same way.
 */
export class SourceError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
    readonly status: number | null = null,
  ) {
    super(message);
  }
}

/** A package whose types could not be had, so the check that follows is incomplete. */
export type MissingTypes = PackageRef & {
  code: string;
  message: string;
  retryable: boolean;
};

export type AcquisitionStats = {
  /** Bundles fetched because an import or a type reference named them. */
  scanned: number;
  /** Bundles fetched because TypeScript went looking in them while resolving. */
  resolved: number;
  files: number;
  stubs: number;
  /** Characters of declaration text, about the bytes once unpacked. */
  bytes: number;
};

const DECLARATION = /\.d\.[mc]?ts$/;

/**
 * The package a bare specifier names: `react` of `react/jsx-runtime`,
 * `@tanstack/react-router` of itself. `null` for anything that is not looked
 * up in `node_modules`: relative and absolute paths, `#subpath` imports and
 * `node:` and other schemes.
 */
export function packageNameOf(specifier: string): string | null {
  if (
    specifier === "" ||
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("#") ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(specifier)
  ) {
    return null;
  }
  const parts = specifier.split("/");
  if (specifier.startsWith("@")) {
    return parts[0]!.length > 1 && parts[1] ? `${parts[0]}/${parts[1]}` : null;
  }
  return parts[0]!;
}

/** `@types/node` for `node`, `@types/scope__name` for `@scope/name`. */
export function typesPackageOf(name: string): string {
  return `@types/${name.startsWith("@") ? name.slice(1).replace("/", "__") : name}`;
}

/** The package directory a real path is in: up to the name after its last `node_modules`. */
export function packageDirOf(realPath: string): string | null {
  const at = realPath.lastIndexOf("/node_modules/");
  if (at < 0) return null;
  const rest = realPath.slice(at + "/node_modules/".length).split("/");
  const name = rest[0]!.startsWith("@") ? rest.slice(0, 2).join("/") : rest[0]!;
  if (
    name === "" ||
    name.startsWith(".") ||
    (name.startsWith("@") && !name.includes("/"))
  ) {
    return null;
  }
  return `${realPath.slice(0, at)}/node_modules/${name}`;
}

/** A bundle path that stays inside its package. */
function isSafeRelative(path: string): boolean {
  return (
    path !== "" &&
    !path.startsWith("/") &&
    !path.split("/").some((segment) => segment === ".." || segment === "")
  );
}

/**
 * Fetches the types a project's imports reach, and only those, and writes
 * each bundle at its snapshot's directory in the virtual store, so that the
 * layout's links make it visible wherever pnpm would.
 *
 * {@link wantImportsOf} scans a file's imports and type references; each
 * bare one is looked for as Node looks for it, from the file's directory up
 * through each `node_modules` (and its `@types` twin), and the nearest level
 * that has it is fetched. A fetched bundle's declaration files are scanned in
 * turn, so type dependencies are followed transitively. {@link wantPackage}
 * fetches a package by directory, for when TypeScript itself went looking in
 * one.
 */
export class TypeAcquisition {
  private readonly started = new Set<string>();
  private readonly running = new Set<Promise<void>>();
  private readonly queue: { dir: string; via: "scanned" | "resolved" }[] = [];
  private fatal: unknown = null;
  readonly missing: MissingTypes[] = [];
  readonly stats: AcquisitionStats = {
    scanned: 0,
    resolved: 0,
    files: 0,
    stubs: 0,
    bytes: 0,
  };

  constructor(
    private readonly ts: TypeScript,
    private readonly fs: LinkedFileSystem,
    private readonly layout: PnpmLayout,
    private readonly sources: TypecheckSources,
    private readonly concurrency = 8,
  ) {}

  /** Whether `dir` is a package this has fetched, or tried to. */
  has(dir: string): boolean {
    return this.started.has(dir);
  }

  /** The installed package at a real directory, if it is one. */
  packageAt(dir: string): LayoutPackage | undefined {
    return this.layout.packages.get(dir);
  }

  /**
   * The packages a bare name reaches from `fromDir`: at the nearest
   * `node_modules` that has the package or its `@types`, both.
   */
  findPackages(fromDir: string, name: string): string[] {
    const typesName = typesPackageOf(name);
    for (let at = fromDir; ; at = parentOf(at)) {
      const modules = at === "/" ? "/node_modules" : `${at}/node_modules`;
      const found = [name, typesName].flatMap((candidate) => {
        const real = this.fs.realpath(`${modules}/${candidate}`);
        return this.layout.packages.has(real) ? [real] : [];
      });
      if (found.length > 0) return found;
      if (at === "/") return [];
    }
  }

  /** Wants what a bare specifier names, from a file in `fromDir`. */
  wantSpecifier(fromDir: string, specifier: string) {
    const name = packageNameOf(specifier);
    if (name === null) return;
    for (const dir of this.findPackages(fromDir, name)) {
      this.wantPackage(dir, "scanned");
    }
  }

  /** Wants every package a file's imports and type references reach. */
  wantImportsOf(realPath: string, text: string) {
    const info = this.ts.preProcessFile(text, true, true);
    const dir = parentOf(realPath);
    for (const imported of info.importedFiles) {
      this.wantSpecifier(dir, imported.fileName);
    }
    for (const reference of info.typeReferenceDirectives) {
      this.wantSpecifier(dir, reference.fileName);
    }
  }

  wantPackage(dir: string, via: "scanned" | "resolved") {
    if (this.started.has(dir) || !this.layout.packages.has(dir)) return;
    this.started.add(dir);
    this.queue.push({ dir, via });
    this.pump();
  }

  private pump() {
    while (this.running.size < this.concurrency && this.queue.length > 0) {
      const next = this.queue.shift()!;
      const task: Promise<void> = this.fetch(next.dir, next.via).finally(() => {
        this.running.delete(task);
        this.pump();
      });
      this.running.add(task);
    }
  }

  /** Resolves when everything wanted so far, and everything that wanted, is fetched. */
  async settle(): Promise<void> {
    while (this.running.size > 0) {
      await Promise.race(this.running);
      if (this.fatal !== null) throw this.fatal;
    }
    if (this.fatal !== null) throw this.fatal;
  }

  private async fetch(dir: string, via: "scanned" | "resolved") {
    const pkg = this.layout.packages.get(dir)!;
    const ref: PackageRef = {
      name: pkg.name,
      version: pkg.version,
      integrity: pkg.integrity,
    };
    if (!pkg.fromRegistry) {
      this.missing.push({
        ...ref,
        code: "not-from-registry",
        message: `${pkg.name} is not installed from a registry by version, so its types cannot be fetched.`,
        retryable: false,
      });
      return;
    }
    let bundle: TypesBundle | null = null;
    for (let attempt = 0; attempt < 2 && bundle === null; attempt++) {
      try {
        bundle = await this.sources.types(ref);
      } catch (error) {
        if (error instanceof SourceError && error.status === 401) {
          this.fatal = error;
          return;
        }
        const retryable = error instanceof SourceError ? error.retryable : true;
        if (retryable && attempt === 0) continue;
        this.missing.push({
          ...ref,
          code: error instanceof SourceError ? error.code : "network",
          message: error instanceof Error ? error.message : String(error),
          retryable,
        });
        return;
      }
    }
    if (bundle === null) return;
    this.stats[via]++;
    for (const [path, text] of Object.entries(bundle.files)) {
      if (!isSafeRelative(path)) continue;
      this.fs.writeFile(`${dir}/${path}`, text);
      this.stats.files++;
      this.stats.bytes += text.length;
    }
    for (const stub of bundle.stubs) {
      if (!isSafeRelative(stub)) continue;
      if (!Object.prototype.hasOwnProperty.call(bundle.files, stub)) {
        this.fs.writeFile(`${dir}/${stub}`, "");
        this.stats.stubs++;
      }
    }
    for (const [path, text] of Object.entries(bundle.files)) {
      if (DECLARATION.test(path) && isSafeRelative(path)) {
        this.wantImportsOf(`${dir}/${path}`, text);
      }
    }
  }
}
