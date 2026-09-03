/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  MediaSource,
  FileMetadata,
  FileSource,
  ImageMetadata,
  ImageSchema,
  Internal,
  type Json,
  ModuleFilePath,
  PatchId,
  Schema,
  SelectorSource,
  SerializedSchema,
  Source,
  SourcePath,
  VAL_EXTENSION,
  ValConfig,
  ValModules,
  ValidationError,
  ValidationErrors,
  extractValModules,
  computeValModuleShas,
} from "@valbuild/core";
import type { ExtractedModuleError, ValModuleShaEntry } from "@valbuild/core";
import { array, pipe, result } from "@valbuild/core/fp";
import {
  JSONOps,
  JSONValue,
  Operation,
  ParentRef,
  Patch,
  PatchError,
  ReadonlyJSONValue,
  applyPatch,
  deepClone,
} from "@valbuild/core/patch";
import { TSOps, insertValJsonEntry, removeValJsonEntry } from "./patch/ts/ops";
import { analyzeValModule } from "./patch/ts/valModule";
import { analyzeJsonValuesEntries } from "./patch/ts/jsonValuesModule";
import {
  applyJsonValuesEntryPatches,
  classifyJsonValuesOp,
  findNestedJsonValuesRecords,
  getNewJsonEntryPaths,
  rebaseContentOp,
  resolveExistingJsonPath,
} from "./patch/jsonValuesPatch";
import { validateJsonValuesEntries } from "./validateJsonValues";
import ts from "typescript";
import { ValSyntaxError, ValSyntaxErrorTree } from "./patch/ts/syntax";
import sizeOf from "image-size";
import { ParentPatchId } from "@valbuild/core";
import type { ReifiedPreview } from "@valbuild/core";
import {
  ValCommit,
  ValDeployment,
  resolveSchemaSourceFixForError,
  type SchemaSourceSnapshot,
} from "@valbuild/shared/internal";

export type BaseSha = string & { readonly _tag: unique symbol };
export type ConfigSha = string & { readonly _tag: unique symbol };
export type SourcesSha = string & { readonly _tag: unique symbol };
export type SchemaSha = string & { readonly _tag: unique symbol };
export type CommitSha = string & { readonly _tag: unique symbol };
export type AuthorId = string & { readonly _tag: unique symbol };
export type ModulesError = { message: string; path?: ModuleFilePath };

export type Schemas = {
  [key: ModuleFilePath]: Schema<SelectorSource>;
};

export type Sources = {
  [key: ModuleFilePath]: Source;
};

const jsonOps = new JSONOps();
const tsOps = new TSOps((document) => {
  return pipe(
    analyzeValModule(document),
    result.map(({ source }) => source),
  );
});

/**
 * `.jsonValues()` is only supported on a module's ROOT record/router. A nested
 * one is broken end to end (the `/json` endpoint keys entries by a single
 * string, the Studio substitutes at the top level, and content validation
 * silently skips it), so reject it up front as a module error — `/sources/~`
 * then fails with "Val is not correctly setup" naming the module.
 */
function findNestedJsonValuesModuleErrors(schemas: Schemas): ModulesError[] {
  const errors: ModulesError[] = [];
  for (const moduleFilePathS of Object.keys(schemas)) {
    const moduleFilePath = moduleFilePathS as ModuleFilePath;
    const schema = schemas[moduleFilePath];
    if (!schema) {
      continue;
    }
    let serialized: SerializedSchema;
    try {
      serialized = schema["executeSerialize"]();
    } catch {
      // Serialization errors are reported elsewhere (e.g. by extractValModules).
      continue;
    }
    for (const nestedPath of findNestedJsonValuesRecords(serialized)) {
      errors.push({
        path: moduleFilePath,
        message: `Nested .jsonValues() records are not supported: '${nestedPath.join(
          ".",
        )}' in ${moduleFilePath}. Use .jsonValues() only on a module's root record/router.`,
      });
    }
  }
  return errors;
}

export type ValOpsOptions = {
  formatter?: (code: string, filePath: string) => string | Promise<string>;
  statPollingInterval?: number;
  statFilePollingInterval?: number;
  disableFilePolling?: boolean;
  disableFileWatcher?: boolean;
  config: ValConfig;
};
// #region ValOps
export abstract class ValOps {
  /** Sources from val modules, immutable (without patches or anything)  */
  private sources: Sources | null;
  /** The sha256 / hash of all sources + all schemas + config */
  private baseSha: BaseSha | null;
  /** The sha256 / hash of all sources */
  private sourcesSha: SourcesSha | null;
  /** The sha256 / hash of config */
  private configSha: ConfigSha | null;
  /** Schema from val modules, immutable  */
  private schemas: Schemas | null;
  /** The sha256 / hash of schema + config - if this changes users needs to reload */
  private schemaSha: SchemaSha | null;
  private modulesErrors: ModulesError[] | null;
  /**
   * What the SHAs above are a fold over, so they can be recomputed.
   *
   * See {@link promoteCommittedSources}: the one thing that changes sources
   * without re-evaluating the modules is a save, and it has to be able to move
   * the SHAs with them.
   */
  private shaEntries: ValModuleShaEntry[] | null;
  /**
   * The extraction's OWN module errors, which are what the fold was given.
   *
   * Not the same list as {@link modulesErrors}: that one has the nested
   * `.jsonValues()` errors concatenated on, and those were never part of the
   * hash. Re-folding with the wrong list changes the base SHA for no reason.
   */
  private shaModuleErrors: ExtractedModuleError[] | null;
  /**
   * What a save has told us each `.jsonValues()` entry now holds.
   *
   * The entry twin of {@link sources}, and it has to be separate because an
   * entry's content is not IN the source: the source holds a marker, and
   * {@link getJsonEntries} resolves it by awaiting the marker's own `import()`.
   * That resolves from the module registry, so after `/save` rewrites a
   * `*.val.json` the thunk keeps answering with the content from before — and
   * unlike a module source there is nothing to re-extract, because the memo was
   * never holding the content in the first place.
   *
   * `null` for an entry the commit deleted.
   *
   * Never cleared: it describes what is on disk. A host rebuild makes a new
   * instance, which is the right reset. Bounded by the project's entry count,
   * holding only the latest content per key.
   */
  private adoptedJsonEntries = new Map<
    ModuleFilePath,
    Map<string, JSONValue | null>
  >();

  constructor(
    private readonly valModules: ValModules,
    protected readonly options?: ValOpsOptions,
  ) {
    this.sources = null;
    this.baseSha = null;
    this.schemas = null;
    this.schemaSha = null;
    this.sourcesSha = null;
    this.configSha = null;
    this.modulesErrors = null;
    this.shaEntries = null;
    this.shaModuleErrors = null;
  }

  // #region stat
  /**
   * Get the status from Val
   *
   * This works differently in ValOpsFS and ValOpsHttp:
   * - In ValOpsFS (for dev mode) works using long-polling operations since we cannot use WebSockets in the host Next.js server and we do not want to hammer the server with requests (though we could argue that it would be ok in dev, it is not up to our standards as a kick-ass CMS).
   * - In ValOpsHttp (in production) it returns a WebSocket URL so that the client can connect directly.
   *
   * The reason we do not use long polling in production is that Vercel (a very likely host for Next.js), bills by wall time and long polling would therefore be very expensive.
   */
  abstract getStat(
    params: {
      baseSha: BaseSha;
      schemaSha: SchemaSha;
      patches?: PatchId[];
      profileId?: AuthorId;
      /**
       * FS mode only (see ValOpsFS): the fingerprint of the `.jsonValues()` entry
       * FILES the client last saw. Absent in http mode, where content does not
       * change under a running server — a deploy restarts it.
       */
      jsonEntriesSha?: string;
      // TODO: deployments: Record<DeploymentId, "deployed" | "deploying" | "failed">
    } | null,
  ): Promise<
    | {
        type: "request-again" | "no-change" | "did-change";
        baseSha: BaseSha;
        schemaSha: SchemaSha;
        sourcesSha: SourcesSha;
        patches: PatchId[];
        /**
         * Unpublished changes the store threw away because it could not read
         * them. FS mode only: the content api owns its own patches and does not
         * discard them behind the client's back.
         */
        removed?: { patchId: PatchId; reason: string }[];
        /** FS mode only — see the `params` counterpart. */
        jsonEntriesSha?: string;
      }
    | {
        type: "use-websocket";
        url: string;
        nonce: string;
        baseSha: BaseSha;
        schemaSha: SchemaSha;
        commitSha: CommitSha;
        sourcesSha: SourcesSha;
        patches: PatchId[];
      }
    | {
        type: "error";
        error: GenericErrorMessage;
        unauthorized?: boolean;
        networkError?: boolean;
      }
  >;

  // #region initTree
  private async initSources(): Promise<{
    baseSha: BaseSha;
    schemaSha: SchemaSha;
    sourcesSha: SourcesSha;
    configSha: ConfigSha;
    sources: Sources;
    schemas: Schemas;
    moduleErrors: ModulesError[];
  }> {
    if (
      this.baseSha === null ||
      this.sourcesSha === null ||
      this.configSha === null ||
      this.schemaSha === null ||
      this.sources === null ||
      this.schemas === null ||
      this.modulesErrors === null
    ) {
      const extracted = await extractValModules(this.valModules);
      const moduleErrors = extracted.moduleErrors.concat(
        findNestedJsonValuesModuleErrors(extracted.schemas),
      );
      this.sources = extracted.sources;
      this.schemas = extracted.schemas;
      this.baseSha = extracted.baseSha as BaseSha;
      this.schemaSha = extracted.schemaSha as SchemaSha;
      this.sourcesSha = extracted.sourcesSha as SourcesSha;
      this.configSha = extracted.configSha as ConfigSha;
      this.modulesErrors = moduleErrors;
      this.shaEntries = extracted.shaEntries;
      this.shaModuleErrors = extracted.moduleErrors;
      return {
        baseSha: this.baseSha,
        schemaSha: this.schemaSha,
        sourcesSha: this.sourcesSha,
        configSha: this.configSha,
        sources: extracted.sources,
        schemas: extracted.schemas,
        moduleErrors,
      };
    }
    return {
      baseSha: this.baseSha,
      schemaSha: this.schemaSha,
      sourcesSha: this.sourcesSha,
      configSha: this.configSha,
      sources: this.sources,
      schemas: this.schemas,
      moduleErrors: this.modulesErrors,
    };
  }

