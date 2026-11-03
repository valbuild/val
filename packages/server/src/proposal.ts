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
   * wrote, not the text the base build was made from. A staged module file's
   * text is here too: what the assistant staged, with every save since.
   */
  files: Record<string, string>;
  /**
   * The module files whose CODE the proposal has staged, by module file path,
   * each with the schema version content records for it: `staged:<inputs>`,
   * `inputs` being the proposal's staged inputs (valbuild/home
   * `stagedSchemas`). `{}` when nothing that is a module is staged, or when
   * the overlay does not say. It names the STAGING, not whether this build
   * was made of it: see {@link buildInputs} and {@link stagedAfterBuild}.
   *
   * Optional, as {@link buildInputs} is: a `val.server.ts` generated before
   * these existed hands Val a proposal without them, and must still compile.
   */
  staged?: Record<string, string>;
  /**
   * Which staging the build serving the address was made of: its staged
   * inputs (`VAL_BUILD_INPUTS`), or `null` when it was made of none -- the
   * proposal's base serves it -- or the platform does not say.
   */
  buildInputs?: string | null;
};

/** What a staged module's schema version starts with: `staged:<inputs>`. */
export const STAGED_SCHEMA_PREFIX = "staged:";

/**
 * The modules whose staged code the build serving the address was NOT made
 * of, each with its schema version (`staged:<inputs>`): every module the
 * overlay names as staged, except those whose version names the very inputs
 * the build was made of. Those the build evaluated: they are served as any
 * other module.
 *
 * A module staged after the build has a schema this server does not have.
 * Its Source is read from its staged text ({@link ValProposal.files}), its
 * version is the staging's, so no reader takes it for the build's, and a save
 * applies to that text (`docs/plans/one-content-model.md`, "Phase 9 without
 * phases 6 and 7"; valbuild/home `docs/proposals.md`, "Staged schemas").
 *
 * Whole-staging inputs, not one per module, and that is what makes this
 * sound: a module's schema can move with a file it imports, so "its own file
 * is unchanged" never says its code is in the build.
 */
export function stagedAfterBuild(
  proposal: Pick<ValProposal, "staged" | "buildInputs">,
): Record<ModuleFilePath, string> {
  const inBuild =
    proposal.buildInputs === null || proposal.buildInputs === undefined
      ? null
      : `${STAGED_SCHEMA_PREFIX}${proposal.buildInputs}`;
  const after: Record<ModuleFilePath, string> = {};
  for (const [path, version] of Object.entries(proposal.staged ?? {})) {
    if (version === inBuild) continue;
    after[path as ModuleFilePath] = version;
  }
  return after;
}

/**
 * The proposal a platform describes in its runtime env, or `undefined` when
 * this is not a proposal's address.
 *
 * `VAL_PROPOSAL` and `VAL_BRANCH` name it; `VAL_OVERLAY` is the snapshot as
 * JSON (`{ commit, modules, files, staged }`); `VAL_BUILD_INPUTS` says which
 * staging the build was made of. Throws on a snapshot that does not parse
 * rather than serving the base build as though it were the proposal: a
 * reviewer would be looking at the wrong content and nothing would say so.
 */
