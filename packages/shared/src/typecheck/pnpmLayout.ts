import {
  nameOfKey,
  packageKeyOf,
  snapshotKeyOf,
  versionOfKey,
  type PackageInfo,
  type PnpmLockfile,
} from "./pnpmLockfile";
import { sha256Hex } from "./sha256";

/**
 * What `pnpm install --frozen-lockfile` puts in `node_modules`, computed from
 * the lockfile alone, as a table of symlinks.
 *
 * Ported from pnpm's own crates (valbuild/pnpm, pacquet 12.13.0):
 * `deps-path/src/dep_path_to_filename.rs` names each snapshot's directory in
 * the virtual store, and `deps-restorer/src/hoist.rs` decides which
 * transitive dependencies are also linked into the private hoist
 * (`node_modules/.pnpm/node_modules`). The defaults are pnpm 12's: hoist
 * `["*"]` privately, nothing publicly, virtual store names at most 120 bytes,
 * no global virtual store. `pnpmLayout.test.ts` compares the result with
 * what a real install left on disk.
 *
 * Every path is absolute, under `root` (default `/project`), with `/`
 * separators.
 */
export type PnpmLayout = {
  root: string;
  /** `<root>/node_modules/.pnpm` */
  virtualStore: string;
  /** Every symlink: its own path, to the absolute directory it points at. */
  links: Map<string, string>;
  /** Every installed snapshot, by the directory its package's files are in. */
  packages: Map<string, LayoutPackage>;
  /** Each importer's directory, by its id (`.` is the root project). */
  importers: Map<string, string>;
  /** Snapshots `pnpm install` would skip: optional, and not for this platform. */
  skipped: Set<string>;
};

export type LayoutPackage = {
  /** The snapshot key: `name@version(peers)`. */
  snapshot: string;
  name: string;
  version: string;
  /** `null` for a package the lockfile does not give an integrity for (a tarball URL, git). */
  integrity: string | null;
  /** Whether it comes from a registry by name and version, so its types can be asked for. */
  fromRegistry: boolean;
};

/** What `pnpm install` checks optional packages' `os`, `cpu` and `libc` against. */
export type Platform = { os: string; cpu: string; libc: string | null };

export type LayoutOptions = {
  root?: string;
  /** `null` installs every optional package, whatever it is built for. */
  platform?: Platform | null;
  hoistPattern?: string[];
  publicHoistPattern?: string[];
  virtualStoreDirMaxLength?: number;
  /**
   * Each workspace project's `name`, by importer id, from its package.json.
   * The lockfile does not carry them, and pnpm links every named project
   * into the hoist as well (`hoist-workspace-packages`).
   */
  workspaceNames?: Record<string, string>;
  /** `hoistWorkspacePackages`, on unless the workspace turns it off. */
  hoistWorkspacePackages?: boolean;
};

/**
 * Linux on x64 with glibc: what a CI runner and the build are, and so the
 * install the typecheck is compared with. It only decides which optional,
 * platform-specific packages exist, which hardly ever carry types.
 */
export const DEFAULT_PLATFORM: Platform = {
  os: "linux",
  cpu: "x64",
  libc: "glibc",
};

const DEFAULT_VIRTUAL_STORE_DIR_MAX_LENGTH = 120;

const encoder = new TextEncoder();
const byteLength = (text: string) => encoder.encode(text).length;

/** The first 32 hex characters of the SHA-256 of `input`: pnpm's `create_short_hash`. */
function shortHash(input: string): string {
  return sha256Hex(input).slice(0, 32);
}

/** The longest prefix of `text` that is at most `bytes` bytes of UTF-8. */
function prefixOfBytes(text: string, bytes: number): string {
  if (byteLength(text) <= bytes) return text;
  let out = "";
  let used = 0;
  for (const char of text) {
    const size = byteLength(char);
    if (used + size > bytes) break;
    out += char;
    used += size;
  }
  return out;
}