  /**
   * These patches are on disk now: adopt what they produced as the committed
   * sources.
   *
   * The entry point for the mechanism {@link promoteCommittedSources} describes,
   * and the only one — a caller hands over the analysis it just committed and
   * this works out the rest, so the rule about which sources are adopted lives
   * in one place rather than at each save site.
   *
   * A module whose patches could not be applied cleanly is left alone. `/save`
   * refuses the whole commit before reaching here if `prepare` found errors, so
   * this cannot normally fire — but adopting a partially patched source would
   * put content in the memo that is not what was written, which is worse than
   * being stale.
   */
  async adoptCommittedSources(
    analysis: PatchAnalysis & OrderedPatches,
    preparedCommit: Pick<PreparedCommit, "patchedJsonEntries">,
  ): Promise<void> {
    // Read BEFORE anything is promoted: this applies the chain to the sources as
    // they stand, and promoting first would apply the same patches twice.
    const { sources, errors } = await this.getSources(analysis);
    const adopt: Sources = {};
    for (const [moduleFilePathS, source] of Object.entries(sources)) {
      const moduleFilePath = moduleFilePathS as ModuleFilePath;
      if (errors[moduleFilePath] !== undefined) {
        console.error(
          "Val: not adopting the committed source of a module whose patches " +
            "did not apply cleanly. Its content here stays as it was until the " +
            "modules are re-evaluated.",
          { moduleFilePath, errors: errors[moduleFilePath] },
        );
        continue;
      }
      adopt[moduleFilePath] = source;
    }
    this.promoteCommittedSources(adopt);
    /**
     * And the `.jsonValues()` entry content, which the sources above do not
     * carry — they hold markers. See {@link adoptedJsonEntries}.
     *
     * Only for a module whose source was adopted. The source is what frames an
     * entry: it decides which keys exist at all, so adopting one without the
     * other would leave the content and the key set describing different
     * moments.
     */
    for (const [moduleFilePathS, entries] of Object.entries(
      preparedCommit.patchedJsonEntries,
    )) {
      const moduleFilePath = moduleFilePathS as ModuleFilePath;
      if (adopt[moduleFilePath] === undefined) {
        continue;
      }
      const adopted =
        this.adoptedJsonEntries.get(moduleFilePath) ??
        new Map<string, JSONValue | null>();
      for (const [entryKey, content] of Object.entries(entries)) {
        adopted.set(entryKey, content);
      }
      this.adoptedJsonEntries.set(moduleFilePath, adopted);
    }
  }

  /**
   * Adopt sources that have just been written to disk, and move the SHAs with
   * them.
   *
   * ## Why this exists rather than an invalidation
   *
   * The obvious thing — throw the memo away after a save so the next read
   * re-extracts — does not work, and quietly. `extractValModules` gets a
   * module's content by awaiting its `def`, which is the app's own `import()`:
   * that resolves from the MODULE REGISTRY, not from the file on disk. Right
   * after `/save` rewrites a `.val.ts`, the registry still holds the module as
   * it was evaluated before, so a re-extraction returns the pre-save content and
   * stores it as fresh. What actually replaces it is the host rebuilding its
   * module graph and constructing a new `ValOps` — which happens on its own
   * schedule, and until it does, every read is stale.
   *
   * Stale reads here are not abstract: `getJsonEntry` resolves a
   * `.jsonValues()` entry from the committed source and then replays pending
   * patches over it, so once a publish has removed the patches, a page rendering
   * draft content gets the committed value — the one this memo is holding from
   * before the publish.
   *
   * So the save tells us instead. It has just computed what the new committed
   * sources are, and that answer does not depend on anything being
   * re-evaluated.
   *
   * ## And the SHAs move
   *
   * Deliberately, and this is the part with consequences. `baseSha` and
   * `sourcesSha` identify the sources being served; leaving them still while the
   * sources move would put a value other code compares against into
   * disagreement with what it describes. Moving them means a `fs`-mode base SHA
   * changes within a server's lifetime for the first time, which is a signal the
   * studio already knows how to read: `PatchStore.reconcileVanished` uses a
   * moved base to tell "these patches were published" from "these patches were
   * discarded", and takes them out of the chain without reverting the fields —
   * which is what a second tab watching a publish needs and could not get
   * before.
   *
   * A module the fold does not know is ignored rather than appended: the fold's
   * order is `val.modules`, and a path that is not in it has no position, so
   * there is no honest answer for where its hash would go. It also cannot happen
   * — a save only ever writes modules it read from here.
   */
  protected promoteCommittedSources(patched: Sources): void {
    if (
      this.sources === null ||
      this.shaEntries === null ||
      this.shaModuleErrors === null
    ) {
      // Nothing has been read yet, so there is no stale answer to correct and
      // no fold to replay. The first read extracts, as it always would.
      return;
    }
    const known = new Set(this.shaEntries.map((entry) => entry.path));
    const adopt = Object.entries(patched).filter(
      ([moduleFilePath, source]) =>
        source !== undefined && known.has(moduleFilePath as ModuleFilePath),
    ) as [ModuleFilePath, Source][];
    if (adopt.length === 0) {
      return;
    }
    const bySource = new Map<ModuleFilePath, Source>(adopt);
    // A new object rather than a mutation: `getSources` hands this out, and a
    // caller holding it must not have the ground move under it.
    this.sources = { ...this.sources };
    for (const [moduleFilePath, source] of adopt) {
      this.sources[moduleFilePath] = source;
    }
    this.shaEntries = this.shaEntries.map((entry) => {
      const source = bySource.get(entry.path);
      return source === undefined ? entry : { ...entry, source };
    });
    const shas = computeValModuleShas(
      this.valModules.config,
      this.shaEntries,
      this.shaModuleErrors,
    );
    this.baseSha = shas.baseSha as BaseSha;
    this.schemaSha = shas.schemaSha as SchemaSha;
    this.sourcesSha = shas.sourcesSha as SourcesSha;
    this.configSha = shas.configSha as ConfigSha;
  }

  async init(): Promise<void> {
    const { baseSha, schemaSha } = await this.initSources();
    await this.onInit(baseSha, schemaSha);
  }

  async getBaseSources(): Promise<Sources> {
    return this.initSources().then((result) => result.sources);
  }

  /**
   * Resolves the content of ONE `.jsonValues()` entry.
   *
   * The committed content comes from the entry's import thunk on the base
   * source (so it works in both fs and http mode, with no extra I/O). With
   * `applyPatches` (the default) any pending patches for that entry are then
   * replayed on top, which is what makes draft edits visible to the runtime.
   *
   * Callers that apply patches themselves (the Studio, which owns
   * in-flight client patches the server has not seen) must pass
   * `applyPatches: false` or the same edits would be applied twice.
   */
  async getJsonEntry(
    moduleFilePath: ModuleFilePath,
    entryKey: string,
    opts?: { applyPatches?: boolean },
  ): Promise<
    | { status: "success"; content: JSONValue | null }
    | { status: "not-found"; message: string }
    | { status: "error"; message: string }
    | { status: "unauthorized"; message: string }
  > {
    const res = await this.getJsonEntries(
      moduleFilePath,
      { keys: [entryKey] },
      opts,
    );
    if (res.status !== "success") {
      return res;
    }
    const entry = res.entries[0];
    if (entry !== undefined) {
      return { status: "success", content: entry.content };
    }
    const error = res.errors[0];
    if (error !== undefined) {
      return { status: "error", message: error.message };
    }
    return {
      status: "not-found",
      message: `Entry not found: ${entryKey} in ${moduleFilePath}`,
    };
  }