export function proposalFromEnv(env: {
  VAL_PROPOSAL?: string | undefined;
  VAL_BRANCH?: string | undefined;
  VAL_OVERLAY?: string | undefined;
  VAL_BUILD_INPUTS?: string | undefined;
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
  return {
    name,
    branch,
    commit,
    modules: modulesIn,
    files,
    staged: stagedOf(name, parsed["staged"]),
    buildInputs: buildInputsOf(name, env.VAL_BUILD_INPUTS),
  };
}

/**
 * The overlay's `staged`, checked: `{}` when it does not say (an overlay
 * written before it). One that says something else than module paths with
 * `staged:` versions is thrown: read as "none staged", a save would apply to
 * a staged module as a build that never evaluated it.
 */
function stagedOf(name: string, staged: unknown): Record<string, string> {
  if (staged === undefined || staged === null) return {};
  if (!isObject(staged)) {
    throw new Error(
      `Val: proposal ${name}: VAL_OVERLAY's staged must be an object`,
    );
  }
  const out: Record<string, string> = {};
  for (const [path, version] of Object.entries(staged)) {
    if (
      !path.startsWith("/") ||
      typeof version !== "string" ||
      !version.startsWith(STAGED_SCHEMA_PREFIX)
    ) {
      throw new Error(
        `Val: proposal ${name}: VAL_OVERLAY's staged must name module files with staged:<inputs> versions (${JSON.stringify(path)})`,
      );
    }
    out[path] = version;
  }
  return out;
}

/**
 * `VAL_BUILD_INPUTS`: 64 hex, or nothing. Anything else is thrown, for the
 * same reason as {@link stagedOf}, in the other direction: read as "the
 * build has it", a save would apply to staged code as though it were built.
 */
function buildInputsOf(
  name: string,
  inputs: string | undefined,
): string | null {
  if (inputs === undefined || inputs === "") return null;
  if (!/^[0-9a-f]{64}$/.test(inputs)) {
    throw new Error(
      `Val: proposal ${name}: VAL_BUILD_INPUTS is not a build's staged inputs (64 hex)`,
    );
  }
  return inputs;
}

/**
 * A content version: the site's content, served by a build that bundles an
 * older one. valbuild/home `docs/hosted-publishing.md`, step 2.
 *
 * The platform hands over only what differs from the bundle -- the modules
 * whose Source changed and the Val files whose text did -- the way it hands a
 * proposal's address its saved content, and it is read the same way: the
 * snapshot source provider, over the bundle. What differs is the position: a
 * version names the publish that made it (`job`, or its `commit`), and that is
 * where this server says it sits, never at the build it runs in.
 */
export type ValContentVersion = {
  /** The version's id: the hash of its manifest, as the platform stores it. */
  id: string;
  /** The publish job that made it, when a job did. */
  job: string | null;
  /** Its place in the chain: the commit that publish minted. */
  commit: string | null;
  /** Source, by module file path, for the modules that differ from the bundle. */
  modules: Record<string, unknown>;
  /** Val file text, by path, for the files that differ from the bundle. */
  files: Record<string, string>;
};

/**
 * The content version a platform hands over in its runtime env
 * (`VAL_CONTENT`), or `undefined` when it hands over none.
 *
 * Throws on one it cannot read rather than serving the bundle as though it
 * were the version: the site would show content older than what was
 * published, and nothing would say so.
 *
 * A version too large for one variable names others under `refs`: a module's
 * Source (JSON) or a file's text, each in a variable of its own --
 * `{ "refs": { "modules": { "/a.val.ts": "env://VAL_CONTENT_1" } } }`. Flat:
 * a referenced variable holds the value itself and is never read for further
 * references. Only `refs` is resolved, never a string inside Source, and only
 * `VAL_CONTENT_<n>` is ever read: Source is text editors write, and a
 * reference resolved in there would read any variable the isolate holds,
 * `VAL_SECRET` included, into a page. The scheme leaves room for another
 * place to read from; one this does not know is refused, not skipped.
 */
export function contentFromEnv(
  env: Record<string, string | undefined>,
): ValContentVersion | undefined {
  if (!env.VAL_CONTENT) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(env.VAL_CONTENT);
  } catch (err) {
    throw new Error(
      `Val: VAL_CONTENT is not JSON (${
        err instanceof Error ? err.message : String(err)
      })`,
      { cause: err },
    );
  }
  if (!isObject(parsed) || Array.isArray(parsed)) {
    throw new Error("Val: VAL_CONTENT is not an object");
  }
  const id = parsed["id"];
  if (typeof id !== "string" || id === "") {
    throw new Error("Val: VAL_CONTENT has no id");
  }
  const job = parsed["job"] ?? null;
  const commit = parsed["commit"] ?? null;
  if (job !== null && typeof job !== "string") {
    throw new Error(`Val: content version ${id}: job must be a string or null`);
  }
  if (commit !== null && typeof commit !== "string") {
    throw new Error(
      `Val: content version ${id}: commit must be a string or null`,
    );
  }
  const modulesIn = parsed["modules"] ?? {};
  const filesIn = parsed["files"] ?? {};
  if (
    !isObject(modulesIn) ||
    Array.isArray(modulesIn) ||
    !isObject(filesIn) ||
    Array.isArray(filesIn)
  ) {
    throw new Error(
      `Val: content version ${id}: modules and files must be objects`,
    );
  }
  const files: Record<string, string> = {};
  for (const [path, text] of Object.entries(filesIn)) {
    if (typeof text === "string") {
      files[path] = text;
    }
  }
  const modules: Record<string, unknown> = { ...modulesIn };
  const refs = parsed["refs"] ?? {};
  if (!isObject(refs) || Array.isArray(refs)) {
    throw new Error(`Val: content version ${id}: refs must be an object`);
  }
  const read = (kind: "modules" | "files", path: string, ref: unknown) => {
    const where = `Val: content version ${id}: refs.${kind}["${path}"]`;
    if (typeof ref !== "string") {
      throw new Error(`${where} must be a string`);
    }
    if (!ref.startsWith(ENV_REF)) {
      throw new Error(
        `${where} is ${ref}: only ${ENV_REF}VAL_CONTENT_<n> is read`,
      );
    }
    const name = ref.slice(ENV_REF.length);
    if (!CONTENT_VARIABLE.test(name)) {
      throw new Error(`${where} names ${name}: only VAL_CONTENT_<n> is read`);
    }
    const value = env[name];
    if (value === undefined) {
      throw new Error(`${where} names ${name}, which is not set`);
    }
    return { where, name, value };
  };
  const refModules = refs["modules"] ?? {};
  const refFiles = refs["files"] ?? {};
  if (
    !isObject(refModules) ||
    Array.isArray(refModules) ||
    !isObject(refFiles) ||
    Array.isArray(refFiles)
  ) {
    throw new Error(
      `Val: content version ${id}: refs.modules and refs.files must be objects`,
    );
  }
  for (const [path, ref] of Object.entries(refModules)) {
    const { where, name, value } = read("modules", path, ref);
    if (Object.prototype.hasOwnProperty.call(modules, path)) {
      throw new Error(`${where}: ${path} is also in modules`);
    }
    try {
      modules[path] = JSON.parse(value);
    } catch (err) {
      throw new Error(
        `${where}: ${name} is not JSON (${
          err instanceof Error ? err.message : String(err)
        })`,
        { cause: err },
      );
    }
  }
  for (const [path, ref] of Object.entries(refFiles)) {
    const { where, value } = read("files", path, ref);
    // The handed object, not `files`: an inline value that is not text was
    // dropped from `files`, and is still a second naming of the path.
    if (Object.prototype.hasOwnProperty.call(filesIn, path)) {
      throw new Error(`${where}: ${path} is also in files`);
    }
    files[path] = value;
  }
  if (job === null && commit === null) {
    // Placed nowhere, Val would place it at the build it runs in -- the one
    // position a version must never take: its own changes would be replayed
    // over a snapshot that already holds them.
    throw new Error(
      `Val: content version ${id} must name a job or a commit, or it would be placed at the build it runs in`,
    );
  }
  return { id, job, commit, modules, files };
}

