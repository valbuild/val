import type { Json, ModuleFilePath } from "@valbuild/core";
import type { JSONValue } from "@valbuild/core/patch";
import { result } from "@valbuild/core/fp";
import ts from "typescript";
import { analyzeValModule } from "./patch/ts/valModule";
import { analyzeJsonValuesEntries } from "./patch/ts/jsonValuesModule";
import { resolveExistingJsonPath } from "./patch/jsonValuesPatch";

/**
 * A proposal this server runs at the address of: an editor-managed branch of
 * the project's content, served from its own copy of the content the
 * proposal has saved -- the **snapshot**. valbuild/home `docs/proposals.md`,
 * "Saving".
 *
 * A third place Source can come from, beside the two Val already has:
 *
 * | source provider | Source comes from                      |
 * | --------------- | -------------------------------------- |
 * | committed       | the bundle                             |
 * | draft           | content, pending patches applied       |
 * | snapshot        | the proposal's saves                   |
 *
 * The snapshot REPLACES the bundle's Source for the modules the proposal has
 * saved and nothing else, on every read: a committed render, the draft a page
 * starts from, the Studio's tree, validation and the next save's prepare. The
 * proposal's pending patches apply on top of it, as the site's apply on top of
 * the bundle.
 *
 * Handed over by the platform that serves the address, per isolate: the
 * snapshot only changes with a save, and a save is a new isolate.
 */
export type ValProposal = {
  /** The proposal's name: twenty hex characters, the hash of its inputs. */
  name: string;
  /**
   * The content branch the proposal's patches and saves are on
   * (`val/p/<name>`). Sent wherever a request names a branch, so the patches
   * this server reads and writes are the proposal's, never the site's.
   */
  branch: string;
  /**
   * The save the snapshot is, as a commit on {@link branch}; `null` before the
   * first. Sent as this server's position, so the content service hands back
   * only what came after it -- the snapshot already holds that save, and a
   * save's patches applied twice would add every array item twice.
   */
  commit: string | null;
  /**
   * Saved Source, by module file path. As the platform parsed it: read it
   * with {@link proposalSnapshot}, which checks that it is JSON.
   */
  modules: Record<string, unknown>;
  /**
   * Saved `.val.ts` text, by path with no leading slash, laid over the
   * build's `projectSource`: the next save patches the text the last one
   * wrote, not the text the base build was made from.
   */
  files: Record<string, string>;
};

/**
 * The proposal a platform describes in its runtime env, or `undefined` when
 * this is not a proposal's address.
 *
 * `VAL_PROPOSAL` and `VAL_BRANCH` name it; `VAL_OVERLAY` is the snapshot as
 * JSON (`{ commit, modules, files }`). Throws on a snapshot that does not
 * parse rather than serving the base build as though it were the proposal: a
 * reviewer would be looking at the wrong content and nothing would say so.
 */
export function proposalFromEnv(env: {
  VAL_PROPOSAL?: string | undefined;
  VAL_BRANCH?: string | undefined;
  VAL_OVERLAY?: string | undefined;
}): ValProposal | undefined {
  const name = env.VAL_PROPOSAL;
  const branch = env.VAL_BRANCH;
  if (!name || !branch) {
    return undefined;
  }
  let parsed: unknown = {};
  if (env.VAL_OVERLAY) {
    try {
      parsed = JSON.parse(env.VAL_OVERLAY);
    } catch (err) {
      throw new Error(
        `Val: proposal ${name}: VAL_OVERLAY is not JSON (${
          err instanceof Error ? err.message : String(err)
        })`,
        { cause: err },
      );
    }
  }
  if (!isObject(parsed)) {
    throw new Error(`Val: proposal ${name}: VAL_OVERLAY is not an object`);
  }
  const modulesIn = parsed["modules"] ?? {};
  const filesIn = parsed["files"] ?? {};
  const commit = parsed["commit"] ?? null;
  if (!isObject(modulesIn) || !isObject(filesIn)) {
    throw new Error(
      `Val: proposal ${name}: VAL_OVERLAY's modules and files must be objects`,
    );
  }
  if (commit !== null && typeof commit !== "string") {
    throw new Error(
      `Val: proposal ${name}: VAL_OVERLAY's commit must be a string or null`,
    );
  }
  const files: Record<string, string> = {};
  for (const [path, text] of Object.entries(filesIn)) {
    if (typeof text === "string") {
      files[path] = text;
    }
  }
  return { name, branch, commit, modules: modulesIn, files };
}

/**
 * The proposal's saved Source, as Source: every module whose value is JSON.
 * One place, so the server and the readers that render without it agree on
 * what the snapshot holds.
 */
export function proposalSnapshot(
  proposal: Pick<ValProposal, "modules">,
): Record<ModuleFilePath, Json> {
  const snapshot: Record<ModuleFilePath, Json> = {};
  for (const [path, source] of Object.entries(proposal.modules)) {
    if (isJsonValue(source)) {
      snapshot[path as ModuleFilePath] = source;
    }
  }
  return snapshot;
}