  /**
   * Resolves the content of MANY `.jsonValues()` entries in one pass.
   *
   * This is the single implementation; {@link getJsonEntry} is a one-key wrapper.
   * Batching matters because the expensive parts — `initSources()` and
   * `fetchPatches()` — are hoisted OUT of the per-entry loop: resolving 500
   * entries one-by-one would otherwise mean 500 patch fetches.
   *
   * Per-entry problems stay per-entry (`missing` / `errors`) so one corrupt
   * `*.val.json` cannot fail a whole batch. Only a missing or non-record MODULE
   * is a whole-request `not-found`.
   *
   * `selector` is either explicit `keys` or an `offset`/`limit` window over every
   * key of the record, in module key order. The window form requires
   * `applyPatches: false`: enumerating from the base source would silently omit
   * draft-added keys, and a silently-short key list is exactly the class of bug
   * this endpoint exists to avoid.
   */
  async getJsonEntries(
    moduleFilePath: ModuleFilePath,
    selector: { keys: string[] } | { offset: number; limit: number },
    opts?: { applyPatches?: boolean },
  ): Promise<
    | {
        status: "success";
        entries: { key: string; content: JSONValue | null }[];
        missing: string[];
        errors: { key: string; message: string }[];
        total: number;
        offset?: number;
        limit?: number;
      }
    | { status: "not-found"; message: string }
    | { status: "error"; message: string }
    | { status: "unauthorized"; message: string }
  > {
    const applyPatches = opts?.applyPatches !== false;
    const isWindow = !("keys" in selector);
    if (isWindow && applyPatches) {
      return {
        status: "error",
        message:
          "Cannot enumerate json entries by offset/limit with apply_patches: the base key set would omit draft-added entries. Pass apply_patches=false, or request explicit keys.",
      };
    }
    const { sources, schemas } = await this.initSources();
    const moduleSource = sources[moduleFilePath];
    if (moduleSource === undefined || moduleSource === null) {
      return {
        status: "not-found",
        message: `Module not found: ${moduleFilePath}`,
      };
    }
    if (typeof moduleSource !== "object" || Array.isArray(moduleSource)) {
      return {
        status: "not-found",
        message: `Module is not a record: ${moduleFilePath}`,
      };
    }
    const record = moduleSource as Record<string, unknown>;
    const allKeys = Object.keys(record);
    const requestedKeys = isWindow
      ? allKeys.slice(selector.offset, selector.offset + selector.limit)
      : selector.keys;

    // Fetched once for the whole batch, not per entry.
    let modulePatches: { patchId: PatchId; patch: Patch }[] = [];
    let serializedSchema: SerializedSchema | undefined = undefined;
    if (applyPatches) {
      const patchOps = await this.fetchPatches({ excludePatchOps: false });
      if (patchOps.error) {
        return { status: "error", message: patchOps.error.message };
      }
      if (patchOps.errors && Object.keys(patchOps.errors).length > 0) {
        return {
          status: "error",
          message: `Could not fetch patches: ${JSON.stringify(patchOps.errors)}`,
        };
      }
      modulePatches = patchOps.patches
        .filter((p) => p.path === moduleFilePath && !p.appliedAt)
        .map((p) => ({ patchId: p.patchId, patch: p.patch }));
      try {
        serializedSchema = schemas[moduleFilePath]?.["executeSerialize"]();
      } catch {
        // Serialization errors are reported elsewhere; treat as "no schema".
      }
    }

    const entries: { key: string; content: JSONValue | null }[] = [];
    const missing: string[] = [];
    const errors: { key: string; message: string }[] = [];
    type ResolvedEntry =
      | {
          entryKey: string;
          baseContent: JSONValue | undefined;
          /** Set when the value lives in the module source, not a `*.val.json`. */
          inline?: true;
        }
      | { entryKey: string; message: string };
    const resolved = await Promise.all(
      requestedKeys.map(async (entryKey): Promise<ResolvedEntry> => {
        const marker = record[entryKey];
        if (marker !== undefined && !Internal.isJson(marker)) {
          // Not a jsonValues entry — return the inlined value as-is (defensive).
          // `inline` skips patch replay: entry patches are expressed against a
          // jsonValues entry, and this value is part of the module source proper.
          return { entryKey, baseContent: marker as JSONValue, inline: true };
        }
        if (marker === undefined) {
          return { entryKey, baseContent: undefined };
        }
        /**
         * What a save told us this entry holds, ahead of the thunk.
         *
         * The thunk resolves from the module registry, so after `/save` rewrites
         * a `*.val.json` it keeps answering with the content from before — and
         * there is nothing to re-extract, because the committed content was
         * never in the memoised source to begin with. See
         * {@link adoptedJsonEntries}.
         *
         * `null` means the commit deleted the entry, which is reported the same
         * way an absent key is. (Nearly unreachable — a `remove` also drops the
         * thunk from the `.val.ts`, so the key is gone from `record` once the
         * source is adopted — but the map says it, so this says it too.)
         *
         * The BASELINE only. Pending patches replay over it below exactly as
         * they do over the thunk's answer.
         */
        const adopted = this.adoptedJsonEntries.get(moduleFilePath);
        if (adopted !== undefined && adopted.has(entryKey)) {
          const content = adopted.get(entryKey);
          return {
            entryKey,
            baseContent: content === null ? undefined : content,
          };
        }
        const thunk = Internal.getJsonImport(marker);
        if (!thunk) {
          return { entryKey, baseContent: null };
        }
        try {
          return {
            entryKey,
            baseContent: ((await thunk()).default ?? null) as JSONValue,
          };
        } catch (e) {
          return {
            entryKey,
            message: `Failed to load JSON entry '${entryKey}': ${
              e instanceof Error ? e.message : String(e)
            }`,
          };
        }
      }),
    );
    for (const result of resolved) {
      const { entryKey } = result;
      if ("message" in result) {
        errors.push({ key: entryKey, message: result.message });
        continue;
      }
      const { baseContent } = result;
      if (!applyPatches || "inline" in result) {
        if (baseContent === undefined) {
          missing.push(entryKey);
        } else {
          entries.push({ key: entryKey, content: baseContent });
        }
        continue;
      }
      const res = applyJsonValuesEntryPatches({
        serializedSchema,
        entryKey,
        baseContent,
        patches: modulePatches,
      });
      if (res.kind === "error") {
        errors.push({ key: entryKey, message: res.message });
      } else if (res.kind === "deleted") {
        missing.push(entryKey);
      } else {
        entries.push({ key: entryKey, content: res.content });
      }
    }
    return {
      status: "success",
      entries,
      missing,
      errors,
      total: allKeys.length,
      ...(isWindow ? { offset: selector.offset, limit: selector.limit } : {}),
    };
  }
  async getSchemas(): Promise<Schemas> {
    return this.initSources().then((result) => result.schemas);
  }
  async getSerializedSchemas(): Promise<
    Record<ModuleFilePath, SerializedSchema>
  > {
    const schemas = await this.getSchemas();
    const serialized: Record<ModuleFilePath, SerializedSchema> = {};
    for (const [moduleFilePathS, schema] of Object.entries(schemas)) {
      serialized[moduleFilePathS as ModuleFilePath] =
        schema["executeSerialize"]();
    }
    return serialized;
  }
  async getModuleErrors(): Promise<ModulesError[]> {
    return this.initSources().then((result) => result.moduleErrors);
  }
  async getBaseSha(): Promise<BaseSha> {
    return this.initSources().then((result) => result.baseSha);
  }
  async getConfigSha(): Promise<ConfigSha> {
    return this.initSources().then((result) => result.configSha);
  }
  async getSourcesSha(): Promise<SourcesSha> {
    return this.initSources().then((result) => result.sourcesSha);
  }
  async getSchemaSha(): Promise<SchemaSha> {
    return this.initSources().then((result) => result.schemaSha);
  }

  // #region analyzePatches
  analyzePatches(
    sortedPatches: OrderedPatches["patches"],
    commits?: ValCommit[],
    currentCommitSha?: CommitSha,
  ): PatchAnalysis {
    const patchesByModule: {
      [path: ModuleFilePath]: {
        patchId: PatchId;
      }[];
    } = {};
    const fileLastUpdatedByPatchId: Record<
      string,
      {
        patchId: PatchId;
        remote: boolean;
        isDelete: boolean;
      }
    > = {};
    for (const patch of sortedPatches) {
      if (patch.appliedAt) {
        continue;
      }
      let hasSourceFileOps = false;
      for (const op of patch.patch) {
        if (op.op === "file") {
          const filePath = op.filePath;
          fileLastUpdatedByPatchId[filePath] = {
            patchId: patch.patchId,
            remote: op.remote,
            isDelete: op.value === null,
          };
          continue;
        }
        hasSourceFileOps = true;
      }
      // Once per patch, NOT once per op: prepare() re-looks-up the patch by id
      // and applies the whole thing for every entry, so a patch with two source
      // ops used to be applied twice. Idempotent for "replace", destructive for
      // array add/remove/move.
      if (hasSourceFileOps) {
        const path = patch.path;
        if (!patchesByModule[path]) {
          patchesByModule[path] = [];
        }
        // At most ONE entry per (module, patch): consumers treat each entry as
        // "apply this whole patch". Pushing per-op made a patch with N non-file
        // ops be applied N times — idempotent for `replace`, but it duplicates
        // `add`s and corrupts non-idempotent ops like `move`.
        if (
          patchesByModule[path][patchesByModule[path].length - 1]?.patchId !==
          patch.patchId
        ) {
          patchesByModule[path].push({
            patchId: patch.patchId,
          });
        }
      }
    }
    return {
      patchesByModule,
      fileLastUpdatedByPatchId,
    };
  }

  // #region getPreviews
  /**
   * Reifies each module's previews from its schema INSTANCE.
   *
   * Kept even though the Studio also computes previews client-side: a preview is
   * a user function that lives on the instance and is not part of the serialized
   * schema, so a host app that does not render `<ValModulesClient>` has no
   * instances in the browser and would otherwise get no previews at all. See
   * #470.
   *
   * A `render`, and a string's `multiline`, need none of this — they are static
   * config that travels with the serialized schema.
   */
  async getPreviews(
    schemas: Schemas,
    sources: Sources,
  ): Promise<{
    previews: Record<ModuleFilePath, ReifiedPreview | null>;
  }> {
    const previews: Record<ModuleFilePath, ReifiedPreview | null> = {};
    for (const [pathS, schema] of Object.entries(schemas)) {
      const path = pathS as ModuleFilePath;
      previews[path] = schema["executePreview"](path, sources[path]);
    }
    return { previews };
  }

  // #region getSources
  async getSources(analysis?: PatchAnalysis & OrderedPatches): Promise<{
    sources: Sources;
    errors: Record<
      ModuleFilePath,
      {
        patchId: PatchId;
        skipped: boolean;
        error: GenericErrorMessage;
      }[]
    >;
  }> {
    if (!analysis) {
      const { sources } = await this.initSources();
      return { sources, errors: {} };
    }
    const { sources } = await this.initSources();

    const patchedSources: Sources = {};
    const errors: Record<
      ModuleFilePath,
      {
        patchId: PatchId;
        skipped: boolean;
        error: GenericErrorMessage;
      }[]
    > = {};
    // Serialized schemas, resolved lazily and only for modules that actually
    // have patches, so the common (non-jsonValues) case stays free.
    const { schemas } = await this.initSources();
    const serializedSchemaCache = new Map<
      ModuleFilePath,
      SerializedSchema | undefined
    >();
    const jsonValuesSchemaFor = (
      path: ModuleFilePath,
    ): SerializedSchema | undefined => {
      if (!serializedSchemaCache.has(path)) {
        let serialized: SerializedSchema | undefined = undefined;
        try {
          serialized = schemas[path]?.["executeSerialize"]();
        } catch {
          // Serialization errors are reported elsewhere; treat as "no schema".
        }
        serializedSchemaCache.set(path, serialized);
      }
      return serializedSchemaCache.get(path);
    };
    for (const patchData of analysis.patches) {
      const path = patchData.path;
      if (sources[path] === undefined) {
        if (!errors[path]) {
          errors[path] = [];
        }
        console.error("Val: Module not found", path);
        errors[path].push({
          patchId: patchData.patchId,
          skipped: true,
          error: new PatchError(`Module not found`),
        });
        continue;
      }
      if (!patchedSources[path]) {
        patchedSources[path] = sources[path];
      }
      const patchId = patchData.patchId;
      if (errors[path]) {
        console.error(
          "Cannot apply patch: previous errors exists",
          path,
          errors[path],
        );
        errors[path].push({
          patchId: patchId,
          skipped: true,
          error: new PatchError(`Cannot apply patch: previous errors exists`),
        });
      } else {
        const applicableOps: Patch = [];
        const fileFixOps: Record<string, Patch> = {};
        // `.jsonValues()` entry values are opaque `{_type:"json"}` markers in
        // the module source — their content lives in the entry's `*.val.json`.
        // Ops that reach INTO an entry therefore cannot be applied here (and
        // would fail with "Cannot replace object element which does not exist",
        // poisoning the rest of this module's patch chain). See the per-op
        // routing below.
        const serializedSchema = jsonValuesSchemaFor(path);
        for (const op of patchData.patch) {
          if (op.op === "file") {
            // A file op inside a `.jsonValues()` entry has nothing to inject
            // HERE: the entry is an opaque marker in the module source, so an
            // `add` reaching into it fails and poisons the rest of this
            // module's chain. `applyJsonValuesEntryPatches` writes the patch_id
            // into the entry's draft content instead.
            const fileCls = serializedSchema
              ? classifyJsonValuesOp(serializedSchema, op.path)
              : ({ kind: "normal" } as const);
            if (fileCls.kind === "entry" && fileCls.subPath.length > 0) {
              continue;
            }
            if (op.value !== null) {
              // NOTE: We insert the last patch_id that modify a file
              // when constructing the url we use the patch id (and the file path)
              // to fetch the right file
              // NOTE: overwrite and use last patch_id if multiple patches modify the same file
              fileFixOps[op.path.join("/")] = [
                {
                  op: "add",
                  path: op.path
                    .concat(...(op.nestedFilePath || []))
                    .concat("patch_id"),
                  value: patchId,
                },
              ];
            }
            // null value = delete: no patch_id to inject; the "remove" op in
            // the patch already removes the metadata entry from the source
          } else {
            const cls = serializedSchema
              ? classifyJsonValuesOp(serializedSchema, op.path)
              : ({ kind: "normal" } as const);
            if (cls.kind === "normal") {
              applicableOps.push(op);
            } else if (cls.subPath.length > 0) {
              // Content edit inside an entry: the module source is genuinely
              // unaffected (the content lives in the `*.val.json`), so skip it.
              // Draft content is served by the single-entry `/json` endpoint.
            } else if (op.op === "add" || op.op === "replace") {
              // Whole-entry add/replace: keep the record's KEY SET correct for
              // drafts by writing the marker rather than the content. Record
              // validation only asserts `isJson`, and
              // `validateJsonValuesEntries` skips thunkless markers by design.
              applicableOps.push({
                op: op.op,
                path: op.path,
                value: {
                  [VAL_EXTENSION]: "json",
                  patch_id: patchId,
                } as JSONValue,
              } as Operation);
            } else if (op.op === "remove") {
              applicableOps.push(op);
            } else {
              // move/copy of a whole entry: the destination key must appear, and
              // for a move the source key must disappear. Both are key-set
              // changes we can express with markers.
              applicableOps.push({
                op: "add",
                path: op.path,
                value: {
                  [VAL_EXTENSION]: "json",
                  patch_id: patchId,
                } as JSONValue,
              } as Operation);
              if (op.op === "move" && array.isNonEmpty(op.from)) {
                applicableOps.push({ op: "remove", path: op.from });
              }
            }
          }
        }
        const patchRes = applyPatch(
          deepClone(patchedSources[path] as ReadonlyJSONValue) as JSONValue, // applyPatch mutates the source. On add operations it adds more than once? There is something strange going on... deepClone seems to fix, but is that the right solution?
          jsonOps,
          applicableOps.concat(...Object.values(fileFixOps)),
        );
        if (result.isErr(patchRes)) {
          console.error(
            "Could not apply patch",
            JSON.stringify(
              {
                path,
                patchId,
                error: patchRes.error,
                applicableOps,
              },
              null,
              2,
            ),
          );
          if (!errors[path]) {
            errors[path] = [];
          }
          errors[path].push({
            patchId: patchId,
            skipped: false,
            error: patchRes.error,
          });
        } else {
          patchedSources[path] = patchRes.value;
        }
      }
    }
    return { sources: patchedSources, errors };
  }

