import ts from "typescript";
import path from "path";
import { ModuleFilePath } from "@valbuild/core";
import { result } from "@valbuild/core/fp";
import type { Json } from "@valbuild/core";
import { analyzeValModule } from "../patch/ts/valModule";
import { analyzeJsonValuesEntries } from "../patch/ts/jsonValuesModule";
import type { ValOps } from "../ValOps";
import type { HistoryError } from "./HistoryError";

/**
 * One `.jsonValues()` entry's content, as it was at a commit.
 *
 * The history pane renders a commit through the real field components, and a
 * `.jsonValues()` record's source is only `{_type:"json"}` markers - the
 * content lives in a separate `*.val.json` per entry, fetched on demand. The
 * live Studio fetches it from `GET /json`; the commit pane had nothing to
 * fetch from, so every entry stayed a marker and rendered as though the field
 * were empty. Which is worse than an error: an empty value is a claim, and it
 * was a false one.
 *
 * ## Why this needs the module's own `.val.ts`
 *
 * There is no derivable relationship between a record key and its entry file.
 * From the example app:
 *
 *   "/support/getting-started": c.json(() => import("./content/getting-started.val.json"))
 *   "/support/faq":             c.json(() => import("./content/faq.val.json"))
 *
 * The key is a route and the path is whatever the author wrote. The only place
 * the two are related is the `import()` literal inside the `.val.ts`, which is
 * why `findJsonEntryFilePathsInSource` reads them out of the AST too. The
 * commit archive stores the module's SOURCE (the markers) and its schema, not
 * its text - so the text is fetched from git at that commit and parsed here.
 *
 * Two round trips per entry, then: the module, and the entry. The module's
 * parse is worth caching per (commit, module) by the caller; nothing here does,
 * because a `ValOps` is not a cache and the endpoint above it is the layer that
 * knows how long a commit stays interesting.
 */
export async function getJsonEntryAtCommit(
  ops: ValOps,
  commitSha: string,
  moduleFilePath: ModuleFilePath,
  key: string,
): Promise<result.Result<Json, HistoryError>> {
  const moduleGitPath = ops.gitPathOfModule(moduleFilePath);
  if (result.isErr(moduleGitPath)) {
    return moduleGitPath;
  }
  const moduleRes = await ops.getFileAtCommit(
    commitSha,
    moduleGitPath.value,
    false,
  );
  if (result.isErr(moduleRes)) {
    return moduleRes;
  }
  const entryPath = findEntryImportPath(
    moduleFilePath,
    moduleGitPath.value,
    moduleRes.value.toString("utf-8"),
    key,
  );
  if (result.isErr(entryPath)) {
    return entryPath;
  }
  // The entry path resolved above is PROJECT-relative, like the module path it
  // came from; the git path needs the root in front of it, and the ops are what
  // know the root. Reusing gitPathOfModule rather than re-deriving the prefix:
  // a `.val.json` is not a module, but "project-relative path -> repo path" is
  // the same question and one implementation of it is the point.
  const entryGitPath = ops.gitPathOfModule(entryPath.value as ModuleFilePath);
  if (result.isErr(entryGitPath)) {
    return entryGitPath;
  }
  const entryRes = await ops.getFileAtCommit(
    commitSha,
    entryGitPath.value,
    false,
  );
  if (result.isErr(entryRes)) {
    return entryRes;
  }
  try {
    return result.ok(JSON.parse(entryRes.value.toString("utf-8")) as Json);
  } catch (err) {
    return result.err({
      kind: "file-unavailable",
      gitPath: entryGitPath.value,
      message: `not valid JSON at this commit: ${
        err instanceof Error ? err.message : String(err)
      }`,
    });
  }
}

/**
 * The `import()` path a key's entry is behind, from the module's text.
 *
 * Exported for its own test: this is the part with a real chance of being
 * wrong, and it is pure.
 */
export function findEntryImportPath(
  moduleFilePath: ModuleFilePath,
  /**
   * The same module, repository-relative, for error reporting only.
   *
   * A `gitPath` in a HistoryError is a REPOSITORY path - that is what every
   * other history helper reports, and what a reader can paste into a `git show`
   * - so reporting the project-relative ModuleFilePath here named a file that
   * does not exist at that path for any project not rooted at the repo root.
   */
  moduleGitPath: string,
  valTsSource: string,
  key: string,
): result.Result<string, HistoryError> {
  const sourceFile = ts.createSourceFile(
    moduleFilePath,
    valTsSource,
    ts.ScriptTarget.ES2015,
    true,
  );
  let analysis;
  try {
    analysis = analyzeValModule(sourceFile);
  } catch (err) {
    // `file-unavailable` rather than a kind of its own: the module's TEXT is
    // the file we could not use, and adding a wire kind for "unparseable"
    // would be a new case every reader has to handle to say the same thing.
    return result.err({
      kind: "file-unavailable",
      gitPath: moduleGitPath,
      message: `could not parse the module at this commit: ${
        err instanceof Error ? err.message : String(err)
      }`,
    });
  }
  if (result.isErr(analysis)) {
    return result.err({
      kind: "file-unavailable",
      gitPath: moduleGitPath,
      message: "could not read the module at this commit",
    });
  }
  const entries = analyzeJsonValuesEntries(analysis.value.source);
  const entry = entries.get(key);
  if (entry === undefined) {
    /*
     * Reported, not treated as empty. A key with no entry at this commit means
     * the entry was added later - so "there is nothing to show for it here" is
     * the true answer, and rendering an empty field instead would say the
     * author had left it blank.
     */
    return result.err({
      kind: "file-unavailable",
      gitPath: moduleGitPath,
      message: `'${key}' had no entry at this commit`,
    });
  }
  const moduleDir = path.posix.dirname(moduleFilePath);
  return result.ok(path.posix.join(moduleDir, entry.importPath));
}