/**
 * The `.jsonValues()` entries the proposal saved, by module and key.
 *
 * An entry's content is not in its module's Source -- that holds a marker per
 * entry -- but in the entry's own `*.val.json`, and a save writes that file:
 * it reaches the proposal's address as saved TEXT ({@link ValProposal.files}),
 * not as Source. So the snapshot alone shows the build's entries. This is the
 * other half: each saved `*.val.json`, read as the entry its module names.
 *
 * Which entry a file is comes from the module's `.val.ts`, whose
 * `c.json(() => import("..."))` thunks name the files -- the saved text if
 * the save rewrote it, else the build's own (`projectSource`). An entry whose
 * module cannot be read that way is left to the build, as before: this adds
 * what it can find and never fails the address.
 */
export function proposalJsonEntries(
  proposal: Pick<ValProposal, "modules" | "files">,
  projectSource?: Record<string, string>,
): Map<ModuleFilePath, Map<string, JSONValue>> {
  const found = new Map<ModuleFilePath, Map<string, JSONValue>>();
  const savedJson = Object.keys(proposal.files).filter((path) =>
    path.endsWith(".val.json"),
  );
  if (savedJson.length === 0) return found;
  const savedJsonPaths = new Set(savedJson);
  for (const [moduleFilePath, source] of Object.entries(proposal.modules)) {
    if (!holdsJsonMarkers(source)) continue;
    const relative = moduleFilePath.replace(/^\//, "");
    const text = proposal.files[relative] ?? projectSource?.[relative];
    if (text === undefined) continue;
    const entries = jsonEntryPaths(relative, text);
    if (entries === null) continue;
    const byKey = new Map<string, JSONValue>();
    for (const [key, importPath] of entries) {
      const jsonPath = resolveExistingJsonPath(
        moduleFilePath,
        importPath,
      ).replace(/^\//, "");
      if (!savedJsonPaths.has(jsonPath)) continue;
      const content = parseJson(proposal.files[jsonPath]);
      if (content !== undefined) byKey.set(key, content);
    }
    if (byKey.size > 0) found.set(moduleFilePath as ModuleFilePath, byKey);
  }
  return found;
}

/**
 * The snapshot as a page reads it: {@link proposalSnapshot}, with each saved
 * `.jsonValues()` entry's content in place of its marker -- the shape a draft
 * already has, where the entries it edits hold content and the rest are
 * markers the readers resolve from the build. See {@link proposalJsonEntries}.
 *
 * For the readers only. Val's own server keeps the markers
 * ({@link proposalSnapshot}): its patching works on them, and it takes the
 * saved entries separately.
 */
export function proposalSnapshotForReaders(
  proposal: Pick<ValProposal, "modules" | "files">,
  projectSource?: Record<string, string>,
): Record<ModuleFilePath, Json> {
  const snapshot = proposalSnapshot(proposal);
  for (const [moduleFilePath, entries] of proposalJsonEntries(
    proposal,
    projectSource,
  )) {
    const source = snapshot[moduleFilePath];
    if (!isObject(source)) continue;
    const filled: Record<string, Json> = {};
    for (const [key, value] of Object.entries(source)) {
      if (isJsonValue(value)) filled[key] = value;
    }
    for (const [key, content] of entries) {
      // Own keys only: an entry may be named `toString`.
      if (Object.prototype.hasOwnProperty.call(filled, key)) {
        filled[key] = content;
      }
    }
    snapshot[moduleFilePath] = filled;
  }
  return snapshot;
}

/** A record of `.jsonValues()` markers (`{ _type: "json" }`), at least one. */
function holdsJsonMarkers(source: unknown): boolean {
  return (
    isObject(source) &&
    Object.values(source).some(
      (value) => isObject(value) && value["_type"] === "json",
    )
  );
}

/** Each entry key's import path, from a `.jsonValues()` module's text. */
function jsonEntryPaths(
  fileName: string,
  text: string,
): Map<string, string> | null {
  try {
    const analysis = analyzeValModule(
      ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2015, true),
    );
    if (result.isErr(analysis)) return null;
    const paths = new Map<string, string>();
    for (const [key, entry] of analyzeJsonValuesEntries(
      analysis.value.source,
    )) {
      paths.set(key, entry.importPath);
    }
    return paths;
  } catch {
    // Not a module this can read: its entries stay the build's.
    return null;
  }
}

function parseJson(text: string | undefined): JSONValue | undefined {
  if (text === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return isMutableJsonValue(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** {@link isJsonValue}, for the mutable JSON a server patches. */
function isMutableJsonValue(value: unknown): value is JSONValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isMutableJsonValue);
  }
  return isObject(value) && Object.values(value).every(isMutableJsonValue);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** What `JSON.parse` can produce, checked rather than assumed. */
function isJsonValue(value: unknown): value is Json {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  return isObject(value) && Object.values(value).every(isJsonValue);
}