  /**
   * Every module's source, with the pending patches applied.
   *
   * `getSources(analysis)` returns ONLY the modules that had patches, which is
   * not enough to validate with: cross-module checks (keyOf, router routes)
   * resolve against other modules' sources and report spurious errors when they
   * are absent. `/sources/~` overlays the two for exactly this reason.
   */
  async getSourcesWithPatchesApplied(
    analysis: PatchAnalysis & OrderedPatches,
  ): Promise<Awaited<ReturnType<ValOps["getSources"]>>> {
    const unpatched = await this.getSources();
    const patched = await this.getSources(analysis);
    return {
      sources: { ...unpatched.sources, ...patched.sources },
      errors: patched.errors,
    };
  }

  // #region validateSources
  async validateSources(
    schemas: Schemas,
    sources: Sources,
    patchesByModule?: PatchAnalysis["patchesByModule"],
  ): Promise<{
    errors: Record<
      ModuleFilePath,
      {
        invalidSource?: { message: string };
        validations: Record<SourcePath, ValidationError[]>;
      }
    >;
    files: Record<SourcePath, FileSource>;
    remoteFiles: Record<SourcePath, MediaSource>;
  }> {
    const errors: Record<
      ModuleFilePath,
      {
        invalidSource?: { message: string };
        validations: Record<SourcePath, ValidationError[]>;
      }
    > = {};
    const files: Record<SourcePath, FileSource> = {};
    const remoteFiles: Record<SourcePath, MediaSource> = {};
    const entries = Object.entries(schemas);
    // Build a map of gallery directory → [ModuleFilePath, ...] across ALL modules
    // (must include all modules, not just those being validated, since conflicts can come from any module)
    const galleryDirectoryToModules = new Map<string, ModuleFilePath[]>();
    // Build a schema/source snapshot so the shared resolver can cross-reference
    // keyof:check-keys and router:check-route against every module's data.
    const snapshot: SchemaSourceSnapshot = { schemas: {}, sources: {} };
    for (const [moduleFilePathS, schema] of entries) {
      const moduleFilePath = moduleFilePathS as ModuleFilePath;
      const serialized = schema["executeSerialize"]();
      snapshot.schemas[moduleFilePath] = serialized;
      const sourceForModule = sources[moduleFilePath];
      if (sourceForModule !== undefined) {
        snapshot.sources[moduleFilePath] = sourceForModule as Json;
      }
      if (
        serialized.type === "record" &&
        serialized.mediaType &&
        serialized.directory
      ) {
        const dir = serialized.directory;
        const existing = galleryDirectoryToModules.get(dir);
        if (existing) {
          existing.push(moduleFilePath);
        } else {
          galleryDirectoryToModules.set(dir, [moduleFilePath]);
        }
      }
    }
    const modulePathsToValidate =
      patchesByModule && Object.keys(patchesByModule);
    for (const [pathS, schema] of entries) {
      if (modulePathsToValidate && !modulePathsToValidate.includes(pathS)) {
        continue;
      }
      const path = pathS as ModuleFilePath;
      const source = sources[path];
      if (source === undefined) {
        if (!errors[path]) {
          errors[path] = { validations: {} };
        }
        errors[path] = {
          ...errors[path],
          invalidSource: {
            message: `Module at path: '${path}' does not exist`,
          },
        };
        continue;
      }
      const res = schema["executeValidate"](
        path as string as SourcePath,
        source,
      );
      // For `.jsonValues()` records, executeValidate only checks the entry
      // markers; load + validate each entry's backing `*.val.json` content here.
      const { errors: jsonValuesErrors } = await validateJsonValuesEntries(
        schema,
        source,
        path,
      );
      for (const [sourcePathS, entryErrors] of Object.entries(
        jsonValuesErrors,
      )) {
        const sourcePath = sourcePathS as SourcePath;
        if (!errors[path]) {
          errors[path] = { validations: {} };
        }
        if (!errors[path].validations[sourcePath]) {
          errors[path].validations[sourcePath] = [];
        }
        errors[path].validations[sourcePath].push(...entryErrors);
      }
      if (res === false) {
        continue;
      }
      for (const [sourcePathS, validationErrors] of Object.entries(res)) {
        const sourcePath = sourcePathS as SourcePath;
        const addError = (validationError: ValidationError) => {
          if (!errors[path]) {
            errors[path] = { validations: {} };
          }
          if (!errors[path].validations[sourcePath]) {
            errors[path].validations[sourcePath] = [];
          }
          errors[path].validations[sourcePath].push(validationError);
        };

        if (validationErrors) {
          for (const validationError of validationErrors) {
            if (isOnlyFileCheckValidationError(validationError)) {
              if (files[sourcePath]) {
                addError({
                  message:
                    "Cannot have multiple files with same path. Path: " +
                    sourcePath +
                    "; Module: " +
                    path,
                });
                continue;
              }
              const value = validationError.value;
              if (isFileSource(value)) {
                files[sourcePath] = value;
              }
            } else if (
              validationError.fixes?.includes("image:check-remote") ||
              validationError.fixes?.includes("file:check-remote")
            ) {
              remoteFiles[sourcePath] = validationError.value as MediaSource;
            } else if (
              validationError.fixes?.includes("keyof:check-keys") ||
              validationError.fixes?.includes("router:check-route")
            ) {
              const resolved = resolveSchemaSourceFixForError(
                validationError,
                snapshot,
              );
              if (resolved && resolved.status === "remaining") {
                addError(resolved.error);
              }
              // resolved.status === "resolved" → drop silently
            } else if (
              validationError.fixes?.includes("images:check-unique-folder") ||
              validationError.fixes?.includes("files:check-unique-folder")
            ) {
              const TYPE_ERROR_MESSAGE = `This is most likely a Val version mismatch or Val bug.`;
              if (
                !validationError.value ||
                typeof validationError.value !== "object"
              ) {
                addError({
                  message: `Could not find a directory value for gallery at ${sourcePath}. ${TYPE_ERROR_MESSAGE}`,
                  typeError: true,
                });
              } else {
                const directory =
                  "directory" in validationError.value &&
                  validationError.value.directory;
                if (typeof directory !== "string") {
                  addError({
                    message: `Expected gallery validation error 'value' to have property 'directory' of type 'string'. Found: ${typeof directory}. ${TYPE_ERROR_MESSAGE}`,
                    typeError: true,
                  });
                } else {
                  const modulesUsingDir =
                    galleryDirectoryToModules.get(directory) ?? [];
                  const conflictingModules = modulesUsingDir.filter(
                    (m) => m !== path,
                  );
                  if (conflictingModules.length > 0) {
                    addError({
                      message: `Gallery directory '${directory}' in ${path} conflicts with: ${conflictingModules.join(", ")}. Each gallery must use a unique directory.`,
                    });
                  }
                  // If conflictingModules is empty, directory is unique — silently drop the error.
                }
              }
            } else if (
              validationError.fixes?.includes("images:check-all-files") ||
              validationError.fixes?.includes("files:check-all-files")
            ) {
              // Requires filesystem access to enumerate the gallery directory.
              // validateSources() does not have filesystem access, so this is suppressed.
              // The actual check + fix is applied via createFixPatch.ts when explicitly requested.
            } else {
              addError(validationError);
            }
          }
        }
      }
    }
    return { errors, files, remoteFiles };
  }

  async validateRemoteFiles(
    schemas: Schemas,
    sources: Sources,
    remoteFiles: Record<SourcePath, MediaSource>,
  ): Promise<Record<SourcePath, ValidationError[]>> {
    // TODO: Implement
    return {};
  }