function hashSuffixVirtualStoreName(
  filename: string,
  hashInput: string,
  maxLength: number,
): string {
  const cap = Math.max(0, maxLength - 33);
  return `${prefixOfBytes(filename, cap)}_${shortHash(hashInput)}`;
}

function shortenVirtualStoreName(filename: string, maxLength: number): string {
  const needsShortening =
    byteLength(filename) > maxLength ||
    (filename !== filename.toLowerCase() && !filename.startsWith("file+"));
  return needsShortening
    ? hashSuffixVirtualStoreName(filename, filename, maxLength)
    : filename;
}

const RESERVED_VERSION_PREFIXES = new Set([
  "bitbucket",
  "catalog",
  "custom",
  "file",
  "git",
  "github",
  "gitlab",
  "http",
  "https",
  "jsr",
  "link",
  "npm",
  "pkg",
  "runtime",
  "ssh",
  "tool",
  "workspace",
]);

const SEMVER =
  /^v?\d+\.\d+\.\d+(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;

/** `registry:1.0.0`: a version qualified by a named registry, which escapes unambiguously. */
function isRegistryQualifiedVersion(version: string): boolean {
  const colon = version.indexOf(":");
  if (colon < 0) return false;
  const registry = version.slice(0, colon);
  return (
    registry !== "" &&
    !RESERVED_VERSION_PREFIXES.has(registry) &&
    /^[A-Za-z][A-Za-z0-9._-]*$/.test(registry) &&
    SEMVER.test(version.slice(colon + 1))
  );
}

/**
 * Whether escaping the URL or path of a non-registry dependency could map
 * two distinct dep paths to one name (`has_ambiguous_escape`).
 */
function hasAmbiguousEscape(depPath: string): boolean {
  let packageId = depPath.split("(")[0] ?? "";
  if (packageId.startsWith("/")) packageId = packageId.slice(1);
  let version: string;
  if (packageId.startsWith("file:")) {
    version = packageId;
  } else {
    const at = packageId.indexOf("@", 1);
    if (at < 0) return false;
    version = packageId.slice(at + 1);
  }
  const colon = version.indexOf(":");
  if (colon < 0) return false;
  if (isRegistryQualifiedVersion(version)) return false;
  let location = version.slice(colon + 1);
  if (location.startsWith("//")) location = location.slice(2);
  return /[+\\:*?"<>|#]/.test(location);
}

function depPathToFilenameUnescaped(depPath: string): string {
  if (depPath.startsWith("file:")) return depPath.replace(":", "+");
  const trimmed = depPath.startsWith("/") ? depPath.slice(1) : depPath;
  return trimmed;
}

/**
 * The directory name of a snapshot in the virtual store: pnpm's
 * `dep_path_to_filename`. `@scope/foo@1.0.0(bar@2.0.0)` is
 * `@scope+foo@1.0.0_bar@2.0.0`; a name longer than `maxLength` bytes, or with
 * upper case letters, is cut and given a hash of the whole.
 */
export function depPathToFilename(
  depPath: string,
  maxLength = DEFAULT_VIRTUAL_STORE_DIR_MAX_LENGTH,
): string {
  let filename = depPathToFilenameUnescaped(depPath).replace(
    /[\\/:*?"<>|#]/g,
    "+",
  );
  if (filename.includes("(")) {
    if (filename.endsWith(")")) filename = filename.slice(0, -1);
    filename = filename.split(")(").join("_").replace(/[()]/g, "_");
  }
  const kept = filename.replace(/[. ]+$/, "").length;
  const trailing = filename.length - kept;
  const ambiguous = hasAmbiguousEscape(depPath);
  if (trailing > 0) {
    const escaped = filename.slice(0, kept) + "+".repeat(trailing);
    return hashSuffixVirtualStoreName(
      escaped,
      ambiguous ? depPath : filename,
      maxLength,
    );
  }
  if (ambiguous) {
    return hashSuffixVirtualStoreName(filename, depPath, maxLength);
  }
  return shortenVirtualStoreName(filename, maxLength);
}

/**
 * pnpm's `WildcardMatcher` lists: `*` is any run of characters, `?` one, a
 * leading `!` excludes, and a later exclude cancels an earlier include.
 */
export function createMatcher(patterns: string[]): (input: string) => boolean {
  if (patterns.length === 0) return () => false;
  const compiled = patterns.map((pattern) => {
    const ignore = pattern.startsWith("!");
    const glob = ignore ? pattern.slice(1) : pattern;
    const source = glob
      .split("")
      .map((char) =>
        char === "*"
          ? ".*"
          : char === "?"
            ? "."
            : char.replace(/[.+^${}()|[\]\\]/g, "\\$&"),
      )
      .join("");
    return { ignore, regexp: new RegExp(`^${source}$`, "s") };
  });
  const hasInclude = compiled.some((pattern) => !pattern.ignore);
  const hasIgnore = compiled.some((pattern) => pattern.ignore);
  if (compiled.length === 1) {
    const only = compiled[0]!;
    return (input) => only.regexp.test(input) !== only.ignore;
  }
  if (!hasIgnore) {
    return (input) => compiled.some((pattern) => pattern.regexp.test(input));
  }
  if (!hasInclude) {
    return (input) => !compiled.some((pattern) => pattern.regexp.test(input));
  }
  return (input) => {
    let matched = false;
    for (const pattern of compiled) {
      if (!pattern.regexp.test(input)) continue;
      matched = !pattern.ignore;
    }
    return matched;
  };
}

/** npm's `checkList`: `any`, a list of allowed values, or of `!`excluded ones. */
function platformAllows(list: string[] | null, value: string | null): boolean {
  if (list === null || list.length === 0) return true;
  if (list.length === 1 && list[0] === "any") return true;
  if (value === null) return true;
  let match = false;
  let excluded = 0;
  for (const entry of list) {
    if (entry.startsWith("!")) {
      if (entry.slice(1) === value) return false;
      excluded++;
    } else if (entry === value) {
      match = true;
    }
  }
  return match || excluded === list.length;
}

const OS_TOKENS: Record<string, string> = {
  aix: "aix",
  android: "android",
  darwin: "darwin",
  macos: "darwin",
  osx: "darwin",
  freebsd: "freebsd",
  linux: "linux",
  netbsd: "netbsd",
  openbsd: "openbsd",
  openharmony: "openharmony",
  sunos: "sunos",
  win32: "win32",
  windows: "win32",
};
const CPU_TOKENS: Record<string, string> = {
  arm: "arm",
  armv6: "arm",
  armv7: "arm",
  arm64: "arm64",
  aarch64: "arm64",
  ia32: "ia32",
  loong64: "loong64",
  mips64el: "mips64el",
  ppc64: "ppc64",
  ppc64le: "ppc64",
  riscv64: "riscv64",
  s390x: "s390x",
  x64: "x64",
  amd64: "x64",
  wasm32: "wasm32",
};
const LIBC_TOKENS: Record<string, string> = {
  glibc: "glibc",
  gnu: "glibc",
  gnueabihf: "glibc",
  musl: "musl",
  musleabihf: "musl",
};

function tokenValues(
  tokens: string[],
  table: Record<string, string>,
): string[] | null {
  const values: string[] = [];
  for (const token of tokens) {
    const value = Object.prototype.hasOwnProperty.call(table, token)
      ? table[token]
      : undefined;
    if (value !== undefined && !values.includes(value)) values.push(value);
  }
  return values.length > 0 ? values : null;
}

/**
 * The platform an optional package is for, with what its name says filling
 * in what its manifest leaves out: `lightningcss-linux-x64-musl` declares
 * `os` and `cpu` but not `libc`. pnpm's `inferred_platform`.
 */
function wantedPlatform(
  name: string,
  info: PackageInfo,
): Pick<PackageInfo, "os" | "cpu" | "libc"> {
  if (info.os !== null && info.cpu !== null && info.libc !== null) return info;
  const bare = name.includes("/") ? name.slice(name.indexOf("/") + 1) : name;
  const tokens = bare.toLowerCase().split(/[-_.]/);
  const os = tokenValues(tokens, OS_TOKENS);
  const cpu = tokenValues(tokens, CPU_TOKENS);
  const libc = tokenValues(tokens, LIBC_TOKENS);
  if (os === null && cpu === null && libc === null) return info;
  const declares = info.os !== null || info.cpu !== null || info.libc !== null;
  if (!declares && os === null) return info;
  return {
    os: info.os ?? os,
    cpu: info.cpu ?? cpu,
    libc: info.libc ?? libc,
  };
}

function isInstallable(
  name: string,
  info: PackageInfo,
  platform: Platform,
): boolean {
  const wanted = wantedPlatform(name, info);
  return (
    platformAllows(wanted.os, platform.os) &&
    platformAllows(wanted.cpu, platform.cpu) &&
    platformAllows(wanted.libc, platform.libc)
  );
}

/**
 * The snapshots the importers reach, not passing through any in `blocked`:
 * pnpm's `collect_reachable`.
 */
function reachableSnapshots(
  lockfile: PnpmLockfile,
  blocked: Set<string>,
): Set<string> {
  const seen = new Set<string>();
  const queue: string[] = [];
  const visit = (alias: string, reference: string) => {
    const key = snapshotKeyOf(alias, reference);
    if (key === null || seen.has(key) || blocked.has(key)) return;
    if (!lockfile.snapshots[key]) return;
    seen.add(key);
    queue.push(key);
  };
  for (const importer of Object.values(lockfile.importers)) {
    for (const group of [
      importer.dependencies,
      importer.devDependencies,
      importer.optionalDependencies,
    ]) {
      for (const [alias, reference] of Object.entries(group)) {
        visit(alias, reference);
      }
    }
  }
  for (let key = queue.shift(); key !== undefined; key = queue.shift()) {
    const snapshot = lockfile.snapshots[key]!;
    for (const group of [
      snapshot.dependencies,
      snapshot.optionalDependencies,
    ]) {
      for (const [alias, reference] of Object.entries(group)) {
        visit(alias, reference);
      }
    }
  }
  return seen;
}

/**
 * The snapshots `pnpm install` leaves out on `platform`: the optional ones
 * that are not for it (`compute_skipped_snapshots`), and then everything the
 * importers can reach only through one of those
 * (`extend_skipped_with_dependency_closure`).
 */
function skippedSnapshots(
  lockfile: PnpmLockfile,
  platform: Platform,
): Set<string> {
  const skipped = new Set<string>();
  for (const [key, snapshot] of Object.entries(lockfile.snapshots)) {
    const info = lockfile.packages[packageKeyOf(key)];
    if (
      snapshot.optional &&
      info &&
      !isInstallable(nameOfKey(key), info, platform)
    ) {
      skipped.add(key);
    }
  }
  if (skipped.size === 0) return skipped;
  const all = reachableSnapshots(lockfile, new Set());
  const kept = reachableSnapshots(lockfile, skipped);
  for (const key of all) {
    if (!kept.has(key)) skipped.add(key);
  }
  return skipped;
}

/** `a/b/../c` → `a/c`, for absolute `/`-separated paths. */
export function normalizePath(path: string): string {
  const out: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") out.pop();
    else out.push(segment);
  }
  return `/${out.join("/")}`;
}

type HoistKind = "private" | "public";

/** Each hoisted alias: a snapshot in the virtual store, or a workspace project's directory. */
type Hoisted = Map<
  string,
  { kind: HoistKind; target: { snapshot: string } | { dir: string } }
>;

type HoistNode = {
  children: Map<string, string>;
  sortKey: string;
};

/** Dependencies, then optional ones, each sorted by alias: `snapshot_children`. */
function snapshotChildren(
  lockfile: PnpmLockfile,
  key: string,
): Map<string, string> {
  const snapshot = lockfile.snapshots[key]!;
  const children = new Map<string, string>();
  for (const group of [snapshot.dependencies, snapshot.optionalDependencies]) {
    for (const alias of Object.keys(group).sort(compareBytes)) {
      const child = snapshotKeyOf(alias, group[alias]!);
      if (child !== null) children.set(alias, child);
    }
  }
  return children;
}

/** Rust's `str` order: by code unit, which for these names is by byte. */
function compareBytes(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Each importer's direct dependencies, alias to snapshot key, for the hoist:
 * `build_direct_deps_by_importer`. Importers in id order; within one, the
 * aliases of devDependencies, then dependencies, then optionalDependencies,
 * each sorted, with the first group that resolves an alias owning it.
 */
function directDepsByImporter(
  lockfile: PnpmLockfile,
): Map<string, Map<string, string>> {
  const result = new Map<string, Map<string, string>>();
  for (const id of Object.keys(lockfile.importers).sort(compareBytes)) {
    const importer = lockfile.importers[id]!;
    const resolved = new Map<string, string>();
    for (const group of [
      importer.dependencies,
      importer.devDependencies,
      importer.optionalDependencies,
    ]) {
      for (const [alias, reference] of Object.entries(group)) {
        const key = snapshotKeyOf(alias, reference);
        if (key !== null && !resolved.has(alias)) resolved.set(alias, key);
      }
    }
    const deps = new Map<string, string>();
    for (const group of [
      importer.devDependencies,
      importer.dependencies,
      importer.optionalDependencies,
    ]) {
      for (const alias of Object.keys(group).sort(compareBytes)) {
        const key = resolved.get(alias);
        if (key !== undefined && !deps.has(alias)) deps.set(alias, key);
      }
    }
    result.set(id, deps);
  }
  return result;
}

/**
 * Which aliases are hoisted, and to which snapshot each points:
 * `get_hoisted_dependencies`, for an install with no workspace packages to
 * hoist and root dependencies that the virtual store can reach.
 *
 * The graph is walked in pnpm's graph-walker order -- each step's children
 * are the next step, depth first over steps -- and the entries are then
 * sorted by depth and virtual-store name. The first entry to claim an alias
 * (lower-cased) wins it; the root importer's own aliases are claimed from the
 * start, as they are already in `node_modules`.
 */
function hoist(
  lockfile: PnpmLockfile,
  graph: Map<string, HoistNode>,
  skipped: Set<string>,
  kindOf: (alias: string) => HoistKind | null,
  workspacePackages: Map<string, string>,
): Hoisted {
  const direct = directDepsByImporter(lockfile);
  const merged = new Map<string, string>();
  for (const deps of direct.values()) {
    for (const [alias, key] of deps) {
      if (!merged.has(alias)) merged.set(alias, key);
    }
  }
  const visited = new Set<string>();
  const directNodes: string[] = [];
  for (const deps of direct.values()) {
    for (const key of deps.values()) {
      if (graph.has(key) && !visited.has(key)) {
        visited.add(key);
        directNodes.push(key);
      }
    }
  }
  type Entry = {
    depth: number;
    sortKey: string;
    children: Map<string, string>;
  };
  const entries: Entry[] = [{ depth: -1, sortKey: "", children: merged }];
  const steps: { nodes: string[]; depth: number }[] = [
    { nodes: directNodes, depth: 0 },
  ];
  for (let step = steps.pop(); step; step = steps.pop()) {
    for (const node of step.nodes) {
      const { sortKey, children } = graph.get(node)!;
      entries.push({ depth: step.depth, sortKey, children });
    }
    const next = step.nodes.map((node) => {
      const nodes: string[] = [];
      for (const child of graph.get(node)!.children.values()) {
        if (graph.has(child) && !visited.has(child)) {
          visited.add(child);
          nodes.push(child);
        }
      }
      return nodes;
    });
    for (const nodes of next.reverse()) {
      if (nodes.length > 0) steps.push({ nodes, depth: step.depth + 1 });
    }
  }
  entries.sort(
    (a, b) => a.depth - b.depth || compareBytes(a.sortKey, b.sortKey),
  );

  const claimed = new Set(
    [...(direct.get(".")?.keys() ?? [])].map((alias) => alias.toLowerCase()),
  );
  const hoisted: Hoisted = new Map();
  /*
   * Named workspace projects are considered after every importer's direct
   * dependencies and before anything transitive; a name that two projects
   * share (ignoring case) is hoisted for neither.
   */
  let workspaceDone = false;
  const hoistWorkspace = () => {
    workspaceDone = true;
    const candidates = [...workspacePackages].flatMap(([name, dir]) => {
      const kind = kindOf(name);
      return kind !== null && !claimed.has(name.toLowerCase())
        ? [{ name, dir, kind }]
        : [];
    });
    const counts = new Map<string, number>();
    for (const { name } of candidates) {
      const normalized = name.toLowerCase();
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }
    for (const { name, dir, kind } of candidates) {
      const normalized = name.toLowerCase();
      if (counts.get(normalized) !== 1 || claimed.has(normalized)) continue;
      claimed.add(normalized);
      hoisted.set(name, { kind, target: { dir } });
    }
  };
  for (const entry of entries) {
    if (!workspaceDone && entry.depth >= 0) hoistWorkspace();
    for (const [alias, child] of entry.children) {
      const kind = kindOf(alias);
      if (kind === null) continue;
      const normalized = alias.toLowerCase();
      if (claimed.has(normalized)) continue;
      // A missing or skipped node does not claim the alias, so a later one
      // with the same alias still can.
      if (!graph.has(child) || skipped.has(child)) continue;
      claimed.add(normalized);
      hoisted.set(alias, { kind, target: { snapshot: child } });
    }
  }
  if (!workspaceDone) hoistWorkspace();
  return hoisted;
}

/** A setting in `pnpm-workspace.yaml` the layout cannot follow. */
export class UnsupportedLayoutError extends Error {}

function isPatternList(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

/**
 * The settings in `pnpm-workspace.yaml` that change the layout: `hoist`,
 * `hoistPattern`, `publicHoistPattern`, `shamefullyHoist` and
 * `virtualStoreDirMaxLength`. pnpm 11 and later read these from there and not
 * from `.npmrc`. `nodeLinker` other than `isolated` is a different layout
 * altogether, and refused.
 */
export function layoutOptionsOfWorkspace(
  workspace: Record<string, unknown>,
): LayoutOptions {
  const options: LayoutOptions = {};
  const linker = workspace["nodeLinker"];
  if (linker !== undefined && linker !== "isolated") {
    throw new UnsupportedLayoutError(
      `pnpm-workspace.yaml sets nodeLinker to ${String(linker)}; only the default, isolated, can be typechecked.`,
    );
  }
  if (workspace["enableGlobalVirtualStore"] === true) {
    throw new UnsupportedLayoutError(
      "pnpm-workspace.yaml sets enableGlobalVirtualStore, whose layout cannot be typechecked yet.",
    );
  }
  const hoistPattern = workspace["hoistPattern"];
  if (isPatternList(hoistPattern)) options.hoistPattern = hoistPattern;
  if (workspace["hoist"] === false) options.hoistPattern = [];
  const publicHoistPattern = workspace["publicHoistPattern"];
  if (isPatternList(publicHoistPattern)) {
    options.publicHoistPattern = publicHoistPattern;
  }
  if (workspace["shamefullyHoist"] === true) options.publicHoistPattern = ["*"];
  if (workspace["hoistWorkspacePackages"] === false) {
    options.hoistWorkspacePackages = false;
  }
  const maxLength = workspace["virtualStoreDirMaxLength"];
  if (typeof maxLength === "number")
    options.virtualStoreDirMaxLength = maxLength;
  return options;
}

/** What `pnpm install` would put in `node_modules` for this lockfile. */
export function computePnpmLayout(
  lockfile: PnpmLockfile,
  options: LayoutOptions = {},
): PnpmLayout {
  const root = normalizePath(options.root ?? "/project");
  const maxLength =
    options.virtualStoreDirMaxLength ?? DEFAULT_VIRTUAL_STORE_DIR_MAX_LENGTH;
  const platform =
    options.platform === undefined ? DEFAULT_PLATFORM : options.platform;
  const virtualStore = `${root}/node_modules/.pnpm`;
  const join = (dir: string, relative: string) =>
    normalizePath(`${dir}/${relative}`);
  const importerDir = (id: string) => (id === "." ? root : join(root, id));

  const skipped =
    platform === null
      ? new Set<string>()
      : skippedSnapshots(lockfile, platform);

  const storeNames = new Map<string, string>();
  const storeName = (key: string) => {
    let name = storeNames.get(key);
    if (name === undefined) {
      name = depPathToFilename(key, maxLength);
      storeNames.set(key, name);
    }
    return name;
  };
  const packageDir = (key: string) =>
    `${virtualStore}/${storeName(key)}/node_modules/${nameOfKey(key)}`;

  const links = new Map<string, string>();
  const packages = new Map<string, LayoutPackage>();
  const importers = new Map<string, string>();

  /** A dependency reference, linked from `modulesDir/<alias>`; `link:` is relative to `base`. */
  const linkDependency = (
    modulesDir: string,
    alias: string,
    reference: string,
    base: string,
  ) => {
    const path = `${modulesDir}/${alias}`;
    if (links.has(path)) return;
    if (reference.startsWith("link:")) {
      links.set(path, join(base, reference.slice("link:".length)));
      return;
    }
    const key = snapshotKeyOf(alias, reference);
    if (key === null || skipped.has(key) || !lockfile.snapshots[key]) return;
    const target = packageDir(key);
    if (target !== path) links.set(path, target);
  };

  for (const [id, importer] of Object.entries(lockfile.importers)) {
    const dir = importerDir(id);
    importers.set(id, dir);
    for (const group of [
      importer.dependencies,
      importer.devDependencies,
      importer.optionalDependencies,
    ]) {
      for (const [alias, reference] of Object.entries(group)) {
        linkDependency(`${dir}/node_modules`, alias, reference, dir);
      }
    }
  }

  const graph = new Map<string, HoistNode>();
  for (const [key, snapshot] of Object.entries(lockfile.snapshots)) {
    const packageKey = packageKeyOf(key);
    const info = lockfile.packages[packageKey];
    if (info) {
      graph.set(key, {
        children: snapshotChildren(lockfile, key),
        sortKey: storeName(key),
      });
    }
    if (skipped.has(key)) continue;
    const dir = packageDir(key);
    const version = versionOfKey(key);
    packages.set(dir, {
      snapshot: key,
      name: nameOfKey(key),
      version,
      integrity: info?.integrity ?? null,
      fromRegistry: SEMVER.test(version) && !info?.tarball,
    });
    const modulesDir = `${virtualStore}/${storeName(key)}/node_modules`;
    for (const group of [
      snapshot.dependencies,
      snapshot.optionalDependencies,
    ]) {
      for (const [alias, reference] of Object.entries(group)) {
        linkDependency(modulesDir, alias, reference, root);
      }
    }
  }

  const isPrivate = createMatcher(options.hoistPattern ?? ["*"]);
  const isPublic = createMatcher(options.publicHoistPattern ?? []);
  const workspacePackages = new Map<string, string>();
  if (options.hoistWorkspacePackages !== false) {
    for (const [id, name] of Object.entries(options.workspaceNames ?? {})) {
      if (id !== "." && lockfile.importers[id]) {
        workspacePackages.set(name, importerDir(id));
      }
    }
  }
  const hoisted = hoist(
    lockfile,
    graph,
    skipped,
    (alias) =>
      isPublic(alias) ? "public" : isPrivate(alias) ? "private" : null,
    workspacePackages,
  );
  for (const [alias, { kind, target }] of hoisted) {
    const modulesDir =
      kind === "public"
        ? `${root}/node_modules`
        : `${virtualStore}/node_modules`;
    const path = `${modulesDir}/${alias}`;
    if (!links.has(path)) {
      links.set(
        path,
        "dir" in target ? target.dir : packageDir(target.snapshot),
      );
    }
  }

  return { root, virtualStore, links, packages, importers, skipped };
}