/** The one scheme a content version's `refs` may use, for now. */
const ENV_REF = "env://";
/** The only variables a reference may name. */
const CONTENT_VARIABLE = /^VAL_CONTENT_[0-9]+$/;

/**
 * What a server or reader renders over the bundle: a proposal's saves over the
 * content version the site serves, either alone, or nothing.
 *
 * Layered rather than chosen. At a proposal's address the platform hands both
 * when the base the proposal was opened from serves content its build does not
 * bundle (a content-only publish), and the proposal saves only the modules it
 * changed: choosing the proposal alone would show every other module as the
 * build bundles it -- older than the site it was opened from.
 */
export function layeredSnapshot(
  proposal: Pick<ValProposal, "modules" | "files"> | undefined,
  contentVersion: Pick<ValContentVersion, "modules" | "files"> | undefined,
): Pick<ValProposal, "modules" | "files"> | undefined {
  if (proposal === undefined) return contentVersion;
  if (contentVersion === undefined) return proposal;
  return {
    modules: { ...contentVersion.modules, ...proposal.modules },
    files: { ...contentVersion.files, ...proposal.files },
  };
}

/**
 * The proposal as a reader whose code is the serving build reads it: without
 * the Source of a module staged after that build ({@link stagedAfterBuild}),
 * which was made for code the reader has not got. Left out, such a module
 * reads as the site or the build has it -- content of the code that reads it
 * -- until a build of the staging serves the address. The same rule as
 * `layered`'s, for the one source that carries no version.
 */
export function proposalAsBuilt<
  P extends Pick<ValProposal, "modules" | "staged" | "buildInputs">,
>(proposal: P): P {
  const after = stagedAfterBuild(proposal);
  if (Object.keys(after).length === 0) return proposal;
  const modules: Record<string, unknown> = {};
  for (const [path, source] of Object.entries(proposal.modules)) {
    if (after[path as ModuleFilePath] === undefined) modules[path] = source;
  }
  return { ...proposal, modules };
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