  // #region validateFiles
  async validateFiles(
    schemas: Schemas,
    sources: Sources,
    files: Record<SourcePath, FileSource>,
    fileLastUpdatedByPatchId?: PatchAnalysis["fileLastUpdatedByPatchId"],
  ): Promise<Record<SourcePath, ValidationError[]>> {
    const validateFileAtSourcePath = async (
      sourcePath: SourcePath,
      value: FileSource,
    ): Promise<ValidationErrors> => {
      const [fullModulePath, modulePath] =
        Internal.splitModuleFilePathAndModulePath(sourcePath);
      const schema = schemas[fullModulePath];
      if (!schema) {
        return {
          [sourcePath]: [
            {
              message: `Schema not found for path: '${fullModulePath}'`,
              value,
            } satisfies ValidationError,
          ],
        };
      }

      const source = sources[fullModulePath];
      if (!source) {
        return {
          [sourcePath]: [
            {
              message: `Source not found for path: '${fullModulePath}'`,
              value,
            } satisfies ValidationError,
          ],
        };
      }

      let schemaAtPath;
      try {
        const { schema: resolvedSchema } = Internal.resolvePath(
          modulePath,
          sources[fullModulePath],
          schemas[fullModulePath],
        );
        schemaAtPath = resolvedSchema;
      } catch (e) {
        if (e instanceof Error) {
          return {
            [sourcePath]: [
              {
                message: `Could not resolve schema at path: ${modulePath}. Error: ${e.message}`,
                value,
              } satisfies ValidationError,
            ],
          };
        }
        return {
          [sourcePath]: [
            {
              message: `Could not resolve schema at path: ${modulePath}. Unknown error.`,
              value,
            } satisfies ValidationError,
          ],
        };
      }
      const type = schemaAtPath instanceof ImageSchema ? "image" : "file";
      const filePath = value.path;
      const fileData: { patchId: PatchId; remote: boolean } | null =
        fileLastUpdatedByPatchId?.[filePath] || null;
      let metadata;
      let metadataErrors;

      // TODO: refactor so we call get metadata once instead of iterating like this. Reason: should be a lot faster
      if (fileData) {
        const patchFileMetadata =
          await this.getBase64EncodedBinaryFileMetadataFromPatch(
            filePath,
            type,
            fileData.patchId,
            fileData.remote,
          );
        if (patchFileMetadata.errors) {
          metadataErrors = patchFileMetadata.errors;
        } else {
          metadata = patchFileMetadata.metadata;
        }
      } else {
        const patchFileMetadata = await this.getBinaryFileMetadata(
          filePath,
          type,
        );
        if (patchFileMetadata.errors) {
          metadataErrors = patchFileMetadata.errors;
        } else {
          metadata = patchFileMetadata.metadata;
        }
      }
      if (metadataErrors && metadataErrors.length > 0) {
        return {
          [sourcePath]: metadataErrors.map((e) => ({
            message: e.message,
            value: { filePath, patchId: fileData?.patchId ?? null },
          })),
        };
      }
      if (!metadata) {
        return {
          [sourcePath]: [
            {
              message: "Unexpectedly got no metadata",
              value: { filePath },
            } satisfies ValidationError,
          ],
        };
      }
      // The fields Val computes from the bytes sit next to `path` now, so the
      // error is reported at the field it is about rather than at a `metadata`
      // object that no longer exists.
      const currentValueMetadata = value;

      const fieldErrors: Record<SourcePath, ValidationError[]> = {};
      for (const field of getFieldsForType(type)) {
        const fieldMetadata = metadata[field];
        const fieldSourcePath = Internal.createValPathOfItem(sourcePath, field);
        if (!fieldSourcePath) {
          throw new Error("Could not create field path");
        }
        if (!(field in currentValueMetadata)) {
          return {
            [fieldSourcePath]: [
              {
                message: `Missing metadata field: '${field}'`,
                value,
              } satisfies ValidationError,
            ],
          };
        }
        if (fieldMetadata !== currentValueMetadata[field]) {
          fieldErrors[fieldSourcePath] = [
            {
              message: `Metadata field '${field}' of value: ${JSON.stringify(
                currentValueMetadata[field],
              )} does not match expected value: ${JSON.stringify(
                fieldMetadata,
              )}`,
              value: {
                actual: currentValueMetadata[field],
                expected: fieldMetadata,
              },
              fixes: ["image:check-metadata"],
            },
          ];
        }
      }
      return fieldErrors;
    };

    const allErrors: [SourcePath, ValidationError[]][] = (
      await Promise.all(
        Object.entries(files).map(([sourcePathS, value]) =>
          validateFileAtSourcePath(sourcePathS as SourcePath, value).then(
            (res) => {
              if (res) {
                return Object.entries(res) as [SourcePath, ValidationError[]][];
              } else {
                return [];
              }
            },
          ),
        ),
      )
    ).flat();
    return Object.fromEntries(allErrors);
  }

