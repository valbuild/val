import fs from "fs";
import nodePath from "path";
import ts from "typescript";
import { ModuleFilePath, SerializedSchema } from "@valbuild/core";
import { result } from "@valbuild/core/fp";
import { analyzeValModule } from "./patch/ts/valModule";
import { analyzeJsonValuesEntries } from "./patch/ts/jsonValuesModule";
import { resolveExistingJsonPath } from "./patch/jsonValuesPatch";

/**
 * The `*.val.json` files backing a `.jsonValues()` module's entries, as paths
 * relative to the project root.
 *
 * Read out of the `.val.ts` rather than off the loaded module: the entry's path
 * only exists as the string literal inside its `c.json(() => import("..."))`
 * thunk, and the loaded marker does not carry it.
 */
export function findJsonEntryFilePathsInSource(
  moduleFilePath: ModuleFilePath,
  valTsSourceFile: ts.SourceFile,
): string[] {
  let analysis;
  try {
    analysis = analyzeValModule(valTsSourceFile);
  } catch {
    return [];
  }
  if (result.isErr(analysis)) {
    return [];
  }
  const paths: string[] = [];
  analyzeJsonValuesEntries(analysis.value.source).forEach((entry) => {
    paths.push(resolveExistingJsonPath(moduleFilePath, entry.importPath));
  });
  return paths;
}

/**
 * A fingerprint of every `.jsonValues()` entry file on disk, for change
 * detection.
 *
 * Uses each file's SIZE + MTIME, never its content: reading every entry on every
 * stat would undo the point of `.jsonValues()`, and the question here is only
 * "did any of them change", not "what do they say now".
 *
 * Why this needs to exist at all: `sourcesSha` and `baseSha` are computed from
 * `JSON.stringify(source)`, and a jsonValues module's source is just markers —
 * the content is behind a thunk, which `JSON.stringify` drops. So no existing sha
 * can see an entry edit, and the Studio has no way to learn that a hand-edited
 * `*.val.json` changed.
 *
 * Deliberately NOT folded into `sourcesSha`: that is computed by the client too
 * (from the ValModules registry, which has no entry content), so the two would
 * disagree and trip the schema-out-of-date machinery.
 */
export class JsonEntryFilesFingerprint {
  /** Entry paths per module, memoized on the `.val.ts` mtime that produced them. */
  private cache = new Map<
    ModuleFilePath,
    { moduleMtimeMs: number; entryFilePaths: string[] }
  >();

  constructor(private readonly rootDir: string) {}

  compute(
    schemas: Record<ModuleFilePath, SerializedSchema | undefined>,
  ): string {
    const parts: string[] = [];
    for (const moduleFilePathS of Object.keys(schemas).sort()) {
      const moduleFilePath = moduleFilePathS as ModuleFilePath;
      const schema = schemas[moduleFilePath];
      // Root-only, per locked decision #7 — so a module whose root is not a
      // jsonValues record has no entry files to fingerprint.
      if (
        schema === undefined ||
        schema.type !== "record" ||
        schema.jsonValues !== true
      ) {
        continue;
      }
      for (const entryFilePath of this.entryFilePathsOf(moduleFilePath)) {
        parts.push(`${entryFilePath}:${this.fileFingerprint(entryFilePath)}`);
      }
    }
    return parts.join("|");
  }

  private entryFilePathsOf(moduleFilePath: ModuleFilePath): string[] {
    const absModulePath = nodePath.join(this.rootDir, moduleFilePath);
    let moduleMtimeMs: number;
    try {
      moduleMtimeMs = fs.statSync(absModulePath).mtimeMs;
    } catch {
      return [];
    }
    const cached = this.cache.get(moduleFilePath);
    // The entry LIST only changes when the `.val.ts` does (that is where the
    // thunks live), so parsing it again on every stat would be wasted work.
    if (cached && cached.moduleMtimeMs === moduleMtimeMs) {
      return cached.entryFilePaths;
    }
    let entryFilePaths: string[] = [];
    try {
      const contents = fs.readFileSync(absModulePath, "utf-8");
      entryFilePaths = findJsonEntryFilePathsInSource(
        moduleFilePath,
        ts.createSourceFile(absModulePath, contents, ts.ScriptTarget.ES2015),
      );
    } catch {
      entryFilePaths = [];
    }
    this.cache.set(moduleFilePath, { moduleMtimeMs, entryFilePaths });
    return entryFilePaths;
  }

  private fileFingerprint(entryFilePath: string): string {
    try {
      // NANOSECOND mtime, not `mtimeMs`: two writes inside the same millisecond
      // that happen to preserve the file size would otherwise be indistinguishable
      // from no change at all, and the edit would silently never reach the Studio.
      const stat = fs.statSync(nodePath.join(this.rootDir, entryFilePath), {
        bigint: true,
      });
      return `${stat.size}:${stat.mtimeNs}`;
    } catch {
      // Missing is a state too — going from present to absent must change the
      // fingerprint, not be indistinguishable from unchanged.
      return "missing";
    }
  }
}
