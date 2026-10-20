import { parseAllDocuments } from "yaml";

/**
 * The parts of a `pnpm-lock.yaml` (lockfile version 9) that decide what
 * `pnpm install` puts in `node_modules`.
 *
 * Only what the layout needs is kept: each importer's direct dependencies,
 * each package's integrity and platform constraints, and each snapshot's own
 * dependencies. Everything is a plain string as pnpm wrote it -- a reference
 * such as `19.3.0(react@19.3.0)` is turned into a snapshot key by
 * {@link snapshotKeyOf}, as pnpm's lockfile crate does.
 */
export type PnpmLockfile = {
  importers: Record<string, ImporterSnapshot>;
  /** Keyed `<name>@<version>`, without peers. */
  packages: Record<string, PackageInfo>;
  /** Keyed `<name>@<version>(<peer>)…`: one per installed copy. */
  snapshots: Record<string, SnapshotInfo>;
};

/** An importer's dependencies, alias to the reference pnpm locked it at. */
export type ImporterSnapshot = {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  optionalDependencies: Record<string, string>;
};

export type PackageInfo = {
  integrity: string | null;
  /** `resolution.tarball`, for a package that is not at its registry's standard place. */
  tarball: string | null;
  os: string[] | null;
  cpu: string[] | null;
  libc: string[] | null;
  hasBin: boolean;
};

export type SnapshotInfo = {
  dependencies: Record<string, string>;
  optionalDependencies: Record<string, string>;
  optional: boolean;
};

/** A lockfile this cannot read: not YAML, or not pnpm's version 9 shape. */
export class LockfileError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** YAML reads `1.0` as a number; a lockfile means the text. */
function textOf(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function stringList(value: unknown): string[] | null {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const text = textOf(item);
      return text === null ? [] : [text];
    });
  }
  const text = textOf(value);
  return text === null ? null : [text];
}

/** `alias: <reference>` in a snapshot, or `alias: { specifier, version }` in an importer. */
function referenceMap(value: unknown, where: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (value === undefined || value === null) return out;
  if (!isRecord(value)) {
    throw new LockfileError(`${where} is not a map of dependencies.`);
  }
  for (const [alias, entry] of Object.entries(value)) {
    const version = isRecord(entry) ? textOf(entry["version"]) : textOf(entry);
    if (version === null) {
      throw new LockfileError(`${where} has no version for ${alias}.`);
    }
    out[alias] = version;
  }
  return out;
}

/**
 * Reads a pnpm 9 lockfile. pnpm 11 and later may put a document of their own
 * (the package manager's dependencies) before the project's, so the document
 * read is the one that has `importers`.
 */
export function parsePnpmLockfile(text: string): PnpmLockfile {
  let documents: unknown[];
  try {
    documents = parseAllDocuments(text).flatMap((document) => {
      if (!("toJS" in document)) return [];
      if (document.errors.length > 0) {
        throw new LockfileError(document.errors[0]!.message);
      }
      return [document.toJS({ maxAliasCount: -1 })];
    });
  } catch (error) {
    if (error instanceof LockfileError) throw error;
    throw new LockfileError(
      `pnpm-lock.yaml is not YAML: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const lockfile = documents.find(
    (document) => isRecord(document) && "importers" in document,
  );
  if (!isRecord(lockfile)) {
    throw new LockfileError("pnpm-lock.yaml has no importers.");
  }
  const version = textOf(lockfile["lockfileVersion"]);
  if (version === null || !/^9(\.|$)/.test(version)) {
    throw new LockfileError(
      `pnpm-lock.yaml is lockfile version ${version ?? "(none)"}; only version 9 (pnpm 9 and later) can be read.`,
    );
  }

  const importers: Record<string, ImporterSnapshot> = {};
  const rawImporters = lockfile["importers"];
  if (!isRecord(rawImporters)) {
    throw new LockfileError("pnpm-lock.yaml's importers is not a map.");
  }
  for (const [id, raw] of Object.entries(rawImporters)) {
    const importer = isRecord(raw) ? raw : {};
    const where = `importer '${id}'`;
    importers[id] = {
      dependencies: referenceMap(importer["dependencies"], where),
      devDependencies: referenceMap(importer["devDependencies"], where),
      optionalDependencies: referenceMap(
        importer["optionalDependencies"],
        where,
      ),
    };
  }

  const packages: Record<string, PackageInfo> = {};
  const rawPackages = lockfile["packages"];
  if (isRecord(rawPackages)) {
    for (const [key, raw] of Object.entries(rawPackages)) {
      const info = isRecord(raw) ? raw : {};
      const resolution = isRecord(info["resolution"]) ? info["resolution"] : {};
      packages[key] = {
        integrity: textOf(resolution["integrity"]),
        tarball: textOf(resolution["tarball"]),
        os: stringList(info["os"]),
        cpu: stringList(info["cpu"]),
        libc: stringList(info["libc"]),
        hasBin: info["hasBin"] === true,
      };
    }
  }

  const snapshots: Record<string, SnapshotInfo> = {};
  const rawSnapshots = lockfile["snapshots"];
  if (isRecord(rawSnapshots)) {
    for (const [key, raw] of Object.entries(rawSnapshots)) {
      const snapshot = isRecord(raw) ? raw : {};
      const where = `snapshot '${key}'`;
      snapshots[key] = {
        dependencies: referenceMap(snapshot["dependencies"], where),
        optionalDependencies: referenceMap(
          snapshot["optionalDependencies"],
          where,
        ),
        optional: snapshot["optional"] === true,
      };
    }
  }
  return { importers, packages, snapshots };
}

/**
 * The index of the `@` between a key's name and its version: the first one
 * after a scope's leading `@`.
 */
function versionSeparator(key: string): number {
  return key.indexOf("@", 1);
}

/** `@scope/name` of `@scope/name@1.0.0(peer@2.0.0)`. */
export function nameOfKey(key: string): string {
  const at = versionSeparator(key);
  return at < 0 ? key : key.slice(0, at);
}

/** `1.0.0` of `@scope/name@1.0.0(peer@2.0.0)`: the version, without peers. */
export function versionOfKey(key: string): string {
  const at = versionSeparator(key);
  const rest = at < 0 ? "" : key.slice(at + 1);
  const peers = rest.indexOf("(");
  return peers < 0 ? rest : rest.slice(0, peers);
}

/** The `packages:` key a snapshot key's metadata is under: the key without its peers. */
export function packageKeyOf(snapshotKey: string): string {
  return `${nameOfKey(snapshotKey)}@${versionOfKey(snapshotKey)}`;
}

/**
 * Whether a reference names another package (an npm alias, `foo:
 * string-width@4.2.3`) rather than a version of the alias itself. pnpm's
 * `looks_like_alias`: a leading `@` is a scoped name, and otherwise the `@`
 * has to come before any `:` or `(`.
 */
function looksLikeAlias(reference: string): boolean {
  if (reference.startsWith("@")) return true;
  const at = reference.indexOf("@");
  if (at < 0) return false;
  const colon = reference.indexOf(":");
  const paren = reference.indexOf("(");
  return (colon < 0 || at < colon) && (paren < 0 || at < paren);
}

/**
 * The snapshot a dependency reference points at, or `null` for a `link:` to
 * a directory (a workspace sibling), which is not in the virtual store.
 */
export function snapshotKeyOf(alias: string, reference: string): string | null {
  if (reference.startsWith("link:")) return null;
  if (looksLikeAlias(reference)) return reference;
  return `${alias}@${reference}`;
}