  // #region prepareCommit
  /**
   * Applies the pending patches to the source files so they can be committed.
   *
   * @param options.continueOnError Diagnosis only. By default a patch that
   * cannot be applied aborts the rest of that module's chain, which is what
   * /save requires: the commit is refused and nothing is written. With this
   * flag the failing patch is recorded in `unappliablePatches` and the chain
   * continues on the unchanged source file, so a single run reports *every*
   * unappliable patch instead of only the first one per module. The commit is
   * still refused (`hasErrors` stays true) - this only makes the report
   * complete.
   */
  async prepare(
    patchAnalysis: PatchAnalysis & OrderedPatches,
    options?: { continueOnError?: boolean },
  ): Promise<PreparedCommit> {
    const continueOnError = options?.continueOnError ?? false;
    const { patchesByModule, fileLastUpdatedByPatchId } = patchAnalysis;
    const patchedSourceFiles: Record<string, string | null> = {};
    const previousSourceFiles: Record<ModuleFilePath, string> = {};
    const partiallyPatchedSourceFiles: Record<ModuleFilePath, string> = {};
    const unappliablePatches: Record<
      PatchId,
      { moduleFilePath: ModuleFilePath; message: string }
    > = {};

    // Serialized schemas are needed to route ops that target `.jsonValues()`
    // entries (their content lives in `*.val.json`, not the `.val.ts`).
    const schemas = await this.getSchemas();

    const applySourceFilePatches = async (
      path: ModuleFilePath,
      patches: { patchId: PatchId }[],
    ): Promise<
      | {
          path: ModuleFilePath;
          // `null` means the `.val.ts` itself was not changed (e.g. pure
          // jsonValues content edits only touch `*.val.json`).
          result: string | null;
          // Extra files to write/delete (jsonValues `*.val.json` entries).
          extraFiles: Record<string, string | null>;
          /**
           * The same entry content, keyed by ENTRY KEY. `null` = deleted.
           *
           * `extraFiles` is keyed by file path, which is not what a reader of an
           * entry has to go on — see `jsonEntryContentsByKey`.
           */
          jsonEntries: Record<string, JSONValue | null>;
          appliedPatches: PatchId[];
          errors?: undefined;
        }
      | {
          path: ModuleFilePath;
          appliedPatches?: PatchId[];
          triedPatches?: PatchId[];
          skippedPatches?: PatchId[];
          errors: PatchSourceError[];
        }
    > => {
      const sourceFileRes = await this.getSourceFile(path);

      const errors: PatchSourceError[] = [];
      if (sourceFileRes.error) {
        errors.push({
          message: sourceFileRes.error.message,
          filePath: path,
        });
        return {
          path,
          errors,
          skippedPatches: patches.map((p) => p.patchId),
        };
      }
      const sourceFile = sourceFileRes.data;
      previousSourceFiles[path] = sourceFile;
      const originalSourceFile = ts.createSourceFile(
        "<val>",
        sourceFile,
        ts.ScriptTarget.ES2015,
      );
      let tsSourceFile = originalSourceFile;
      let tsChanged = false;
      let serializedSchema: SerializedSchema | undefined = undefined;
      try {
        serializedSchema = schemas[path]?.["executeSerialize"]();
      } catch {
        // Serialization errors are reported elsewhere; treat as "no schema".
        // Without this guard one unserializable schema (e.g. a `keyOf` with an
        // empty selector) rejects the whole prepare(), so NO module's patches
        // can be saved — instead of this module's ops being routed as plain
        // `.val.ts` ops and any that cannot apply reported per-patch.
      }

      // jsonValues entry content, keyed by `*.val.json` path. `null` = delete.
      const jsonEntryContents = new Map<string, JSONValue | null>();
      /**
       * The same content, keyed by ENTRY KEY rather than by file path.
       *
       * The path is what gets written; the key is what a reader asks for, and it
       * is dropped at the flush below. Reconstructing it afterwards is not on:
       * TWO producers turn a key into a path — `resolveEntryJsonPath` and
       * `getNewJsonEntryPaths`, the latter a locked convention for `add` and a
       * move's destination — and a marker does not carry its path at read time
       * (see `jsonEntryFiles.ts`). So it is recorded where the key is known.
       *
       * Read by `ValOps.adoptCommittedSources`, so a save can tell this instance
       * what an entry now holds. Nothing else can: an entry's committed content
       * is resolved through the marker's own `import()`, which caches, so the
       * memo cannot be refreshed by re-reading.
       */
      const jsonEntryContentsByKey = new Map<string, JSONValue | null>();
      // Entries added in this commit → their new `*.val.json` path, so later
      // content ops in the same commit resolve to the freshly-created file.
      const entryKeyToJsonPath = new Map<string, string>();

      // Lazily analyzed `c.json(() => import("..."))` entries of the ORIGINAL
      // `.val.ts` (import paths are authoritative for existing/hand-placed files).
      let analyzerEntries: Map<string, { importPath: string }> | null = null;
      const resolveEntryJsonPath = (
        entryKey: string,
      ): result.Result<string, PatchSourceError> => {
        const added = entryKeyToJsonPath.get(entryKey);
        if (added !== undefined) {
          return result.ok(added);
        }
        if (analyzerEntries === null) {
          const analysis = analyzeValModule(originalSourceFile);
          if (result.isErr(analysis)) {
            return result.err(analysis.error);
          }
          analyzerEntries = analyzeJsonValuesEntries(analysis.value.source);
        }
        const entry = analyzerEntries.get(entryKey);
        if (!entry) {
          return result.err({
            message: `Could not find jsonValues entry '${entryKey}' in ${path}`,
            filePath: path,
          });
        }
        return result.ok(resolveExistingJsonPath(path, entry.importPath));
      };
      const loadEntryContent = async (
        jsonPath: string,
      ): Promise<result.Result<JSONValue, PatchSourceError>> => {
        const current = jsonEntryContents.get(jsonPath);
        if (current !== undefined) {
          if (current === null) {
            return result.err({
              message: `Cannot edit a removed jsonValues entry: ${jsonPath}`,
              filePath: jsonPath,
            });
          }
          return result.ok(current);
        }
        const res = await this.getSourceFile(jsonPath as ModuleFilePath);
        if (res.error) {
          return result.err({ message: res.error.message, filePath: jsonPath });
        }
        try {
          const parsed: JSONValue = JSON.parse(res.data);
          jsonEntryContents.set(jsonPath, parsed);
          return result.ok(parsed);
        } catch (err) {
          return result.err({
            message: `Could not parse jsonValues entry ${jsonPath}: ${
              err instanceof Error ? err.message : String(err)
            }`,
            filePath: jsonPath,
          });
        }
      };
      const collectPatchError = (
        err: PatchError | ValSyntaxErrorTree,
        patchId: PatchId,
        op: unknown,
      ) => {
        console.error(
          "Could not patch",
          JSON.stringify({ path, patchId, error: err, op }, null, 2),
        );
        if (Array.isArray(err)) {
          errors.push(...err);
        } else {
          errors.push(err);
        }
      };

      const appliedPatches: PatchId[] = [];
      const triedPatches: PatchId[] = [];
      for (const { patchId } of patches) {
        const patchData = patchAnalysis.patches.find(
          (p) => p.patchId === patchId,
        );
        if (!patchData) {
          const message = `Analysis required non-existing patch: ${patchId}`;
          errors.push({ message });
          unappliablePatches[patchId] = { moduleFilePath: path, message };
          triedPatches.push(patchId);
          if (continueOnError) {
            continue;
          }
          break;
        }
        const patch = patchData.patch;
        const sourceFileOps = patch.filter((op) => op.op !== "file"); // file is not a valid source file op
        let patchHadError = false;
        // Where this patch's errors start, so the unappliable-patch report below
        // can name what went wrong rather than just that something did.
        const errorsBefore = errors.length;
        for (const op of sourceFileOps) {
          const cls = serializedSchema
            ? classifyJsonValuesOp(serializedSchema, op.path)
            : ({ kind: "normal" } as const);
          // `move` / `copy` also READ from a path: classify that too, so an op
          // that moves a value out of (or into) a jsonValues entry cannot slip
          // through as a plain `.val.ts` op.
          const fromCls =
            serializedSchema && (op.op === "move" || op.op === "copy")
              ? classifyJsonValuesOp(serializedSchema, op.from)
              : ({ kind: "normal" } as const);
          if (cls.kind === "normal" && fromCls.kind === "normal") {
            const patchRes = applyPatch(tsSourceFile, tsOps, [op]);
            if (result.isErr(patchRes)) {
              collectPatchError(patchRes.error, patchId, op);
              patchHadError = true;
              break;
            }
            tsSourceFile = patchRes.value;
            tsChanged = true;
            continue;
          }
          if (cls.kind === "normal") {
            errors.push({
              message: `Cannot '${op.op}' a value out of a jsonValues entry and into the module source`,
              filePath: path,
            });
            patchHadError = true;
            break;
          }
          // Nested `.jsonValues()` records are not supported: only the read path
          // for a module's ROOT record/router is implemented end to end. This is
          // also rejected up front in `initSources`; this is defense in depth.
          if (
            cls.recordPath.length > 0 ||
            (fromCls.kind === "entry" && fromCls.recordPath.length > 0)
          ) {
            errors.push({
              message: `Nested .jsonValues() records are not supported: '${cls.recordPath.join(
                ".",
              )}' in ${path}. Use .jsonValues() only on a module's root record/router.`,
              filePath: path,
            });
            patchHadError = true;
            break;
          }
          // The op targets a `.jsonValues()` entry.
          if (cls.subPath.length === 0) {
            // Structural / whole-entry op.
            if (op.op === "add") {
              const newPathsRes = getNewJsonEntryPaths(path, cls.entryKey);
              if (result.isErr(newPathsRes)) {
                errors.push(newPathsRes.error);
                patchHadError = true;
                break;
              }
              const { jsonPath, importPath } = newPathsRes.value;
              const insRes = insertValJsonEntry(
                tsSourceFile,
                cls.recordPath,
                cls.entryKey,
                importPath,
              );
              if (result.isErr(insRes)) {
                collectPatchError(insRes.error, patchId, op);
                patchHadError = true;
                break;
              }
              tsSourceFile = insRes.value;
              tsChanged = true;
              jsonEntryContents.set(jsonPath, op.value);
              jsonEntryContentsByKey.set(cls.entryKey, op.value);
              entryKeyToJsonPath.set(cls.entryKey, jsonPath);
            } else if (op.op === "remove") {
              const jsonPathRes = resolveEntryJsonPath(cls.entryKey);
              if (result.isErr(jsonPathRes)) {
                errors.push(jsonPathRes.error);
                patchHadError = true;
                break;
              }
              const remRes = removeValJsonEntry(
                tsSourceFile,
                cls.recordPath,
                cls.entryKey,
              );
              if (result.isErr(remRes)) {
                collectPatchError(remRes.error, patchId, op);
                patchHadError = true;
                break;
              }
              tsSourceFile = remRes.value;
              tsChanged = true;
              jsonEntryContents.set(jsonPathRes.value, null);
              jsonEntryContentsByKey.set(cls.entryKey, null);
            } else if (op.op === "replace") {
              const jsonPathRes = resolveEntryJsonPath(cls.entryKey);
              if (result.isErr(jsonPathRes)) {
                errors.push(jsonPathRes.error);
                patchHadError = true;
                break;
              }
              jsonEntryContents.set(jsonPathRes.value, op.value);
              jsonEntryContentsByKey.set(cls.entryKey, op.value);
            } else if (op.op === "move" || op.op === "copy") {
              // Rename (move) or duplicate (copy) a whole entry. The new entry
              // gets its own `*.val.json` written with the source entry's
              // content plus a `c.json(...)` thunk; a move additionally drops
              // the old thunk and deletes the old file.
              if (
                fromCls.kind !== "entry" ||
                fromCls.subPath.length !== 0 ||
                fromCls.recordPath.join("\0") !== cls.recordPath.join("\0")
              ) {
                errors.push({
                  message: `Cannot '${
                    op.op
                  }' a jsonValues entry across records or from a non-entry path (from '${op.from.join(
                    ".",
                  )}' to '${op.path.join(".")}')`,
                  filePath: path,
                });
                patchHadError = true;
                break;
              }
              const fromKey = fromCls.entryKey;
              const fromPathRes = resolveEntryJsonPath(fromKey);
              if (result.isErr(fromPathRes)) {
                errors.push(fromPathRes.error);
                patchHadError = true;
                break;
              }
              // Load BEFORE marking anything deleted: `loadEntryContent` errors
              // on a path that has already been nulled in this commit.
              const contentRes = await loadEntryContent(fromPathRes.value);
              if (result.isErr(contentRes)) {
                errors.push(contentRes.error);
                patchHadError = true;
                break;
              }
              const content = deepClone(contentRes.value);
              if (op.op === "move") {
                const remRes = removeValJsonEntry(
                  tsSourceFile,
                  cls.recordPath,
                  fromKey,
                );
                if (result.isErr(remRes)) {
                  collectPatchError(remRes.error, patchId, op);
                  patchHadError = true;
                  break;
                }
                tsSourceFile = remRes.value;
              }
              // LOCKED convention: the destination always uses the generated
              // path, so renaming a hand-placed file relocates it.
              const newPathsRes = getNewJsonEntryPaths(path, cls.entryKey);
              if (result.isErr(newPathsRes)) {
                errors.push(newPathsRes.error);
                patchHadError = true;
                break;
              }
              const { jsonPath, importPath } = newPathsRes.value;
              const insRes = insertValJsonEntry(
                tsSourceFile,
                cls.recordPath,
                cls.entryKey,
                importPath,
              );
              if (result.isErr(insRes)) {
                collectPatchError(insRes.error, patchId, op);
                patchHadError = true;
                break;
              }
              tsSourceFile = insRes.value;
              tsChanged = true;
              jsonEntryContents.set(jsonPath, content);
              jsonEntryContentsByKey.set(cls.entryKey, content);
              entryKeyToJsonPath.set(cls.entryKey, jsonPath);
              if (op.op === "move" && fromPathRes.value !== jsonPath) {
                jsonEntryContents.set(fromPathRes.value, null);
                jsonEntryContentsByKey.set(fromKey, null);
              }
            } else {
              errors.push({
                message: `Unsupported op '${op.op}' on jsonValues entry '${cls.entryKey}' (supported: add, remove, replace, move, copy)`,
                filePath: path,
              });
              patchHadError = true;
              break;
            }
          } else {
            // Content sub-op: replay against the entry's `*.val.json`.
            // `rebaseContentOp` slices `from` by the same prefix as `path`, so a
            // cross-entry move/copy would silently corrupt the target entry.
            if (
              (op.op === "move" || op.op === "copy") &&
              (fromCls.kind !== "entry" || fromCls.entryKey !== cls.entryKey)
            ) {
              errors.push({
                message: `Cannot '${op.op}' between different jsonValues entries`,
                filePath: path,
              });
              patchHadError = true;
              break;
            }
            const jsonPathRes = resolveEntryJsonPath(cls.entryKey);
            if (result.isErr(jsonPathRes)) {
              errors.push(jsonPathRes.error);
              patchHadError = true;
              break;
            }
            const jsonPath = jsonPathRes.value;
            const contentRes = await loadEntryContent(jsonPath);
            if (result.isErr(contentRes)) {
              errors.push(contentRes.error);
              patchHadError = true;
              break;
            }
            const rebasedRes = rebaseContentOp(op, cls.recordPath.length + 1);
            if (result.isErr(rebasedRes)) {
              errors.push({
                message: rebasedRes.error.message,
                filePath: jsonPath,
              });
              patchHadError = true;
              break;
            }
            const applied = applyPatch(deepClone(contentRes.value), jsonOps, [
              rebasedRes.value,
            ]);
            if (result.isErr(applied)) {
              collectPatchError(applied.error, patchId, op);
              patchHadError = true;
              break;
            }
            jsonEntryContents.set(jsonPath, applied.value);
            jsonEntryContentsByKey.set(cls.entryKey, applied.value);
          }
        }
        if (patchHadError) {
          unappliablePatches[patchId] = {
            moduleFilePath: path,
            // The per-op loop reports through `errors`, so take what it added
            // for THIS patch — the same information a single applyPatch gives
            // via formatPatchSourceError.
            message:
              errors
                .slice(errorsBefore)
                .map(formatPatchSourceError)
                .join("\n") || `Could not apply patch: ${patchId}`,
          };
          triedPatches.push(patchId);
          if (continueOnError) {
            // Carry on so a single run reports EVERY unappliable patch, not just
            // the first per module. Note that the ops of this patch BEFORE the
            // failing one have already been applied, so what follows builds on a
            // partially patched state — fine, because continueOnError is
            // diagnosis only and the commit is refused regardless.
            continue;
          }
          break;
        }
        appliedPatches.push(patchId);
      }
      if (errors.length > 0 && continueOnError) {
        // Diagnosis: expose what the source file would look like with the
        // appliable patches applied, so a caller can diff it even though the
        // commit is (correctly) refused.
        partiallyPatchedSourceFiles[path] = unescape(
          tsSourceFile.getText(tsSourceFile).replace(/\\u/g, "%u"),
        );
      }
      if (errors.length === 0) {
        // https://github.com/microsoft/TypeScript/issues/36174
        let sourceFileText: string | null = null;
        if (tsChanged) {
          sourceFileText = unescape(
            tsSourceFile.getText(tsSourceFile).replace(/\\u/g, "%u"),
          );
          if (this.options?.formatter) {
            try {
              sourceFileText = await this.options.formatter(
                sourceFileText,
                path,
              );
            } catch (err) {
              errors.push({
                message:
                  "Could not format source file: " +
                  (err instanceof Error ? err.message : "Unknown error"),
              });
            }
          }
        }
        const extraFiles: Record<string, string | null> = {};
        for (const [jsonPath, content] of Array.from(jsonEntryContents)) {
          if (content === null) {
            extraFiles[jsonPath] = null;
            continue;
          }
          let jsonText = JSON.stringify(content, null, 2);
          if (this.options?.formatter) {
            try {
              jsonText = await this.options.formatter(jsonText, jsonPath);
            } catch (err) {
              errors.push({
                message:
                  "Could not format jsonValues entry: " +
                  (err instanceof Error ? err.message : "Unknown error"),
                filePath: jsonPath,
              });
            }
          }
          extraFiles[jsonPath] = jsonText;
        }
        if (errors.length === 0) {
          return {
            path,
            appliedPatches,
            result: sourceFileText,
            extraFiles,
            jsonEntries: Object.fromEntries(jsonEntryContentsByKey),
          };
        }
      }
      const skippedPatches = patches
        .slice(appliedPatches.length + triedPatches.length)
        .map((p) => p.patchId);

      return {
        path,
        appliedPatches,
        triedPatches,
        skippedPatches,
        errors,
      };
    };
    const patchedJsonEntries: Record<
      ModuleFilePath,
      Record<string, JSONValue | null>
    > = {};
    const allResults = await Promise.all(
      Object.entries(patchesByModule).map(([path, patches]) =>
        applySourceFilePatches(path as ModuleFilePath, patches),
      ),
    );
    let hasErrors = false;
    const sourceFilePatchErrors: Record<ModuleFilePath, PatchSourceError[]> =
      {};
    const appliedPatches: Record<ModuleFilePath, PatchId[]> = {};
    const triedPatches: Record<ModuleFilePath, PatchId[]> = {};
    const skippedPatches: Record<ModuleFilePath, PatchId[]> = {};

    //
    const globalAppliedPatches: PatchId[] = [];
    for (const res of allResults) {
      if (res.errors) {
        hasErrors = true;
        sourceFilePatchErrors[res.path] = res.errors;
        appliedPatches[res.path] = res.appliedPatches ?? [];
        triedPatches[res.path] = res.triedPatches ?? [];
        skippedPatches[res.path] = res.skippedPatches ?? [];
      } else {
        // `result` is null when the `.val.ts` itself was not changed (pure
        // jsonValues content edits only write `*.val.json` extraFiles).
        if (res.result !== null) {
          patchedSourceFiles[res.path] = res.result;
        }
        for (const [extraPath, data] of Object.entries(res.extraFiles)) {
          patchedSourceFiles[extraPath] = data;
        }
        // Kept per module and per entry key, not flattened into
        // `patchedSourceFiles` beside the files: a reader of an entry has a
        // module and a key, never a path. See `patchedJsonEntries`.
        if (Object.keys(res.jsonEntries).length > 0) {
          patchedJsonEntries[res.path] = res.jsonEntries;
        }
        appliedPatches[res.path] = res.appliedPatches ?? [];
      }
      for (const patchId of res.appliedPatches ?? []) {
        globalAppliedPatches.push(patchId);
      }
    }
    const patchedBinaryFilesDescriptors: Record<
      string,
      {
        patchId: PatchId;
        remote: boolean;
      }
    > = {};
    const binaryFilePatchErrors: Record<string, { message: string }> = {};
    await Promise.all(
      Object.entries(fileLastUpdatedByPatchId).map(
        async ([filePath, patchData]) => {
          const { patchId, remote, isDelete } = patchData;
          if (globalAppliedPatches.includes(patchId)) {
            if (isDelete) {
              // Signal file deletion via patchedSourceFiles null entry
              patchedSourceFiles[filePath] = null;
            } else {
              // TODO: do we want to make sure the file is there? Then again, it should be rare that it happens (unless there's a Val bug) so it might be enough to fail later (at commit)
              // TODO: include sha256? This way we can make sure we pick the right file since theoretically there could be multiple files with the same path in the same patch
              // or is that the case? We are picking the latest file by path so, that should be enough?
              patchedBinaryFilesDescriptors[filePath] = {
                patchId,
                remote,
              };
            }
          } else {
            hasErrors = true;
            binaryFilePatchErrors[filePath] = {
              message: "Patch not applied",
            };
          }
        },
      ),
    );

    const res: PreparedCommit = {
      hasErrors,
      sourceFilePatchErrors,
      binaryFilePatchErrors,
      unappliablePatches,
      patchedSourceFiles,
      patchedJsonEntries,
      previousSourceFiles,
      partiallyPatchedSourceFiles,
      patchedBinaryFilesDescriptors,
      appliedPatches,
      skippedPatches,
      triedPatches,
    };
    return res;
  }

