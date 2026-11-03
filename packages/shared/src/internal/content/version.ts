import { Internal, type ModuleFilePath, type PatchId } from "@valbuild/core";
import { z } from "zod";

/**
 * What a module's content IS: the schema it is read and patched with, the
 * base it starts from, and the chain of patches on top. Three parts because
 * each kind of change moves exactly one of them (see
 * `docs/plans/one-content-model.md`, "A version, per module, with the code in
 * it"):
 *
 * - a schema change, or a new engine (`@valbuild/*` upgraded), moves `schema`;
 * - a publish, a content version, a literal edited in code, moves `base`;
 * - an edit, a discard, a publish (which empties the chain) moves `chain`.
 *
 * Two answers with the same version are the same content, wherever they came
 * from. That is the whole point: comparing contents becomes comparing three
 * strings.
 *
 * Computed when content CHANGES -- a module evaluated, a base adopted, a patch
 * appended -- never when it is read (risk 3 in the plan): every function here
 * that hashes counts itself ({@link versionHashCount}), so a reader that
 * hashes is caught by a counted budget rather than by a profile.
 */
export type ModuleVersion = {
  /** sha(engine + serialized schema): what the content is read and patched with. */
  schema: string;
  /** sha(the module's base source): from the build, a content version or a publish. */
  base: string;
  /**
   * A fold of this module's patch ids on top of `base`, in chain order: the
   * IDENTITY of the chain, not its order -- that is `seq`. {@link EMPTY_CHAIN}
   * for no patches, so a base is a version with an empty chain.
   */
  chain: string;
};

/**
 * What a project answer is relative to: which build served it, and how far
 * along the project's changes it is.
 */
export type ProjectVersion = {
  /**
   * The build serving it: the evaluated modules (schemas, sources and config)
   * it started from, so two processes running the same code agree. Hosted,
   * the commit or the platform's build (`publishBuild`) is part of it.
   */
  build: string;
  /**
   * ORDER only: bumped by every write, delete and publish, and once by each
   * new build. Of two answers, the one with the higher `seq` is newer. In
   * http mode it is the content service's `headVersion`.
   */
  seq: number;
};

/**
 * What the schema version of a module staged after the build serving a
 * proposal starts with: `staged:<inputs>`. Val's server has not got that
 * module's schema, so it names the staging instead; a Studio compares no
 * build's code against it.
 */
export const STAGED_SCHEMA_PREFIX = "staged:";

/** The chain of no patches. */
export const EMPTY_CHAIN = "";

/**
 * The engine: how patches are applied and content is read. Part of every
 * schema version, because content read by another engine is not the same
 * content even under the same schema.
 */
export const ENGINE = `@valbuild/core@${Internal.VERSION.core ?? "unknown"}`;

let hashes = 0;
let textEncoder: TextEncoder | undefined;

function sha256Hex(input: string): string {
  hashes++;
  textEncoder ??= new TextEncoder();
  return Internal.getSHA256Hash(textEncoder.encode(input));
}

/**
 * How many times a version has been hashed in this process: the counted
 * budget behind "versions are computed when content changes, never when it
 * is read" (`version:hash`). A test takes it before and after a read.
 */
export function versionHashCount(): number {
  return hashes;
}

/** A chain one patch longer. */
export function extendChain(prev: string, id: PatchId): string {
  return sha256Hex(`${prev}\n${id}`);
}

/** The chain of these patch ids, in order, on top of a base. */
export function chainOf(ids: readonly PatchId[]): string {
  let chain = EMPTY_CHAIN;
  for (const id of ids) chain = extendChain(chain, id);
  return chain;
}

/**
 * A module's schema version, from its serialized schema. The same function
 * on the server (from what `extractValModules` serialized) and in the Studio
 * (from what it holds in `SchemaStore`), so the two compare.
 */
export function schemaVersionOf(serializedSchema: unknown): string {
  return sha256Hex(`${ENGINE}\n${JSON.stringify(serializedSchema)}`);
}

/**
 * A module's base version, from its base source: what the module evaluates
 * to, or what a content version or a publish put in its place. `.jsonValues()`
 * entries are markers here; an entry's own version comes with entries stored
 * as modules of their own (phase 6).
 */
