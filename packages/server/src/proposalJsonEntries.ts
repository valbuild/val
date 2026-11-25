import type { Json, ModuleFilePath } from "@valbuild/core";
import type { JSONValue } from "@valbuild/core/patch";
import { result } from "@valbuild/core/fp";
import ts from "typescript";
import { analyzeValModule } from "./patch/ts/valModule";
import { analyzeJsonValuesEntries } from "./patch/ts/jsonValuesModule";
import { resolveExistingJsonPath } from "./patch/jsonValuesPatch";
import {
  isJsonValue,
  isObject,
  proposalSnapshot,
  type ValProposal,
} from "./proposal";

/*
 * The half of a proposal's snapshot that needs the compiler: which
 * `*.val.json` a saved entry is, read from its module's `.val.ts`. Apart from
 * `./proposal` so that a reader serving published content -- which never has
 * a saved entry -- does not evaluate TypeScript to start
 * (`readerSnapshot` loads this only when there is one).
 */

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