  /**
   * Reads a project file as text at whatever revision this ops instance points
   * at: the deployed commit in http mode, the working tree in fs mode.
   *
   * Public counterpart of `getSourceFile`, for the CLI's debug snapshot. The
   * snapshot has to capture the exact text `prepare` patches, which in http mode
   * is NOT the local working copy.
   */
  async readProjectFile(
    path: string,
  ): Promise<WithGenericError<{ data: string }>> {
    return this.getSourceFile(path);
  }

  // #region createPatch
  async createPatch(
    path: ModuleFilePath,
    patch: Patch,
    patchId: PatchId,
    parentRef: ParentRef,
    sessionId: string | null,
    authorId: AuthorId | null,
    /**
     * Which patch group this patch joins, recorded in the SAME request.
     *
     * Atomic on purpose. The content API runs every refusal before its insert,
     * so an invalid closure is a 400 with nothing written. Recording membership
     * in a second call would let a patch exist outside its author's group if
     * that call failed — and a patch outside your own group is one you cannot
     * publish until a repair puts it back.
     *
     * Optional: `fs` mode has no groups, and a client that predates them sends
     * nothing.
     */
    patchGroup?: PatchGroupMembership,
  ): Promise<
    result.Result<
      {
        error?: undefined;
        patchId: PatchId;
        createdAt: string;
      },
      | { errorType: "other"; error: GenericErrorMessage }
      | { errorType: "patch-head-conflict" }
    >
  > {
    const saveRes = await this.saveSourceFilePatch(
      path,
      patch,
      patchId,
      parentRef,
      authorId,
      sessionId,
      patchGroup,
    );
    if (result.isErr(saveRes)) {
      console.error(
        `Could not save source patch at path: '${path}'. Error: ${saveRes.error.errorType === "other" ? saveRes.error.message : saveRes.error.errorType}`,
      );
      if (saveRes.error.errorType === "patch-head-conflict") {
        return result.err({ errorType: "patch-head-conflict" });
      }
      return result.err({ errorType: "other", error: saveRes.error });
    }
    return result.ok({
      patchId,
      createdAt: new Date().toISOString(),
    });
  }

  // #region abstract ops
  abstract onInit(baseSha: BaseSha, schemaSha: SchemaSha): Promise<void>;
  abstract fetchPatches<ExcludePatchOps extends boolean>(filters: {
    patchIds?: PatchId[];
    excludePatchOps: ExcludePatchOps;
  }): Promise<
    ExcludePatchOps extends true ? OrderedPatchesMetadata : OrderedPatches
  >;
  protected abstract saveSourceFilePatch(
    path: ModuleFilePath,
    patch: Patch,
    patchId: PatchId,
    parentRef: ParentRef | null,
    authorId: AuthorId | null,
    sessionId: string | null,
    patchGroup?: PatchGroupMembership,
  ): Promise<SaveSourceFilePatchResult>;
  protected abstract getSourceFile(
    path: string,
  ): Promise<WithGenericError<{ data: string }>>;
  abstract saveBase64EncodedBinaryFileFromPatch(
    filePath: string,
    parentRef: ParentRef,
    patchId: PatchId,
    data: string | null,
    type: "file" | "image",
    metadata: MetadataOfType<"file" | "image"> | undefined,
  ): Promise<WithGenericError<{ patchId: PatchId; filePath: string }>>;
  abstract getBase64EncodedBinaryFileFromPatch(
    filePath: string,
    patchId: PatchId,
    remote: boolean,
  ): Promise<Buffer | null>;
  protected abstract getBase64EncodedBinaryFileMetadataFromPatch<
    T extends "file" | "image",
  >(
    filePath: string,
    type: T,
    patchId: PatchId,
    remote: boolean,
  ): Promise<OpsMetadata<T>>;
  abstract getBinaryFile(filePathOrRef: string): Promise<Buffer | null>;
  protected abstract getBinaryFileMetadata<T extends "file" | "image">(
    filePath: string,
    type: T,
  ): Promise<OpsMetadata<T>>;
  abstract deletePatches(patchIds: PatchId[]): Promise<
    | { deleted: PatchId[]; errors?: undefined; error?: undefined }
    | {
        deleted: PatchId[];
        errors: Record<PatchId, GenericErrorMessage>;
      }
    | { error: GenericErrorMessage; errors?: undefined; deleted?: undefined }
  >;
}