export function baseVersionOf(source: unknown): string {
  return sha256Hex(JSON.stringify(source) ?? "undefined");
}

/** The address of a module's content. Never changes meaning. */
export function moduleKey(path: ModuleFilePath, v: ModuleVersion): string {
  return `${path}@${v.schema}.${v.base}.${v.chain}`;
}

/** Whether two versions name the same content. */
export function sameModuleVersion(a: ModuleVersion, b: ModuleVersion): boolean {
  return a.schema === b.schema && a.base === b.base && a.chain === b.chain;
}

/**
 * The chains of every module, from the patches a draft applies (in chain
 * order), folded incrementally.
 *
 * A read asks for the chains every time; the fold is extended only by the
 * patches the chain has gained since the last call, and a call that finds the
 * chain as it was hashes nothing. A chain that changed anywhere but at its end
 * (a discard in the middle, a publish) is folded again from the start --
 * once, when that is first noticed.
 */
export class ChainFold {
  private ids: PatchId[] = [];
  private paths: ModuleFilePath[] = [];
  private chains = new Map<ModuleFilePath, string>();
  /**
   * Every module's chain after each of its patches, in order: what
   * {@link chainAt} answers for a module whose content stopped part way
   * along its chain (a patch that does not apply). Kept as the chains are
   * extended, so asking hashes nothing.
   */
  private prefixes = new Map<ModuleFilePath, string[]>();
  /**
   * Bumped whenever the chains move: a cheap identity for "the same chains as
   * before", in-process. With {@link instance} in front, two folds never name
   * one epoch: two processes (or isolates) holding the same chains answer
   * differently, which only costs a cache a miss, where two holding
   * DIFFERENT chains at the same count must never answer alike (an ETag
   * answered 304 for content the caller does not have).
   */
  private epochValue = 0;
  private readonly instance = Math.random().toString(36).slice(2, 10);

  /** Every module's chain, for these patches. Modules with none are absent. */
  chainsOf(
    patches: readonly { patchId: PatchId; path: ModuleFilePath }[],
  ): ReadonlyMap<ModuleFilePath, string> {
    const known = this.ids.length;
    let extends_ = patches.length >= known;
    for (let i = 0; extends_ && i < known; i++) {
      const patch = patches[i];
      extends_ =
        patch !== undefined &&
        patch.patchId === this.ids[i] &&
        patch.path === this.paths[i];
    }
    if (extends_ && patches.length === known) {
      return this.chains;
    }
    const chains: Map<ModuleFilePath, string> = extends_
      ? new Map(this.chains)
      : new Map();
    const from = extends_ ? known : 0;
    if (!extends_) {
      this.ids = [];
      this.paths = [];
      this.prefixes = new Map();
    }
    for (let i = from; i < patches.length; i++) {
      const patch = patches[i];
      if (patch === undefined) continue;
      const chain = extendChain(
        chains.get(patch.path) ?? EMPTY_CHAIN,
        patch.patchId,
      );
      chains.set(patch.path, chain);
      const prefixes = this.prefixes.get(patch.path);
      if (prefixes === undefined) this.prefixes.set(patch.path, [chain]);
      else prefixes.push(chain);
      this.ids.push(patch.patchId);
      this.paths.push(patch.path);
    }
    this.chains = chains;
    this.epochValue++;
    return chains;
  }

  /**
   * A module's chain after its first `count` patches, of those the last
   * {@link chainsOf} was given: the version of content that stopped at a
   * patch that does not apply, so the version names the chain the content
   * is AT. Hashes nothing.
   */
  chainAt(path: ModuleFilePath, count: number): string {
    if (count <= 0) return EMPTY_CHAIN;
    const prefixes = this.prefixes.get(path) ?? [];
    return (
      prefixes[Math.min(count, prefixes.length) - 1] ??
      this.chains.get(path) ??
      EMPTY_CHAIN
    );
  }

  /** See {@link epochValue}. */
  epoch(): string {
    return `${this.instance}-${this.epochValue}`;
  }
}

/** {@link ModuleVersion} on the wire. */
export const ModuleVersionSchema = z.object({
  schema: z.string(),
  base: z.string(),
  chain: z.string(),
});

/** {@link ProjectVersion} on the wire. */
export const ProjectVersionSchema = z.object({
  build: z.string(),
  seq: z.number(),
});
