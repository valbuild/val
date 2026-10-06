import type { Json, ModuleFilePath } from "@valbuild/core";

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