function isOnlyFileCheckValidationError(validationError: ValidationError) {
  if (
    validationError.fixes?.every(
      (f) => f === "file:check-metadata" || f === "image:check-metadata",
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Whether a flagged validation value is media.
 *
 * The caller already knows the schema said image or file — this only guards
 * against a value that never got that far.
 */
function isFileSource(value: unknown): value is FileSource {
  return (
    typeof value === "object" &&
    value !== null &&
    "path" in value &&
    typeof value.path === "string"
  );
}

export type WithGenericError<T extends Record<string, unknown>> =
  | (T & { error?: undefined })
  | GenericError;
export type GenericError = {
  error: {
    message: string;
  };
};
export type GenericErrorMessage = {
  message: string;
  details?: unknown;
};

/**
 * The patch group a newly created patch joins.
 *
 * `alsoAddPatchIds` is the CLOSURE the client computed — the patches that share
 * a patch set with this one and must move with it. It is not derived here and
 * must not be: the closure needs the content schema, and the service that
 * stores groups does not have it. One implementation of that rule, on the side
 * that can actually compute it.
 *
 * `closureVersion` is stored per membership row, so a bad client rollout stays
 * identifiable and recomputable after the fact.
 */
export type PatchGroupMembership = {
  patchGroupId: string;
  alsoAddPatchIds: PatchId[];
  closureVersion: number;
};

export type SaveSourceFilePatchResult = result.Result<
  { patchId: PatchId },
  | ({ errorType: "other" } & GenericErrorMessage)
  | { errorType: "patch-head-conflict" }
>;

export type PatchAnalysis = {
  patchesByModule: {
    [path: ModuleFilePath]: {
      patchId: PatchId;
    }[];
  };
  fileLastUpdatedByPatchId: Record<
    string,
    { patchId: PatchId; remote: boolean; isDelete: boolean }
  >;
};

export type PatchSourceError =
  | {
      message: string;
      filePath?: string;
    }
  | PatchError
  | ValSyntaxError
  | ValSyntaxErrorTree;

export function formatPatchSourceError(error: PatchSourceError): string {
  if ("message" in error) {
    return error.message;
  } else if (Array.isArray(error)) {
    return error.map(formatPatchSourceError).join("\n");
  } else {
    const _exhaustiveCheck: never = error;
    return "Unknown patch source error: " + JSON.stringify(_exhaustiveCheck);
  }
}

export type MetadataOfType<T extends "file" | "image"> = T extends "image"
  ? Omit<ImageMetadata, "hotspot">
  : FileMetadata;
export type OpsMetadata<T extends "file" | "image"> =
  | {
      metadata: MetadataOfType<T>;
      errors?: undefined;
    }
  | {
      errors: (
        | (GenericErrorMessage & {
            field: string;
          })
        | (GenericErrorMessage & {
            filePath?: string;
          })
      )[];
    };

export type BinaryFileType = "file" | "image";

export type PreparedCommit = {
  /**
   * Updated / new source files that are ready to be committed / saved.
   * A null value signals that the file at that path should be deleted.
   */
  patchedSourceFiles: Record<string, string | null>;
  /**
   * The committed content of every `.jsonValues()` entry this commit changed,
   * per module and entry key. `null` means the entry was deleted.
   *
   * Separate from {@link patchedSourceFiles} rather than folded into it, because
   * that map is keyed by FILE PATH and a reader of an entry has a module and a
   * key. A marker does not carry its path at read time, so the two are not
   * interchangeable — see `jsonEntryFiles.ts`.
   *
   * Here for {@link ValOps.adoptCommittedSources}: an entry's committed content
   * is resolved through the marker's own `import()`, which caches, so a save is
   * the only thing that can tell the server what the entry now holds.
   *
   * Only modules whose patches applied cleanly appear; a module that errored
   * contributes nothing, and `/save` refuses the commit anyway.
   */
  patchedJsonEntries: Record<ModuleFilePath, Record<string, JSONValue | null>>;
  /**
   * Previous source files that were patched
   */
  previousSourceFiles: Record<ModuleFilePath, string>;
  /**
   * Diagnosis only: what the source file looks like with the appliable patches
   * applied, for modules that had at least one unappliable patch. Populated
   * only when `prepare` is called with `continueOnError`. Never committed.
   */
  partiallyPatchedSourceFiles: Record<ModuleFilePath, string>;
  /**
   * The file path and patch id in which they appear of binary files that are ready to be committed / saved
   */
  patchedBinaryFilesDescriptors: Record<
    string,
    { patchId: PatchId; remote: boolean }
  >;
  /**
   * Source file patches that were successfully applied to get to this result
   */
  appliedPatches: Record<ModuleFilePath, PatchId[]>;
  //
  hasErrors: boolean;
  sourceFilePatchErrors: Record<ModuleFilePath, PatchSourceError[]>;
  binaryFilePatchErrors: Record<string, { message: string }>;
  /**
   * The patches that could not be applied, keyed by patch id.
   *
   * Same information as `sourceFilePatchErrors`, but attributed to the patch
   * that caused it, which is what a caller needs in order to report or remove
   * it. Without `continueOnError` this holds the first failing patch of each
   * module (the rest of that module's chain is never tried); with it, all of
   * them.
   */
  unappliablePatches: Record<
    PatchId,
    { moduleFilePath: ModuleFilePath; message: string }
  >;
  skippedPatches: Record<ModuleFilePath, PatchId[]>;
  triedPatches: Record<ModuleFilePath, PatchId[]>;
};

export type PatchErrors = Record<PatchId, GenericErrorMessage>;

export type PatchReadError =
  | {
      patchId: PatchId;
      message: string;
    }
  | {
      parentPatchId: ParentPatchId;
      message: string;
    };

export type OrderedPatches = {
  patches: {
    path: ModuleFilePath;
    patchId: PatchId;
    patch: Patch;
    createdAt: string;
    authorId: AuthorId | null;
    baseSha: BaseSha;
    appliedAt: {
      commitSha: CommitSha;
    } | null;
  }[];
  commits?: ValCommit[];
  error?: GenericErrorMessage;
  errors?: PatchReadError[];
  unauthorized?: boolean;
  networkError?: boolean;
};

export type OrderedPatchesMetadata = {
  patches: (Omit<OrderedPatches["patches"][number], "patch"> & {
    patch?: undefined;
  })[];
  commits?: ValCommit[];
  deployments?: ValDeployment[];
  error?: GenericErrorMessage;
  errors?: OrderedPatches["errors"];
  unauthorized?: boolean;
  networkError?: boolean;
};

export function getFieldsForType<T extends BinaryFileType>(
  type: T,
): (keyof MetadataOfType<T> & string)[] {
  if (type === "file") {
    return ["mimeType"] as (keyof MetadataOfType<"file"> & string)[];
  } else if (type === "image") {
    return [
      "mimeType",
      "height",
      "width",
    ] as (keyof MetadataOfType<"image">)[] as (keyof MetadataOfType<T> &
      string)[];
  }
  throw new Error("Unknown type: " + type);
}

export function createMetadataFromBuffer<T extends BinaryFileType>(
  type: BinaryFileType,
  mimeType: string,
  buffer: Buffer,
): OpsMetadata<T> {
  const errors = [];
  let availableMetadata: Record<string, string | number | undefined | null>;
  if (type === "image") {
    const { width, height, type } = sizeOf(new Uint8Array(buffer));
    const normalizedType =
      type === "jpg" ? "jpeg" : type === "svg" ? "svg+xml" : type;
    if (type !== undefined && `image/${normalizedType}` !== mimeType) {
      return {
        errors: [
          {
            message: `Mime type does not match image type: ${mimeType} vs ${type}`,
          },
        ],
      };
    }
    availableMetadata = {
      mimeType,
      height,
      width,
    };
  } else {
    availableMetadata = {
      mimeType,
    };
  }
  const metadata: Record<string, string | number> = {};
  for (const field of getFieldsForType(type)) {
    const foundFieldData =
      field in availableMetadata ? availableMetadata[field] : null;
    if (foundFieldData !== undefined && foundFieldData !== null) {
      metadata[field] = foundFieldData;
    } else {
      errors.push({ message: `Field not found: '${field}'`, field });
    }
  }
  if (errors.length > 0) {
    return { errors };
  }
  return { metadata } as OpsMetadata<T>;
}

const base64DataAttr = "data:";
export function getMimeTypeFromBase64(content: string): string | null {
  const dataIndex = content.indexOf(base64DataAttr);
  const base64Index = content.indexOf(";base64,");
  if (dataIndex > -1 || base64Index > -1) {
    const mimeType = content.slice(
      dataIndex + base64DataAttr.length,
      base64Index,
    );
    const normalizedMimeType =
      mimeType === "image/jpg" ? "image/jpeg" : mimeType;
    return normalizedMimeType;
  }
  return null;
}

// https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/MIME_types/Common_types
const COMMON_MIME_TYPES: Record<string, string> = {
  aac: "audio/aac",
  abw: "application/x-abiword",
  arc: "application/x-freearc",
  avif: "image/avif",
  avi: "video/x-msvideo",
  azw: "application/vnd.amazon.ebook",
  bin: "application/octet-stream",
  bmp: "image/bmp",
  bz: "application/x-bzip",
  bz2: "application/x-bzip2",
  cda: "application/x-cdf",
  csh: "application/x-csh",
  css: "text/css",
  csv: "text/csv",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  eot: "application/vnd.ms-fontobject",
  epub: "application/epub+zip",
  gz: "application/gzip",
  gif: "image/gif",
  htm: "text/html",
  html: "text/html",
  ico: "image/vnd.microsoft.icon",
  ics: "text/calendar",
  jar: "application/java-archive",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  js: "text/javascript",
  json: "application/json",
  jsonld: "application/ld+json",
  mid: "audio/midi",
  midi: "audio/midi",
  mjs: "text/javascript",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  mpeg: "video/mpeg",
  mpkg: "application/vnd.apple.installer+xml",
  odp: "application/vnd.oasis.opendocument.presentation",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odt: "application/vnd.oasis.opendocument.text",
  oga: "audio/ogg",
  ogv: "video/ogg",
  ogx: "application/ogg",
  opus: "audio/opus",
  otf: "font/otf",
  png: "image/png",
  pdf: "application/pdf",
  php: "application/x-httpd-php",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  rar: "application/vnd.rar",
  rtf: "application/rtf",
  sh: "application/x-sh",
  svg: "image/svg+xml",
  tar: "application/x-tar",
  tif: "image/tiff",
  tiff: "image/tiff",
  ts: "video/mp2t",
  ttf: "font/ttf",
  txt: "text/plain",
  vsd: "application/vnd.visio",
  wav: "audio/wav",
  weba: "audio/webm",
  webm: "video/webm",
  webp: "image/webp",
  woff: "font/woff",
  woff2: "font/woff2",
  xhtml: "application/xhtml+xml",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xml: "application/xml",
  xul: "application/vnd.mozilla.xul+xml",
  zip: "application/zip",
  "3gp": "video/3gpp; audio/3gpp if it doesn't contain video",
  "3g2": "video/3gpp2; audio/3gpp2 if it doesn't contain video",
  "7z": "application/x-7z-compressed",
};

export function guessMimeTypeFromPath(filePath: string): string | null {
  const fileExt = filePath.split(".").pop();
  if (fileExt) {
    return COMMON_MIME_TYPES[fileExt.toLowerCase()] || null;
  }
  return null;
}

export function bufferFromDataUrl(dataUrl: string): Buffer | undefined {
  let base64Data;
  const base64Index = dataUrl.indexOf(";base64,");
  if (base64Index > -1) {
    base64Data = dataUrl.slice(base64Index + ";base64,".length);
  }
  if (base64Data) {
    return Buffer.from(
      base64Data,
      "base64", // TODO: why does it not work with base64url?
    );
  }
}
