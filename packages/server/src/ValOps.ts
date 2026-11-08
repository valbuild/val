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
import type { HistoryError } from "./history/HistoryError";
import type {
  BuildRegistry,
  PlanRefusalErrorT,
} from "@valbuild/shared/internal";
import type {
  AffectedFile,
  StoredModuleVersion,
  CommitPage,
  CommitPatch,
  HistoricalCommit,
} from "./history/types";
import type { JsonValuesEntry } from "./patch/ts/jsonValuesModule";
import type { TypeScriptKit } from "./patch/ts/loadTypeScriptKit";
import {
  classifyJsonValuesOp,
  expandJsonValuesRootOp,
  findNestedJsonValuesRecords,
  getNewJsonEntryPaths,
  isJsonValuesRootOp,
  rebaseContentOp,
  resolveExistingJsonPath,
  type CurrentJsonEntries,
} from "./patch/jsonValuesPatch";
import { validateJsonValuesEntries } from "./validateJsonValues";
import {
  checkRemoteFiles,
  type RemoteFilesCheck,
  type RemoteNetwork,
} from "./remoteFileCheck";
import type { ValSyntaxError, ValSyntaxErrorTree } from "./patch/ts/syntax";
import sizeOf from "image-size";
import { base64ToBytes, bytesToBase64 } from "./bytes";
import { ParentPatchId } from "@valbuild/core";
import {
  ValCommit,
  ValDeployment,
  resolveSchemaSourceFixForError,
  isSchemaSourceFixError,
  type SchemaSourceSnapshot,
  ChainFold,
  EMPTY_CHAIN,
  applyPatchRecord,
  baseModuleContent,
  type ModuleContent,
  baseVersionOf,
  sameModuleVersion,
  schemaVersionOf,
  type ModuleVersion,
  type ProjectVersion,
} from "@valbuild/shared/internal";
import type { SketchpadStore } from "./sketchpads/SketchpadStore";
import { draftOverlay } from "./draftOverlay";
import { ValHead, recordKeysOf } from "./head";

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
/**
 * How many `.jsonValues()` entry files a whole-record write reads at a time.
 *
 * Reading them is a network round trip per entry in `ValOpsHttp`, and a commit
 * cannot start until they are in. One at a time is too slow for the records
 * this is for; all at once is a burst of hundreds of requests at the content
 * host.
 */
const JSON_ENTRY_READ_CONCURRENCY = 8;
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
  /**
   * Source that replaces what the modules evaluate to, for the modules it
   * names: a proposal's saves (`ValProposal` in `./proposal`), the third
   * source provider beside committed and draft. Applied once, as the modules
   * are first read, so every read after it -- the tree, validation, previews,
   * the next save's prepare -- starts from it, and the SHAs describe it.
   */
  snapshotSources?: Sources;
  /**
   * Source the SITE serves over what the modules evaluate to, beneath
   * {@link snapshotSources}: a content version (`ValContentVersion` in
   * `./proposal`), the content published since the build. Applied the same
   * way, and what a proposal's saves are compared against
   * ({@link ValOps.siteSourcesUnderSnapshot}) -- the site, not the bundle.
   */
  siteSnapshotSources?: Sources;
  /**
   * The `.jsonValues()` entries the same snapshot saved, by module and key:
   * their content is in their own files, not in {@link snapshotSources}, which
   * holds markers. The baseline those entries are read from, as a save in
   * this instance would leave them (`proposalJsonEntries` in `./proposal`).
   */
  snapshotJsonEntries?: Map<ModuleFilePath, Map<string, JSONValue>>;
  /**
   * At a proposal's address: the modules whose staged code this build was
   * NOT made of (`stagedAfterBuild` in `./proposal`), each with its schema
   * version `staged:<inputs>`. This server has not got their schema, so:
   *
   * - their Source is read from their staged text ({@link readSources}),
   *   over the snapshot, not taken from what the build evaluated;
   * - their version is the staging's, on every answer, so a reader whose code
   *   is this build never reads them for its own (`layered`'s schema rule);
   * - a save applies to that text and that Source with no schema, and says
   *   so per module (`moduleVersions[path].staged`);
   * - one whose Source cannot be read from its text is HELD: a save that
   *   touches it is refused, saying why (`heldStaged`, read by `prepare`).
   */
  stagedAfterBuild?: {
    versions: Record<ModuleFilePath, string>;
    /**
     * The Source each staged module file declares, read without running it
     * (`stagedModuleSources`): one it cannot read is left out.
     */
    readSources: () => Promise<Record<string, JSONValue>>;
  };
  /**
   * The TypeScript compiler, for {@link ValOps.prepare}: a publish rewrites
   * each `.val.ts` it touches as text. `loadTypeScriptKit` on Node.
   *
   * Passed in rather than imported, because this class runs in a browser tab
   * and in a Worker too, where the compiler would be 10.8 MB of a 12.9 MB
   * bundle that never publishes (see `publishKit.ts`). `ValOpsFS` and
   * `ValOpsHttp` only run on Node and load it themselves; `ValOpsMemory` has
   * it when its host passes it (`createValOps` does), and refuses to publish
   * without it.
   */
  typescript?: () => Promise<TypeScriptKit>;
};
/**
 * What a save told this instance a `.jsonValues()` entry holds: its content --
 * JSON `null` included -- or that it was deleted. See `adoptedJsonEntries`.
 */
type AdoptedJsonEntry =
  | { kind: "content"; content: JSONValue }
  | { kind: "deleted" };

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
   * The SITE's Source for the modules a proposal's snapshot replaced: what the
   * bundle evaluated to before the snapshot went over it. Kept for
   * {@link siteSourcesUnderSnapshot}, and only where there is a snapshot.
   */
  private siteSourcesBeforeSnapshot: Sources | null = null;
  /**
   * The same modules as the bundle evaluated them, imports and all: where a
   * `.jsonValues()` entry the snapshot did not save is read from. Not
   * {@link siteSourcesBeforeSnapshot}, whose markers may have come as JSON
   * from a content version, with no import behind them.
   */
  private bundleSourcesBeforeSnapshot: Sources | null = null;
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
   * `deleted` for an entry the commit deleted: tagged, not `null`, because an
   * entry's content may itself be JSON `null` (a nullable item), and a saved
   * `null` read back as "deleted" would report the entry missing.
   *
   * Never cleared: it describes what is on disk. A host rebuild makes a new
   * instance, which is the right reset. Bounded by the project's entry count,
   * holding only the latest content per key.
   */
  private adoptedJsonEntries = new Map<
    ModuleFilePath,
    Map<string, AdoptedJsonEntry>
  >();

  /**
   * Each module's `schema` and `base` version: hashed when the modules are
   * evaluated and when a base is adopted (a snapshot, a publish), never when
   * they are read. See `ModuleVersion` in `@valbuild/shared/internal`.
   */
  private baseVersions: Map<
    ModuleFilePath,
    Pick<ModuleVersion, "schema" | "base">
  > | null = null;
  /**
   * The build this instance serves, as {@link ProjectVersion.build} names it:
   * the fold of what the modules evaluated to, frozen at evaluation (a publish
   * moves the base, not the build), unless the host names its build.
   */
  private buildVersion: string | null = null;
  /** Every module's `chain`, folded as the chain grows. See `ChainFold`. */
  private readonly chainFold = new ChainFold();
  /**
   * The modules staged after the build whose Source could not be read from
   * their staged text, with why: a save that touches one is refused. See
   * {@link ValOpsOptions.stagedAfterBuild}.
   */
  private heldStaged: Map<ModuleFilePath, string> = new Map();
  /**
   * What the BUILD evaluated each module to, and its version: before a
   * snapshot, a staging or a publish put anything over it. What a reader's
   * own bundle holds, so where the head's version is this one a draft reader
   * reads its bundle and the head reads nothing (`ValHead.draft`).
   */
  private bundleSources: Sources | null = null;
  private bundleVersions: Map<
    ModuleFilePath,
    Pick<ModuleVersion, "schema" | "base">
  > | null = null;

  /**
   * The head: the content at the newest chain, kept in a store of modules by
   * version, which every reader in the process reads through. See
   * `head.ts`.
   */
  readonly head: ValHead = new ValHead(this);

  /**
   * Take a formatter for saves, when this instance was built without one.
   *
   * One instance serves every Val server in a process (`valRuntime`), and
   * the readers that build it first never save, so they pass no formatter;
   * the API route that saves does. An instance that already has one keeps it.
   */
  adoptFormatter(formatter: NonNullable<ValOpsOptions["formatter"]>): void {
    if (this.options !== undefined && this.options.formatter === undefined) {
      this.options.formatter = formatter;
    }
  }

  /**
   * The TypeScript compiler, loading, or `null` where this server has none.
   * See {@link ValOpsOptions.typescript}; the Node-only data layers override
   * this to load it themselves.
   */
  protected loadTypeScriptKit(): Promise<TypeScriptKit> | null {
    return this.options?.typescript?.() ?? null;
  }

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
    for (const [moduleFilePath, entries] of options?.snapshotJsonEntries ??
      []) {
      const adopted = new Map<string, AdoptedJsonEntry>();
      for (const [entryKey, content] of entries) {
        adopted.set(entryKey, { kind: "content", content });
      }
      this.adoptedJsonEntries.set(moduleFilePath, adopted);
    }
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
        /**
         * The store's own `seq` (fs, memory), read before the patches it
         * answers with. See `ProjectVersion` and {@link projectVersion}.
         */
        seq?: number;
      }
    | {
        type: "use-websocket";
        url: string;
        nonce: string;
        baseSha: BaseSha;
        schemaSha: SchemaSha;
        /** Absent for a project with no repository. See `git` on ValApiOptions. */
        commitSha?: CommitSha;
        sourcesSha: SourcesSha;
        patches: PatchId[];
        /**
         * The head of the chain, when the store reports one. See
         * {@link OrderedPatches.headPatchId}.
         */
        headPatchId?: PatchId | null;
        /** The chain version of that head. See {@link OrderedPatches.headVersion}. */
        headVersion?: number;
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
      /*
       * Read before anything below is assigned: from the first assignment to
       * the promotion this must not yield, or a concurrent read finds the
       * fields set and returns the bundle's Source as though it were the
       * snapshot's.
       */
      const staged = await this.readStagedSources(extracted.sources);
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
      // The host's name for its build, where it has one, with the fold of
      // what this build evaluated to: two builds of one commit can differ.
      const hostBuild = this.hostBuild();
      this.buildVersion =
        hostBuild !== null
          ? `${hostBuild}.${extracted.baseSha}`
          : extracted.baseSha;
      this.baseVersions = new Map(
        extracted.shaEntries.map((entry) => [
          entry.path,
          {
            schema: schemaVersionOf(entry.serializedSchema),
            base: baseVersionOf(entry.source),
          },
        ]),
      );
      this.bundleSources = extracted.sources;
      this.bundleVersions = new Map(this.baseVersions);
      /*
       * The snapshot, over what the modules evaluated to. Through the same
       * door a save uses, so the SHAs move with it: they describe the Source
       * being served, and a base SHA that still described the bundle would
       * say the snapshot's content was the bundle's.
       */
      const siteLayer = this.options?.siteSnapshotSources;
      const snapshotLayer =
        staged === null
          ? this.options?.snapshotSources
          : { ...this.options?.snapshotSources, ...staged.sources };
      this.heldStaged = staged?.held ?? new Map();
      /*
       * The bundle's own Source for every module either layer replaces: a
       * replaced `.jsonValues()` module's markers came as JSON, and an entry
       * neither layer saved is read through the bundle's marker, which still
       * has its `import()`.
       */
      if (siteLayer || snapshotLayer) {
        const bundle: Sources = {};
        for (const moduleFilePath of Object.keys({
          ...siteLayer,
          ...snapshotLayer,
        })) {
          const path = moduleFilePath as ModuleFilePath;
          const bundled = extracted.sources[path];
          if (bundled !== undefined) {
            bundle[path] = bundled;
          }
        }
        this.bundleSourcesBeforeSnapshot = bundle;
      }
      // What a proposal is compared against: the site, only where there is a proposal.
      if (snapshotLayer) {
        const site: Sources = {};
        for (const moduleFilePath of Object.keys(snapshotLayer)) {
          const path = moduleFilePath as ModuleFilePath;
          const source = siteLayer?.[path] ?? extracted.sources[path];
          if (source !== undefined) {
            site[path] = source;
          }
        }
        this.siteSourcesBeforeSnapshot = site;
      }
      /*
       * A module staged after the build is versioned as its staging: this
       * build's schema is not the one its Source fits. Before the promotion,
       * which keeps each module's schema version as it finds it.
       */
      for (const [path, version] of Object.entries(
        this.options?.stagedAfterBuild?.versions ?? {},
      )) {
        const moduleFilePath = path as ModuleFilePath;
        const known = this.baseVersions.get(moduleFilePath);
        if (known !== undefined) {
          this.baseVersions.set(moduleFilePath, { ...known, schema: version });
        }
      }
      if (siteLayer || snapshotLayer) {
        this.promoteCommittedSources({ ...siteLayer, ...snapshotLayer });
      }
      return {
        baseSha: this.baseSha,
        schemaSha: this.schemaSha,
        sourcesSha: this.sourcesSha,
        configSha: this.configSha,
        sources: this.sources,
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
   * Each module staged after the build, read from its staged text (see
   * {@link ValOpsOptions.stagedAfterBuild}), to lay over the snapshot; `null`
   * when there is none. A module whose text says nothing this can read -- a
   * Source built by code, a `.jsonValues()` record, whose entries a save
   * routes through a schema this server has not got -- is held, and keeps
   * what it had: its version says it is not this build's either way.
   */
  private async readStagedSources(
    bundled: Sources,
  ): Promise<{ sources: Sources; held: Map<ModuleFilePath, string> } | null> {
    const staged = this.options?.stagedAfterBuild;
    if (staged === undefined) return null;
    const paths = Object.keys(staged.versions) as ModuleFilePath[];
    if (paths.length === 0) return null;
    let read: Record<string, JSONValue> = {};
    try {
      read = await staged.readSources();
    } catch (err) {
      Internal.log.error("could not read the staged modules' Source", err);
    }
    const sources: Sources = {};
    const held = new Map<ModuleFilePath, string>();
    for (const path of paths) {
      const source = read[path];
      if (bundled[path] === undefined) {
        // Not in this build at all: nothing here serves it, or saves it.
        continue;
      }
      if (source === undefined) {
        held.set(
          path,
          `its staged code is not in the build serving this proposal, and its content is not written out in its .val.ts (it is made by code), so it can only be saved once the proposal is built. Build the proposal, then save.`,
        );
        continue;
      }
      if (holdsJsonEntryMarkers(source)) {
        held.set(
          path,
          `its staged code is not in the build serving this proposal, and its .jsonValues() entries are saved through a schema only a build has. Build the proposal, then save.`,
        );
        continue;
      }
      sources[path] = source;
    }
    return { sources, held };
  }

  /**
   * In a proposal: the SITE's Source for every module the proposal has saved,
   * as the build it is based on evaluated it -- what the proposal is compared
   * against, and what merging it changes. Every other module is the same in
   * both, so it is not sent. `null` anywhere that is not a proposal.
   */
  async siteSourcesUnderSnapshot(): Promise<Sources | null> {
    if (!this.options?.snapshotSources) return null;
    await this.initSources();
    return this.siteSourcesBeforeSnapshot;
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
    preparedCommit: Pick<
      PreparedCommit,
      "patchedJsonEntries" | "patchedSourceFiles"
    >,
  ): Promise<void> {
    // Read BEFORE anything is promoted: this applies the chain to the sources as
    // they stand, and promoting first would apply the same patches twice.
    const { sources, errors } = await this.getSources(analysis);
    const adopt: Sources = {};
    for (const [moduleFilePathS, source] of Object.entries(sources)) {
      const moduleFilePath = moduleFilePathS as ModuleFilePath;
      if (errors[moduleFilePath] !== undefined) {
        Internal.log.error(
          "not adopting the committed source of a module whose patches " +
            "did not apply cleanly. Its content here stays as it was until the " +
            "modules are re-evaluated.",
          { moduleFilePath, errors: errors[moduleFilePath] },
        );
        continue;
      }
      adopt[moduleFilePath] = source;
    }
    markPublishedJsonEntries(
      adopt,
      analysis,
      preparedCommit.patchedJsonEntries,
    );
    this.promoteCommittedSources(adopt);
    /**
     * And the `.val.ts` TEXT, for a store that has nowhere else to keep it.
     *
     * Everything above adopts the SOURCE — the data a module evaluates to. The
     * file the patch was applied TO is a separate thing, and `getSourceFile` is
     * what the next `prepare()` reads. In `fs` mode that is the disk, which
     * `saveOrUploadFiles` has just rewritten, so this is a no-op. A store with
     * no disk has to be told, or every later save re-reads the source as it was
     * when the process started and silently reverts this one.
     */
    this.adoptPatchedSourceFiles(preparedCommit.patchedSourceFiles);
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
        new Map<string, AdoptedJsonEntry>();
      for (const [entryKey, content] of Object.entries(entries)) {
        // A commit's `null` is a deleted entry: see `patchedJsonEntries`.
        adopted.set(
          entryKey,
          content === null ? { kind: "deleted" } : { kind: "content", content },
        );
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
   * studio already knows how to read: `PatchStore.settleVanished` uses a
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
    // The base versions move with them, for the adopted modules only.
    if (this.baseVersions !== null) {
      this.baseVersions = new Map(this.baseVersions);
      for (const [moduleFilePath, source] of adopt) {
        const known = this.baseVersions.get(moduleFilePath);
        if (known !== undefined) {
          this.baseVersions.set(moduleFilePath, {
            schema: known.schema,
            base: baseVersionOf(source),
          });
        }
      }
    }
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

  // #region versions
  /**
   * Every module's version, for the patches a draft applies (in chain order:
   * `draftOverlay`'s), or with the empty chain when `applied` is false -- an
   * answer whose source has no patches applied (`apply_patches=false`).
   *
   * Nothing here hashes on a read: `schema` and `base` were hashed when the
   * modules were evaluated or a base adopted, and the chains are extended
   * only by the patches they gained since the last call (`ChainFold`).
   */
  async moduleVersions(
    patches: readonly { patchId: PatchId; path: ModuleFilePath }[],
    applied: boolean = true,
    /**
     * For a module whose chain stopped at a patch that does not apply, how
     * many of its patches the answer's content is AT (`getSources`'s
     * `stopped`): its version names that chain, not the whole one.
     */
    stopped?: Readonly<Record<ModuleFilePath, number>>,
  ): Promise<Record<ModuleFilePath, ModuleVersion>> {
    await this.initSources();
    const versions: Record<ModuleFilePath, ModuleVersion> = {};
    const chains = applied ? this.chainFold.chainsOf(patches) : null;
    for (const [moduleFilePath, version] of this.baseVersions ?? []) {
      const stoppedAt = stopped?.[moduleFilePath];
      versions[moduleFilePath] = {
        schema: version.schema,
        base: version.base,
        chain:
          chains === null
            ? EMPTY_CHAIN
            : stoppedAt !== undefined
              ? this.chainFold.chainAt(moduleFilePath, stoppedAt)
              : (chains.get(moduleFilePath) ?? EMPTY_CHAIN),
      };
    }
    return versions;
  }

  /** One module's version: {@link moduleVersions}, for one path. */
  async moduleVersion(
    moduleFilePath: ModuleFilePath,
    patches: readonly { patchId: PatchId; path: ModuleFilePath }[],
    applied: boolean = true,
    /** See `stopped` on {@link moduleVersions}: this module's count. */
    stoppedAt?: number,
  ): Promise<ModuleVersion | undefined> {
    await this.initSources();
    const version = this.baseVersions?.get(moduleFilePath);
    if (version === undefined) return undefined;
    let chain: string = EMPTY_CHAIN;
    if (applied) {
      const chains = this.chainFold.chainsOf(patches);
      chain =
        stoppedAt !== undefined
          ? this.chainFold.chainAt(moduleFilePath, stoppedAt)
          : (chains.get(moduleFilePath) ?? EMPTY_CHAIN);
    }
    return { schema: version.schema, base: version.base, chain };
  }

  /**
   * The project version an answer is relative to. `headVersion` is the
   * content service's, for a store that keeps no counter of its own (http);
   * fs and memory count their own writes ({@link ownSeq}).
   */
  async projectVersion(headVersion?: number): Promise<ProjectVersion> {
    await this.initSources();
    const build = this.buildVersion ?? "";
    const own = await this.ownSeq(build);
    return { build, seq: own ?? headVersion ?? 0 };
  }

  /**
   * The last few manifests this instance answered, by ETag: what a
   * "since `seq` N" read is a delta from (`GET /manifest?since=N`). A few,
   * not one: two Studios polling a project hold different ones. In this
   * instance only -- a manifest another process answered is not here, and
   * is answered whole.
   */
  private answeredManifests: {
    etag: string;
    project: ProjectVersion;
    modules: Record<ModuleFilePath, ModuleVersion>;
  }[] = [];

  /** Keep a manifest this instance answered. See {@link manifestSince}. */
  rememberManifest(
    etag: string,
    project: ProjectVersion,
    modules: Record<ModuleFilePath, ModuleVersion>,
  ): void {
    if (this.answeredManifests.some((held) => held.etag === etag)) return;
    this.answeredManifests.push({ etag, project, modules });
    if (this.answeredManifests.length > ValOps.ANSWERED_MANIFESTS) {
      this.answeredManifests.shift();
    }
  }

  private static readonly ANSWERED_MANIFESTS = 4;

  /**
   * The modules of `modules` whose version moved since the manifest this
   * instance answered with `etag` at `since`, or `null` when that one is not
   * held (answered elsewhere, too long ago) or was another build's: then the
   * answer is the whole manifest. Three strings compared per module; nothing
   * hashed.
   */
  manifestSince(
    etag: string,
    since: number,
    project: ProjectVersion,
    modules: Record<ModuleFilePath, ModuleVersion>,
  ): Record<ModuleFilePath, ModuleVersion> | null {
    const held = this.answeredManifests.find((m) => m.etag === etag);
    if (
      held === undefined ||
      held.project.seq !== since ||
      held.project.build !== project.build
    ) {
      return null;
    }
    const moved: Record<ModuleFilePath, ModuleVersion> = {};
    for (const [path, version] of Object.entries(modules) as [
      ModuleFilePath,
      ModuleVersion,
    ][]) {
      const before = held.modules[path];
      if (before === undefined || !sameModuleVersion(before, version)) {
        moved[path] = version;
      }
    }
    // One build's modules are one set: a module cannot leave without a new
    // build, which is answered whole.
    return moved;
  }

  /**
   * A cheap identity for "the manifest has not moved": the build, the base
   * fold, the seq and the chain fold's epoch. Concatenated, never hashed.
   */
  async manifestTag(project: ProjectVersion): Promise<string> {
    const { baseSha } = await this.initSources();
    return `"${project.build.slice(0, 16)}.${baseSha.slice(0, 16)}.${project.seq}.${this.chainFold.epoch()}"`;
  }

  /**
   * The `sourcesSha` of the base this store's chain is relative to: what a
   * `/stat` answer names. Read by a Studio of the release before, which put
   * the chain on that base (`BaseAlignment`), and compared by the fs and
   * memory long poll with what a Studio echoes; this release's Studio takes
   * each module's base from the manifest instead. Goes with `/stat`'s
   * `sourcesSha` (see "Release-delayed deletions" in
   * `docs/plans/one-content-model.md`).
   *
   * This instance's own, unless the store keeps one chain for every build
   * and a newer build of the project has been made since this one, in this
   * process (fs and memory: the patches are the store's, and they are
   * relative to what the NEWEST build evaluated -- the files on disk, the
   * modules hot reload brought). An instance still answering then (a long
   * poll parked on it before the reload, a request routed to the previous
   * build) would otherwise name its own, older base, and the Studio would
   * fetch it and show the content from before the code change (S26,
   * `scenarios/src/overlayAfterBuild.scenario.test.ts`). In http mode the
   * content service answers each build with the patches THAT build does not
   * contain, so its own base is the right one for that chain -- and when a
   * newer build is live, only the content service knows, so `/stat` there
   * asks it for the chain relative to the live build and names that build's
   * base (`ValOpsHttp.getStat`, `OrderedPatchesMetadata.chainBase`).
   *
   * Newest by when the instance was MADE, not by when it first answered:
   * hot reload makes the new one after the old, and an old one first asked
   * after the new one is still the old one.
   */
  async chainBaseSha(): Promise<SourcesSha> {
    return this.getSourcesSha();
  }

  /**
   * The data layer whose head answers what each module IS for this store's
   * chain (`GET /manifest`, `GET /modules`): this one, unless the store keeps
   * one chain for every build and a newer build was made since, in this
   * process (fs and memory; see {@link chainBaseSha}). An instance still
   * answering then -- a long poll parked on it across a hot reload, a request
   * routed to the previous build -- would name its own, older bases, and a
   * Studio reading them would show the content from before the code change
   * (S26).
   */
  newestOps(): ValOps {
    return this;
  }

  /**
   * The host's own name for the build it runs, when it has one (a platform's
   * build, a commit). `null`: the fold of what the modules evaluated to.
   */
  protected hostBuild(): string | null {
    return null;
  }

  /**
   * Where the code of the build this store runs in can be imported from,
   * by a Studio opened on another build (`registry` on `GET /manifest`):
   * only a build the platform made and names has an entry of its own
   * (`valModulesEntryPath`). `null` everywhere else -- local development,
   * where HMR brings the code, and a deploy the platform did not build.
   */
  buildRegistry(): BuildRegistry | null {
    return null;
  }

  /**
   * This store's own `seq`, or `null` for a store whose changes are counted
   * by someone else (the content service's `headVersion`). Given the build,
   * because a new build bumps it once.
   */
  protected async ownSeq(_build: string): Promise<number | null> {
    return null;
  }

  async getBaseSources(): Promise<Sources> {
    return this.initSources().then((result) => result.sources);
  }

  /**
   * A module as the BUILD evaluated it, with its version (the empty chain):
   * what a reader's own bundle holds. `null` for a module the build has not
   * got. See {@link bundleSources}.
   */
  async bundleModule(
    moduleFilePath: ModuleFilePath,
  ): Promise<{ version: ModuleVersion; source: Json } | null> {
    await this.initSources();
    const version = this.bundleVersions?.get(moduleFilePath);
    const source = this.bundleSources?.[moduleFilePath];
    if (version === undefined || source === undefined) return null;
    return { version: { ...version, chain: EMPTY_CHAIN }, source };
  }

  /**
   * A module's BASE as this build serves it -- the bundle's, or what a
   * content version, a proposal's saves or a publish put in its place --
   * with its version (the empty chain). `null` for no such module.
   */
  async baseModule(
    moduleFilePath: ModuleFilePath,
  ): Promise<{ version: ModuleVersion; source: Json } | null> {
    const { sources } = await this.initSources();
    const version = this.baseVersions?.get(moduleFilePath);
    const source = sources[moduleFilePath];
    if (version === undefined || source === undefined) return null;
    return { version: { ...version, chain: EMPTY_CHAIN }, source };
  }

  /**
   * "Has the chain moved?", cheaply: the store's `seq` (fs, memory), or
   * the content service's chain version (http). `null` when the store
   * cannot say without reading the chain; the head then reads it each time.
   */
  async chainSeq(): Promise<number | null> {
    await this.initSources();
    return this.ownSeq(this.buildVersion ?? "");
  }

  /**
   * {@link chainSeq}, with what it counts from: two positions are the same
   * only when both are. A counter that can start again (fs: `.val` removed
   * by hand) names its start in `epoch`, so coming back to the same number
   * is not read as "nothing moved". `null` as for {@link chainSeq}.
   */
  async chainPosition(): Promise<{ seq: number; epoch: string } | null> {
    const seq = await this.chainSeq();
    return seq === null ? null : { seq, epoch: "" };
  }

  /**
   * A module's chain after its first `count` patches, of the chain the
   * versions were last computed for. Hashes nothing. See `ChainFold.chainAt`.
   */
  chainAt(moduleFilePath: ModuleFilePath, count: number): string {
    return this.chainFold.chainAt(moduleFilePath, count);
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
    /** Passed straight through — see {@link getJsonEntries}. */
    opts?: { applyPatches?: boolean; withVersion?: boolean },
  ): Promise<
    | {
        status: "success";
        content: ReadonlyJSONValue | null;
        version?: ModuleVersion;
      }
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
      return {
        status: "success",
        content: entry.content,
        ...(res.version !== undefined ? { version: res.version } : {}),
      };
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
    opts?: {
      applyPatches?: boolean;
      /** Answer the record module's version too (`/json` does). */
      withVersion?: boolean;
    },
  ): Promise<
    | {
        status: "success";
        entries: { key: string; content: ReadonlyJSONValue | null }[];
        missing: string[];
        errors: { key: string; message: string }[];
        total: number;
        offset?: number;
        limit?: number;
        /** See `version` on `/json`. */
        version?: ModuleVersion;
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
    if (applyPatches && "keys" in selector) {
      /*
       * Through the head: the record module at the newest chain, made once
       * per version, and each entry resolved once on it -- an entry the
       * chain touched is content, deleted or an error; one it edited
       * without anybody having loaded it is its held edits on the base
       * entry.
       */
      const res = await this.head.entries(moduleFilePath, selector.keys);
      if (res.status !== "success") return res;
      return {
        status: "success",
        entries: res.value.entries,
        missing: res.value.missing,
        errors: res.value.errors,
        total: res.value.total,
        ...(opts?.withVersion === true ? { version: res.value.version } : {}),
      };
    }
    const { sources } = await this.initSources();
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
    // Walked once per record, not per request: see `recordKeysOf`.
    const allKeys = recordKeysOf(record);
    const requestedKeys = isWindow
      ? allKeys.slice(selector.offset, selector.offset + selector.limit)
      : selector.keys;
    /** The record module's version: its base, with no chain applied. */
    const version = await this.moduleVersion(moduleFilePath, [], false);
    const entries: { key: string; content: ReadonlyJSONValue | null }[] = [];
    const missing: string[] = [];
    const errors: { key: string; message: string }[] = [];
    const loaded = await Promise.all(
      requestedKeys.map(
        async (entryKey) =>
          [
            entryKey,
            await this.baseJsonEntry(moduleFilePath, record, entryKey),
          ] as const,
      ),
    );
    for (const [entryKey, base] of loaded) {
      if ("message" in base) {
        errors.push({ key: entryKey, message: base.message });
      } else if (base.content === undefined) {
        missing.push(entryKey);
      } else {
        entries.push({ key: entryKey, content: base.content });
      }
    }
    return {
      status: "success",
      entries,
      missing,
      errors,
      total: allKeys.length,
      ...(isWindow ? { offset: selector.offset, limit: selector.limit } : {}),
      ...(opts?.withVersion === true && version !== undefined
        ? { version }
        : {}),
    };
  }
  /**
   * One `.jsonValues()` entry's BASE content: what the chain starts from.
   * `undefined` for a key the base record does not have; `null` for a marker
   * with nothing behind it.
   */
  async baseJsonEntry(
    moduleFilePath: ModuleFilePath,
    record: Record<string, unknown>,
    entryKey: string,
  ): Promise<{ content: JSONValue | undefined } | { message: string }> {
    const marker = record[entryKey];
    if (marker === undefined) {
      return { content: undefined };
    }
    if (!Internal.isJson(marker)) {
      return { content: marker as JSONValue };
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
     * `deleted` means the commit deleted the entry, which is reported the same
     * way an absent key is. (Nearly unreachable — a `remove` also drops the
     * thunk from the `.val.ts`, so the key is gone from `record` once the
     * source is adopted — but the map says it, so this says it too.)
     *
     * The BASELINE only. Pending patches apply over it exactly as they do
     * over the thunk's answer.
     */
    const adopted = this.adoptedJsonEntries.get(moduleFilePath)?.get(entryKey);
    if (adopted !== undefined) {
      return {
        content: adopted.kind === "deleted" ? undefined : adopted.content,
      };
    }
    /*
     * A snapshot's marker came as JSON, with no import behind it: the
     * entry the proposal did not save is the build's, behind the marker
     * the module evaluated to.
     */
    const siteMarker =
      this.bundleSourcesBeforeSnapshot?.[moduleFilePath]?.[
        entryKey as keyof Sources[ModuleFilePath]
      ];
    const thunk =
      Internal.getJsonImport(marker) ??
      (Internal.isJson(siteMarker)
        ? Internal.getJsonImport(siteMarker)
        : undefined);
    if (!thunk) {
      return { content: null };
    }
    try {
      return { content: ((await thunk()).default ?? null) as JSONValue };
    } catch (e) {
      return {
        message: `Failed to load JSON entry '${entryKey}': ${
          e instanceof Error ? e.message : String(e)
        }`,
      };
    }
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

  // #region getSources
  /**
   * The modules' sources, with these patches applied -- ONLY the modules that
   * had patches (see {@link getSourcesWithPatchesApplied} for all of them).
   *
   * The patches are applied by THE engine (`applyPatchRecord` in
   * `@valbuild/shared`), copy-on-write, so an unpatched part of a module is
   * the same object as in the base. A module's chain stops at its first patch
   * that does not apply: that one is reported with `skipped: false`, every
   * later one with `skipped: true`, and `stopped` says how many of the
   * module's patches its source is AT, so its version can name that chain.
   */
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
    /**
     * For a module whose chain stopped at a patch that does not apply: how
     * many of its patches applied. Absent for a module whose patches all did.
     */
    stopped: Record<ModuleFilePath, number>;
  }> {
    const { sources, schemas } = await this.initSources();
    if (!analysis) {
      return { sources, errors: {}, stopped: {} };
    }
    const patchedSources: Sources = {};
    const errors: Record<
      ModuleFilePath,
      {
        patchId: PatchId;
        skipped: boolean;
        error: GenericErrorMessage;
      }[]
    > = {};
    const stopped: Record<ModuleFilePath, number> = {};
    /** Each patched module as far along its chain as it has got. */
    const modules = new Map<
      ModuleFilePath,
      { content: ModuleContent; applied: number }
    >();
    // Serialized schemas, resolved lazily and only for modules that actually
    // have patches: they say which ops reach into a `.jsonValues()` entry.
    const serializedSchemaCache = new Map<
      ModuleFilePath,
      SerializedSchema | undefined
    >();
    const serializedSchemaFor = (
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
      const base = sources[path];
      if (base === undefined) {
        if (!errors[path]) {
          errors[path] = [];
        }
        Internal.log.error("Module not found", path);
        errors[path].push({
          patchId: patchData.patchId,
          skipped: true,
          error: new PatchError(`Module not found`),
        });
        continue;
      }
      let module = modules.get(path);
      if (module === undefined) {
        module = {
          content: baseModuleContent(base as ReadonlyJSONValue),
          applied: 0,
        };
        modules.set(path, module);
        patchedSources[path] = base;
      }
      const patchId = patchData.patchId;
      if (errors[path]) {
        errors[path].push({
          patchId: patchId,
          skipped: true,
          error: new PatchError(`Cannot apply patch: previous errors exists`),
        });
        continue;
      }
      const res = applyPatchRecord(
        module.content,
        patchData,
        serializedSchemaFor(path),
      );
      if (res.status === "failed") {
        Internal.log.error("Could not apply patch", {
          path,
          patchId,
          error: res.message,
        });
        errors[path] = [
          { patchId, skipped: false, error: new PatchError(res.message) },
        ];
        stopped[path] = module.applied;
        continue;
      }
      module.content = res.module;
      module.applied++;
      patchedSources[path] = res.module.source;
    }
    return { sources: patchedSources, errors, stopped };
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
      stopped: patched.stopped,
    };
  }

  // #region validateSources
  async validateSources(
    schemas: Schemas,
    sources: Sources,
    patchesByModule?: PatchAnalysis["patchesByModule"],
    /**
     * Validate only these modules. The snapshot the cross-module checks read
     * (a keyOf's keys, a route, a set's directory) is still built from every
     * module, which is what makes checking one module at a time give the same
     * answer for it as checking them all. Wins over `patchesByModule`.
     */
    onlyModules?: readonly ModuleFilePath[],
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
    // the marker fixes — a keyOf's key, a route, a locale tag, a record's
    // declared keys — against every module's data. See `SCHEMA_SOURCE_FIXES`.
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
        serialized.dir
      ) {
        const dir = serialized.dir;
        const existing = galleryDirectoryToModules.get(dir);
        if (existing) {
          existing.push(moduleFilePath);
        } else {
          galleryDirectoryToModules.set(dir, [moduleFilePath]);
        }
      }
    }
    const addModuleError = (
      path: ModuleFilePath,
      sourcePath: SourcePath,
      validationError: ValidationError,
    ) => {
      if (!errors[path]) {
        errors[path] = { validations: {} };
      }
      if (!errors[path].validations[sourcePath]) {
        errors[path].validations[sourcePath] = [];
      }
      errors[path].validations[sourcePath].push(validationError);
    };
    const modulePathsToValidate: readonly string[] | undefined =
      onlyModules ?? (patchesByModule && Object.keys(patchesByModule));
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
        for (const entryError of entryErrors) {
          // An entry's errors get the same project-wide resolution as every
          // other module's. Added raw, every keyOf and route in a
          // `.jsonValues()` record was reported as unresolved -- 240 of them in
          // `examples/next`'s kb.val.ts, none real.
          if (isSchemaSourceFixError(entryError)) {
            const resolved = resolveSchemaSourceFixForError(
              entryError,
              snapshot,
            );
            if (!resolved || resolved.status !== "remaining") {
              continue;
            }
            addModuleError(path, sourcePath, resolved.error);
            continue;
          }
          // "Not yet compared with its bytes" is a request, not an error, and
          // for an entry it cannot be answered here: `validateFiles` resolves a
          // file's schema through the module's source, which for a
          // `.jsonValues()` record holds markers rather than the entry. The
          // publish gate ignores it anyway (`partitionValidationErrors`).
          //
          // A remote file's "not yet checked against its host" is the same
          // request, for the same reason: `validateRemoteFiles` and its fix
          // resolve the path through the module's source too. Added as an
          // error, every remote image in an entry was a row on the Validate
          // page whose Fix could not find it.
          if (
            isOnlyFileCheckValidationError(entryError) ||
            isOnlyRemoteCheckValidationError(entryError)
          ) {
            continue;
          }
          addModuleError(path, sourcePath, entryError);
        }
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
            } else if (isSchemaSourceFixError(validationError)) {
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
              validationError.fixes?.includes("files:check-unique-folder") ||
              validationError.fixes?.includes("videos:check-unique-folder")
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
                  "dir" in validationError.value && validationError.value.dir;
                if (typeof directory !== "string") {
                  addError({
                    message: `Expected gallery validation error 'value' to have property 'dir' of type 'string'. Found: ${typeof directory}. ${TYPE_ERROR_MESSAGE}`,
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
              validationError.fixes?.includes("files:check-all-files") ||
              validationError.fixes?.includes("videos:check-all-files")
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

  /**
   * The remote values `validateSources` set aside, checked: is each ref
   * sound, and does its host serve it. See `checkRemoteFiles`.
   *
   * `fileLastUpdatedByPatchId` names the refs whose bytes are still in a
   * pending patch, which the host will not have until publish.
   */
  async validateRemoteFiles(
    schemas: Schemas,
    sources: Sources,
    remoteFiles: Record<SourcePath, MediaSource>,
    fileLastUpdatedByPatchId: PatchAnalysis["fileLastUpdatedByPatchId"] = {},
    network: RemoteNetwork = {},
  ): Promise<RemoteFilesCheck> {
    const sampleByHost = this.sourceMode() === "managed";
    // Only a managed project vouches for one published ref with another, so
    // only it needs to know which refs are published.
    const baseSources = sampleByHost
      ? (await this.getSources()).sources
      : undefined;
    const valueAt = (
      sourcePath: SourcePath,
      from: Sources,
    ): { source: unknown; schema: SerializedSchema } | undefined => {
      const [moduleFilePath, modulePath] =
        Internal.splitModuleFilePathAndModulePath(sourcePath);
      const schema = schemas[moduleFilePath];
      if (!schema || from[moduleFilePath] === undefined) {
        return undefined;
      }
      try {
        return Internal.resolvePath(
          modulePath,
          from[moduleFilePath],
          schema["executeSerialize"](),
        );
      } catch {
        return undefined;
      }
    };
    return checkRemoteFiles({
      remoteFiles,
      sampleByHost,
      ...network,
      schemaAt: (sourcePath) => valueAt(sourcePath, sources)?.schema,
      isPublished: (sourcePath, ref) => {
        if (!baseSources) {
          return false;
        }
        const published = valueAt(sourcePath, baseSources)?.source;
        return (
          typeof published === "object" &&
          published !== null &&
          "path" in published &&
          published.path === ref
        );
      },
      pendingBytes: this.pendingBytesOf(fileLastUpdatedByPatchId),
    });
  }

  /**
   * Is a remote file's bytes in a pending patch? `not-pending` when no patch
   * wrote it; `missing` when one did and its bytes are not there.
   */
  pendingBytesOf(
    fileLastUpdatedByPatchId: PatchAnalysis["fileLastUpdatedByPatchId"],
  ): (ref: string) => Promise<"present" | "missing" | "not-pending"> {
    return async (ref) => {
      const fromPatch = fileLastUpdatedByPatchId[ref];
      if (!fromPatch) {
        return "not-pending";
      }
      const bytes = await this.getBase64EncodedBinaryFileFromPatch(
        ref,
        fromPatch.patchId,
        fromPatch.remote,
      );
      return bytes === null ? "missing" : "present";
    };
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
            // Which file: "File not found" on its own names nothing, and the
            // row it is shown on is the field, not the file.
            message: `${e.message}: ${filePath}`,
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
    // The TypeScript compiler, loaded now rather than with the server: see
    // `publishKit.ts`.
    const loadTypeScript = this.loadTypeScriptKit();
    if (loadTypeScript === null) {
      throw new Error(
        "Cannot publish from this server: publishing rewrites .val.ts files, " +
          "which needs the TypeScript compiler, and this server was started " +
          "without it (a server in the browser has none). Publish from a Val " +
          "server on Node -- createValServer passes it -- or pass " +
          "`typescript: loadTypeScriptKit` when constructing ValOpsMemory.",
      );
    }
    const {
      tsOps,
      parseValFile,
      analyzeValModule,
      analyzeJsonValuesEntries,
      jsonValuesRecordKeys,
      insertValJsonEntry,
      removeValJsonEntry,
    } = await loadTypeScript;
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
    const stagedAfterBuild: Record<string, string | undefined> =
      this.options?.stagedAfterBuild?.versions ?? {};

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
      const errors: PatchSourceError[] = [];
      const held = this.heldStaged.get(path);
      if (held !== undefined) {
        errors.push({
          message: `${path} cannot be saved here: ${held}`,
          filePath: path,
        });
        return {
          path,
          errors,
          skippedPatches: patches.map((p) => p.patchId),
        };
      }
      const sourceFileRes = await this.getSourceFile(path);

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
      const originalSourceFile = parseValFile(sourceFile);
      let tsSourceFile = originalSourceFile;
      let tsChanged = false;
      let serializedSchema: SerializedSchema | undefined = undefined;
      try {
        /*
         * Not for a module staged after the build: this build's schema is of
         * other code. With none, every op is a `.val.ts` op -- which is what
         * a module whose Source could be read from its text is (one with
         * `.jsonValues()` entries is held, above).
         */
        serializedSchema = stagedAfterBuild[path]
          ? undefined
          : schemas[path]?.["executeSerialize"]();
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

      // Lazily analyzed entries of the ORIGINAL `.val.ts`: the
      // `c.json(() => import("..."))` thunks (import paths are authoritative
      // for existing/hand-placed files) and the record's whole key set, which
      // is what a write of the whole record is expanded against.
      let analyzed: {
        thunks: Map<string, JsonValuesEntry>;
        keys: string[];
      } | null = null;
      const analyzeEntries = (): result.Result<
        { thunks: Map<string, JsonValuesEntry>; keys: string[] },
        PatchSourceError
      > => {
        if (analyzed === null) {
          const analysis = analyzeValModule(originalSourceFile);
          if (result.isErr(analysis)) {
            return result.err(analysis.error);
          }
          analyzed = {
            thunks: analyzeJsonValuesEntries(analysis.value.source),
            keys: jsonValuesRecordKeys(analysis.value.source),
          };
        }
        return result.ok(analyzed);
      };
      const resolveEntryJsonPath = (
        entryKey: string,
      ): result.Result<string, PatchSourceError> => {
        const added = entryKeyToJsonPath.get(entryKey);
        if (added !== undefined) {
          return result.ok(added);
        }
        const analyzedRes = analyzeEntries();
        if (result.isErr(analyzedRes)) {
          return analyzedRes;
        }
        const entry = analyzedRes.value.thunks.get(entryKey);
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
      /**
       * Every entry the module has AS THINGS STAND, with its content.
       *
       * What {@link expandJsonValuesRootOp} expands a write of the whole record
       * against. The keys come from the `.val.ts` the commit started from plus
       * what this commit has already added or removed; the content comes from
       * each entry's file, so an entry the write leaves as it is gets no op and
       * its file is not rewritten.
       *
       * Content is read WITHOUT going through `loadEntryContent`, whose cache is
       * also the write set: everything in it is written back at the flush, so
       * reading 200 entries to compare them would rewrite all 200. Unreadable
       * here means "content unknown", not an error - the expansion then emits a
       * `replace`, which is what a module with a broken entry file needs anyway.
       */
      const currentJsonEntries = async (): Promise<
        result.Result<CurrentJsonEntries, PatchSourceError>
      > => {
        const analyzedRes = analyzeEntries();
        if (result.isErr(analyzedRes)) {
          return analyzedRes;
        }
        const keys = new Set(analyzedRes.value.keys);
        for (const [entryKey, content] of jsonEntryContentsByKey) {
          if (content === null) {
            keys.delete(entryKey);
          } else {
            keys.add(entryKey);
          }
        }
        const readEntry = async (
          entryKey: string,
        ): Promise<JSONValue | undefined> => {
          const pending = jsonEntryContentsByKey.get(entryKey);
          if (pending !== undefined && pending !== null) {
            return pending;
          }
          const jsonPathRes = resolveEntryJsonPath(entryKey);
          if (result.isErr(jsonPathRes)) {
            return undefined;
          }
          const res = await this.getSourceFile(
            jsonPathRes.value as ModuleFilePath,
          );
          if (res.error) {
            return undefined;
          }
          try {
            const parsed: JSONValue = JSON.parse(res.data);
            return parsed;
          } catch {
            return undefined;
          }
        };
        /*
         * Read in batches rather than one after another: `getSourceFile` is a
         * network round trip in `ValOpsHttp`, so a record with hundreds of
         * entries would otherwise spend hundreds of them in series before the
         * commit could even start - long enough to time out. The keys are
         * walked in order and the results assembled in that order, so what the
         * expansion sees does not depend on which read finished first.
         */
        const entries = new Map<string, JSONValue | undefined>();
        const entryKeys = Array.from(keys);
        for (
          let i = 0;
          i < entryKeys.length;
          i += JSON_ENTRY_READ_CONCURRENCY
        ) {
          const batch = entryKeys.slice(i, i + JSON_ENTRY_READ_CONCURRENCY);
          const read = await Promise.all(batch.map(readEntry));
          for (let j = 0; j < batch.length; j++) {
            entries.set(batch[j], read[j]);
          }
        }
        return result.ok(entries);
      };
      const collectPatchError = (
        err: PatchError | ValSyntaxErrorTree,
        patchId: PatchId,
        op: unknown,
      ) => {
        Internal.log.error(
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
        for (const rawOp of sourceFileOps) {
          /**
           * A write of the WHOLE record fans out into per-entry ops first.
           *
           * The only op `classifyJsonValuesOp` cannot route, because it finds
           * the entry key by walking the op path and the root path has none. So
           * a patch author never has to know whether a record is
           * `.jsonValues()`: they write the module as if it were ordinary
           * source, and it arrives here as adds, replaces and removes that name
           * a key - the shapes everything below already handles. The read side
           * expands through the same function, so a draft cannot show something
           * other than what this writes.
           */
          let ops: Operation[] = [rawOp];
          if (serializedSchema && isJsonValuesRootOp(serializedSchema, rawOp)) {
            const currentRes = await currentJsonEntries();
            if (result.isErr(currentRes)) {
              errors.push(currentRes.error);
              patchHadError = true;
              break;
            }
            const expandedRes = expandJsonValuesRootOp(rawOp, currentRes.value);
            if (result.isErr(expandedRes)) {
              errors.push({
                message: expandedRes.error.message,
                filePath: path,
              });
              patchHadError = true;
              break;
            }
            ops = expandedRes.value;
          }
          for (const op of ops) {
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
            break;
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
    /*
     * Patching the FILE TEXT, for a store that has somewhere to put it.
     *
     * Where there is nowhere -- an http project with no repository -- the
     * patches are still all applied, because they are: `getSources(analysis)`
     * below applies them to Source, and that is what the commit records and
     * what every reader of this project sees. What is skipped is rendering
     * that data back out as `.val.ts` and `*.val.json`, which would be a
     * mirror with no repository to mirror into -- and which cannot even be
     * attempted, because producing it starts by READING the current text from
     * the repository that is not there.
     */
    const allResults: Awaited<ReturnType<typeof applySourceFilePatches>>[] =
      await Promise.all(
        Object.entries(patchesByModule).map(([path, patches]) =>
          this.mirrorsSourceFiles
            ? applySourceFilePatches(path as ModuleFilePath, patches)
            : Promise.resolve({
                path: path as ModuleFilePath,
                appliedPatches: patches.map((p) => p.patchId),
                result: null,
                extraFiles: {},
                jsonEntries: {},
              }),
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

    /*
     * What each changed module IS after this commit, and the schema it is under.
     *
     * The data rather than the file's text, because that is the half git cannot
     * give back: a `.val.ts` in git is code, and turning code back into data
     * means parsing it, which is best-effort and rots across TypeScript,
     * runtime and Val versions. The schema comes along because a value on its
     * own cannot be RENDERED - showing a module as it was at a commit whose
     * schema has since changed needs the schema of that commit, and nothing in
     * the current checkout has it.
     *
     * Taken from `getSources(analysis)` rather than re-derived here so the data
     * stored is the same data the Studio shows, produced by the one
     * implementation of "apply these ops".
     */
    const moduleVersions: PreparedCommit["moduleVersions"] = {};
    const { sources: sourcesAfter } = await this.getSources(patchAnalysis);
    for (const path of Object.keys(patchesByModule) as ModuleFilePath[]) {
      let serialized: SerializedSchema | undefined;
      try {
        serialized = schemas[path]?.["executeSerialize"]();
      } catch {
        // Same guard as above: one unserializable schema must not cost every
        // other module its history.
        serialized = undefined;
      }
      if (!serialized) {
        continue;
      }
      const source = sourcesAfter[path];
      moduleVersions[path] = {
        // `undefined` here means the module is gone, which is a state history
        // has to be able to show. `null` is how that travels over the wire.
        source: source === undefined ? null : (source as JSONValue),
        schema: serialized,
        // Its code is staged and not this build's: `schema` is of other code,
        // and content records the staging's instead.
        ...(stagedAfterBuild[path] !== undefined
          ? { staged: stagedAfterBuild[path] }
          : {}),
      };
    }

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
      moduleVersions,
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
  ): Promise<
    result.Result<
      {
        error?: undefined;
        patchId: PatchId;
        createdAt: string;
        /** See {@link SaveSourceFilePatchResult}. */
        headVersion?: number;
      },
      | { errorType: "other"; error: GenericErrorMessage }
      | { errorType: "patch-head-conflict" }
      | PlanRefusedError
    >
  > {
    const saveRes = await this.saveSourceFilePatch(
      path,
      patch,
      patchId,
      parentRef,
      authorId,
      sessionId,
    );
    if (result.isErr(saveRes)) {
      if (saveRes.error.errorType === "plan-refused") {
        // The project's plan, not a failure: the Studio keeps the edit and
        // sends it again later, so an error line here would be one a minute.
        return result.err(saveRes.error);
      }
      Internal.log.error(
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
      ...(saveRes.value.headVersion !== undefined
        ? { headVersion: saveRes.value.headVersion }
        : {}),
    });
  }

  /**
   * Why a publish cannot happen here, or `null` when one can.
   *
   * Named rather than thrown, and asked BEFORE the click: the Studio shows the
   * reason and disables the action, instead of letting someone write a commit
   * message and then meeting a failure from four layers down.
   *
   * `no-base` is the only code so far and means what it says: there is nowhere
   * for this publish's commit to be based. Note which way round that is --
   * a project whose content service is the store of record always HAS a base
   * (the service's own chain, which mints its own shas), so the refusal is not
   * about missing git. It is about a deployment that cannot do what its
   * project requires.
   */
  publishRefusal(): PublishRefusal | null {
    return null;
  }

  /**
   * How this project's SOURCE is kept, or `null` when it is nobody's question.
   *
   * `"managed"` -- the content service is the store of record, there is no
   * repository, and nothing outside the browser will ever pick a commit up.
   * `"connected"` -- commits are mirrored into a repository a host watches.
   *
   * `null` is the honest answer for `fs` and memory mode, where publishing is
   * writing to disk and there is no project to have a mode, and for an `http`
   * project whose content service predates the field. The Studio treats it as
   * "the story I have always told", which is the connected one -- the feed, and
   * a `building` state that something outside resolves. Guessing `managed`
   * instead would take the deploy feed away from every project running against
   * an older service.
   */
  sourceMode(): "managed" | "connected" | null {
    return null;
  }

  /**
   * Whether {@link getBinaryFile} can read a PUBLISHED file at all, so that
   * `null` from it means the file is gone rather than out of reach.
   *
   * Not in http mode without a repository -- a hosted project. Its published
   * binaries are kept in the patch store, and a template's files were never in
   * a patch: they are in the built site's `public/`, which the content service
   * never had. A check that read `null` there as "gone" reported every image
   * and video a template ships with, and offered to remove them.
   */
  canReadPublishedFiles(): boolean {
    return true;
  }

  /**
   * Does a press of Publish run as a publish job (valbuild/home,
   * docs/app-mode.md, "Publishing is a queued job")? Never for a project
   * with no content service.
   */
  publishesAsJobs(): boolean {
    return false;
  }

  /**
   * The branch the content service keeps this project's commits on, or `null`
   * where there is no such service, or it has not said yet.
   *
   * For the Studio's in-tab build of a managed project, which has to name the
   * branch its build was made at. Its other source is the `val.server.ts` the
   * last build was wired with -- and a project cloned from a template seed has
   * one wired at NO commit and no branch, so its first publish went out
   * branchless and the loader refused it for a project whose pointer follows a
   * branch. This is the project's own word for it.
   */
  projectBranch(): string | null {
    return null;
  }

  /**
   * Forward one call to the content service's publish API, as this project.
   *
   * The Studio builds a managed project in the tab and then has to publish what
   * it built -- but a browser cannot talk to content directly. It holds a
   * session cookie for THIS origin and no credential content would accept, so
   * the conversation goes through here, exactly as patches already do.
   *
   * Refused by default, and that is the honest answer rather than a gap: `fs`
   * and memory mode have no content service to forward to, and publishing there
   * is writing to disk.
   *
   * The path is content's, minus the `/v1` prefix -- `/publish`,
   * `/publish/{id}/artifacts`, `/build-target`. The ALLOW LIST lives in the
   * implementation rather than here, because it is what keeps this from being
   * a way to reach the rest of content with the project's credential.
   */
  async publishApi(
    _path: string,
    _init: {
      method: string;
      body?: string;
      /** A GET's `If-None-Match`, carried to content. */
      ifNoneMatch?: string;
    },
  ): Promise<{
    status: number;
    body: string;
    contentType: string;
    /** Content's `ETag`, when it named its answer. */
    etag?: string;
  }> {
    return {
      status: 501,
      contentType: "application/json",
      body: JSON.stringify({
        message:
          "This Val server has no content service to publish through. " +
          "Publishing from the browser is for a project whose content is " +
          "served over HTTP.",
      }),
    };
  }

  /**
   * The proposal this server runs at the address of, or `null` on the site --
   * and always in `fs` and memory mode, which have no proposals. See
   * `ValProposal`.
   */
  currentProposal(): { name: string; branch: string } | null {
    return null;
  }

  /**
   * The content service's proposals API, for the Studio's switcher, list and
   * dialogs. Refused here for the reason {@link publishApi} is: there is no
   * content service to forward to. `profileId` is the person asking.
   */
  async proposalsApi(
    _path: string,
    _init: { method: string; body?: string },
    _profileId: string | null,
  ): Promise<{ status: number; body: string; contentType: string }> {
    return {
      status: 501,
      contentType: "application/json",
      body: JSON.stringify({
        message:
          "This Val server has no content service, so it has no proposals.",
      }),
    };
  }

  /**
   * Whether a commit here produces `.val.ts` TEXT as well as data.
   *
   * True everywhere there is somewhere to put it: a working tree in `fs` mode,
   * a host holding its own source in memory mode, a git repository in `http`
   * mode. False for an `http` project whose content service is the store of
   * record and which has no repository attached -- see `git` on
   * {@link ValApiOptions}.
   *
   * WHAT IS NOT AFFECTED, and it is the part worth being sure of:
   * `moduleVersions` -- what each changed module IS after the commit, with its
   * schema -- comes from `getSources(analysis)`, which applies the ops to
   * Source in the stores. It does not go near the file text. So a commit with
   * no mirror still records everything history and a later `connect-github`
   * fold need; what it does not record is a rendering of that data as code.
   *
   * WHAT IS: the ops are no longer applied to the file text as well, so a
   * patch that would not fit the `.val.ts` is not reported here. That check
   * only ever existed for the text being produced, and there is none.
   */
  protected readonly mirrorsSourceFiles: boolean = true;

  /**
   * Take the `.val.ts` text a commit produced as the new committed source.
   *
   * A no-op where {@link getSourceFile} reads something the commit already
   * wrote — the disk in `fs` mode, the content service in `http` mode. Override
   * it in a store that holds the source itself. `null` means the commit deleted
   * the file.
   */
  protected adoptPatchedSourceFiles(
    _files: Record<string, string | null>,
  ): void {}

  // #region abstract ops
  /**
   * Whether the patches live HERE, in this server, or in Val's content service.
   *
   * Almost everything the routes branch on comes from this one fact, which is
   * why it is a named property rather than an `instanceof`. If this server owns
   * the store then there is no content service to authenticate to (so an absent
   * or unverifiable session is anonymous rather than a 401), no deployments to
   * report, and a
   * "publish" writes what the host does with it rather than pushing a commit. If
   * it does not, every one of those is the content service's and this server is
   * relaying.
   *
   * There were two implementations when the routes were written and `instanceof
   * ValOpsFS` meant this; a third made that reading wrong in a way that compiles
   * silently -- a store that is local, answers none of the checks, and gets the
   * http path with no content service behind it.
   *
   * It is also what `/stat` reports as `mode`. The wire name predates the third
   * implementation and names a class, but the question the client is asking is
   * this one: does it auto-save and hide the account panel, or does it publish.
   */
  abstract readonly patchesAreLocal: boolean;

  /**
   * Whether a request must carry a session this server verified.
   *
   * Split out of {@link patchesAreLocal}, which was answering two questions at
   * once. "Does this store auto-save or publish" is a BEHAVIOUR question, and
   * it is what `/stat` reports and the UI keys off. "May an unauthenticated
   * request write here" is a SECURITY question. With two implementations the
   * answers coincided -- fs is local dev where no credential exists, http is
   * remote -- so one flag served both and nothing noticed.
   *
   * A third implementation splits them. `ValOpsMemory`'s store is local, which
   * makes the first answer yes, and it is designed to run DEPLOYED, which makes
   * the second answer no. Reusing one flag gave a deployed host `getAuth`
   * returning anonymous success for a missing cookie, an invalid JWT, an
   * unparseable payload, or no configured secret -- on all 29 routes, including
   * the ones that create patches and publish.
   */
  abstract readonly requiresAuth: boolean;

  /**
   * Which implementation this is, for the routes that differ by mode.
   *
   * A tag rather than `instanceof`, because `instanceof ValOpsFS` needs the
   * class itself, and importing the class imports `fs`: `ValServer` asking
   * which mode it is in was what put the filesystem and the content-service
   * client in the module graph of a server that runs in a browser tab (the
   * demo, `@valbuild/server/browser`). `isFsOps` and friends in `opsKind.ts`
   * narrow on it with type-only imports.
   */
  abstract readonly kind: "fs" | "http" | "memory";

  /**
   * The project's sketchpads, kept wherever this mode keeps things: see
   * `sketchpads/SketchpadStore.ts`. Not patches, and never published.
   */
  abstract readonly sketchpads: SketchpadStore;

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
  ): Promise<SaveSourceFilePatchResult>;
  protected abstract getSourceFile(
    path: string,
  ): Promise<WithGenericError<{ data: string }>>;
  /**
   * Save a patch's binary file from a `data:...;base64,...` URL.
   *
   * The wire form: `FileReader.readAsDataURL` is what the browser produces, and
   * published `@valbuild/server` versions send it. Code that already HAS bytes
   * should call {@link saveBinaryFileFromPatch} instead of wrapping them in a
   * data URL just to have this unwrap them again.
   *
   * A `null` `data` records a DELETION, which is why this cannot simply be
   * replaced by the byte-taking sibling: there is nothing to hand it.
   */
  abstract saveBase64EncodedBinaryFileFromPatch(
    filePath: string,
    parentRef: ParentRef,
    patchId: PatchId,
    data: string | null,
    type: "file" | "image",
    metadata: MetadataOfType<"file" | "image"> | undefined,
  ): Promise<WithGenericError<{ patchId: PatchId; filePath: string }>>;

  /**
   * The same, for a caller that already has the bytes.
   *
   * Default implementation wraps them back into a data URL so every backend
   * gets this for free; a backend that can take bytes straight through should
   * override it.
   */
  async saveBinaryFileFromPatch(
    filePath: string,
    parentRef: ParentRef,
    patchId: PatchId,
    bytes: Uint8Array,
    mimeType: string,
    type: "file" | "image",
    metadata: MetadataOfType<"file" | "image"> | undefined,
  ): Promise<WithGenericError<{ patchId: PatchId; filePath: string }>> {
    return this.saveBase64EncodedBinaryFileFromPatch(
      filePath,
      parentRef,
      patchId,
      `data:${mimeType};base64,${bytesToBase64(bytes)}`,
      type,
      metadata,
    );
  }
  abstract getBase64EncodedBinaryFileFromPatch(
    filePath: string,
    patchId: PatchId,
    remote: boolean,
  ): Promise<Uint8Array | null>;
  protected abstract getBase64EncodedBinaryFileMetadataFromPatch<
    T extends "file" | "image",
  >(
    filePath: string,
    type: T,
    patchId: PatchId,
    remote: boolean,
  ): Promise<OpsMetadata<T>>;
  abstract getBinaryFile(filePathOrRef: string): Promise<Uint8Array | null>;

  /**
   * A file's bytes as something a `Range` request can be answered from
   * without reading the rest: a video is seeked in by many small ranges, and
   * each used to load the whole file.
   *
   * This default holds the whole file, which is all a mode that only gets
   * whole files can do (`ValOpsHttp`: the content service answers with the
   * file in a JSON body). `ValOpsFS` reads only the asked-for range off disk.
   */
  async openBinaryFile(
    filePath: string,
    fromPatch: { patchId: PatchId; remote: boolean } | null,
  ): Promise<BinaryFileReader | null> {
    const buffer = fromPatch
      ? await this.getBase64EncodedBinaryFileFromPatch(
          filePath,
          fromPatch.patchId,
          fromPatch.remote,
        )
      : await this.getBinaryFile(filePath);
    return buffer === null ? null : bufferReader(buffer);
  }
  protected abstract getBinaryFileMetadata<T extends "file" | "image">(
    filePath: string,
    type: T,
  ): Promise<OpsMetadata<T>>;
  abstract deletePatches(patchIds: PatchId[]): Promise<
    | {
        deleted: PatchId[];
        errors?: undefined;
        error?: undefined;
        /** The chain version the delete moved the branch to, where reported. */
        headVersion?: number;
      }
    | {
        deleted: PatchId[];
        errors: Record<PatchId, GenericErrorMessage>;
        headVersion?: number;
      }
    | { error: GenericErrorMessage; errors?: undefined; deleted?: undefined }
  >;

  // #region history
  //
  // Reading the past, as opposed to reading the present with pending patches
  // applied. Every one of these is Result-typed against `HistoryError`, because
  // the ways this can fail - an unreadable record, a source that no longer
  // parses, an op that will not replay, a schema that has moved on - are the
  // interesting part rather than an edge case, and a caller deciding whether to
  // offer a RESTORE has to know which one it hit.
  //
  // Only implemented where there is a service holding the history:
  // `ValOpsHttp`. `ValOpsFS` answers `not-supported-in-fs-mode`, because local
  // dev has git for this and no commit records of its own.

  /** One page of a branch's commits, newest first. See history/listCommits. */
  abstract listCommits(
    branch: string,
    options?: { limit?: number; cursor?: string },
  ): Promise<result.Result<CommitPage, HistoryError>>;

  /** The patches that produced one commit, with their ops. */
  abstract getCommitPatches(
    commitSha: string,
  ): Promise<
    result.Result<
      { commit: HistoricalCommit; patches: CommitPatch[] },
      HistoryError
    >
  >;

  /**
   * How each `.val.ts` the commit changed looked BEFORE it, keyed by module
   * file path. Empty for a commit made before this was recorded - which the
   * caller reports as `source-unavailable` rather than as an empty module.
   */
  /**
   * Each module a commit changed: its data, and the schema it was under.
   *
   * `asOf` widens it from "what this commit changed" to "the whole project as
   * this commit left it", which is what reverting everything to a point in time
   * needs; `moduleFilePath` narrows it to one module, for navigating the
   * history pane off the changed set.
   */
  abstract getCommitModules(
    commitSha: string,
    options?: { asOf?: boolean; moduleFilePath?: ModuleFilePath },
  ): Promise<
    result.Result<
      { modules: StoredModuleVersion[]; complete: boolean },
      HistoryError
    >
  >;

  /** Which files the commit touched, and how. Names them; does not fetch them. */
  abstract getCommitAffectedFiles(
    commitSha: string,
  ): Promise<result.Result<AffectedFile[], HistoryError>>;

  /** One file's bytes as they were at one commit. */
  abstract getFileAtCommit(
    commitSha: string,
    filePath: string,
    remote: boolean,
  ): Promise<result.Result<Uint8Array, HistoryError>>;

  /**
   * Where a module lives in the REPOSITORY, as `getFileAtCommit` wants it.
   *
   * A `ModuleFilePath` is project-relative (`/app/page.val.ts`); a git path is
   * repository-relative and carries the project root in front of it
   * (`examples/next/app/page.val.ts`). Only the ops know that root, which is
   * why this is here rather than computed by the history functions - and why a
   * history function that needs to read a module's own file at a commit has to
   * ask instead of concatenating.
   */
  abstract gitPathOfModule(
    moduleFilePath: ModuleFilePath,
  ): result.Result<string, HistoryError>;
  // #endregion history
}

/** A record holding `.jsonValues()` markers (`{ _type: "json" }`). */
function holdsJsonEntryMarkers(source: JSONValue): boolean {
  return (
    typeof source === "object" &&
    source !== null &&
    !Array.isArray(source) &&
    Object.values(source).some(
      (value) =>
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        value["_type"] === "json",
    )
  );
}

function isOnlyRemoteCheckValidationError(
  validationError: ValidationError,
): boolean {
  const fixes = validationError.fixes ?? [];
  return (
    fixes.length > 0 &&
    fixes.every((f) => f === "image:check-remote" || f === "file:check-remote")
  );
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

export type SaveSourceFilePatchResult = result.Result<
  {
    patchId: PatchId;
    /**
     * The chain version this write made — see
     * {@link OrderedPatches.headVersion}. Absent in `fs` mode and against a
     * content service that predates it.
     */
    headVersion?: number;
  },
  | ({ errorType: "other" } & GenericErrorMessage)
  | { errorType: "patch-head-conflict" }
  | PlanRefusedError
>;

/**
 * The content API refused a write for the project's plan (a 403 that says why
 * as data), as opposed to refusing the patch.
 *
 * Its own error rather than an `other`: an `other` becomes a 400, and the
 * Studio drops a patch it is told is bad. This one is good, and is saved once
 * the plan allows it. `error` has the same shape as `other`'s so a caller that
 * only wants a sentence reads it the same way.
 */
export type PlanRefusedError = {
  errorType: "plan-refused";
  error: GenericErrorMessage;
  refusal: PlanRefusalErrorT;
};

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

/**
 * Why a publish is refused, in a form a person can be shown.
 *
 * `code` is for the Studio to branch on and `message` is what it says. Both,
 * rather than a code and a lookup table on the client: the server knows what
 * is actually missing -- which branch, which commit -- and a client-side table
 * could only ever say the generic version.
 */
export type PublishRefusal = {
  code: "no-base";
  message: string;
};

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
   * Each changed module's Source after this commit, and its schema.
   *
   * This is what makes a commit restorable. See the comment where it is built.
   */
  moduleVersions: Record<
    ModuleFilePath,
    {
      source: JSONValue | null;
      schema: SerializedSchema;
      /**
       * `staged:<inputs>`: the module's code is staged in the proposal and
       * not in this build, so `schema` is not the one `source` fits; content
       * records this as the version's schema instead (valbuild/home,
       * "Staged schemas"). Absent for every other module.
       */
      staged?: string;
    }
  >;
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

export { draftModulePatches, draftOverlay } from "./draftOverlay";

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
  /**
   * The head of the patch chain: the last patch registered on the branch,
   * published or not. `null` when there is none.
   *
   * What a new patch names as its parent, and NOT the last of `patches` — see
   * `chainHeadOf` in `@valbuild/shared` for why. Absent means the store does
   * not report one: `ValOpsFS` (whose ordering log defines order, and which
   * ignores the parent) and a content service that predates the field.
   */
  headPatchId?: PatchId | null;
  /**
   * The version of the chain {@link headPatchId} was read at.
   *
   * The content service bumps it with every write and every delete, in the
   * transaction that makes the change, and reads it in the same statement as
   * the head. `/stat` has more than one caller, so two answers can be in
   * flight at once and land in either order; a client keeps the head with the
   * highest version, and an answer that arrives after a newer one no longer
   * puts its parent back. Absent wherever `headPatchId` is, and for the same
   * reasons.
   */
  headVersion?: number;
  /**
   * The branch's last commit, `null` when it has none: what the commits this
   * answer lists bring a build up to at the least, because the content
   * service reads it before them. What Publish selected names as its
   * proposal's base, so a publish landing in between is refused rather than
   * reverted. Only `ValOpsHttp` fills it, and only from an unfiltered read
   * (`fetchPatches` without `patchIds`); absent from an older content service.
   */
  headCommitSha?: string | null;
  /**
   * Of these patches, the ones a publish job that is still running holds. A
   * Studio does not offer Publish over them, on any tab or device. Reported
   * whole on every answer, so a job that ends without sealing gives them back.
   * Absent where publishing is not done in jobs, and from an older content
   * service. Only `ValOpsHttp` fills it.
   */
  publishingPatches?: PatchId[];
  /**
   * Of these patches, the ones a publish that failed on its content holds back
   * from later publishes, until Try again or Discard: they are pending, and
   * not ready to publish. Absent where publishing is not done in jobs, and
   * from an older content service. Only `ValOpsHttp` fills it.
   */
  heldBackPatches?: PatchId[];
  /**
   * The content service has counted a NEWER build of the branch live: this
   * one is a previous build still answering (S26; valbuild/home
   * `utils/liveBuild.ts`). Its chain is right for its own base, which is not
   * what the site serves any more. Only `ValOpsHttp` fills it.
   */
  superseded?: boolean;
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
  /** See {@link OrderedPatches.headPatchId}. */
  headPatchId?: OrderedPatches["headPatchId"];
  /** See {@link OrderedPatches.headVersion}. */
  headVersion?: OrderedPatches["headVersion"];
  /** See {@link OrderedPatches.headCommitSha}. */
  headCommitSha?: OrderedPatches["headCommitSha"];
  /** See {@link OrderedPatches.publishingPatches}. */
  publishingPatches?: OrderedPatches["publishingPatches"];
  /** See {@link OrderedPatches.heldBackPatches}. */
  heldBackPatches?: OrderedPatches["heldBackPatches"];
  /**
   * The base this list is relative to, when the content service answered it
   * relative to ANOTHER build than the one asking: the live build, when the
   * one asking is a previous build still answering (S26, http mode; see
   * `ValOpsHttp.getStat`). Absent: this build's own base.
   */
  chainBase?: SourcesSha;
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
  buffer: Uint8Array,
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

export function bufferFromDataUrl(
  dataUrl: string,
  /** Node passes `Buffer`'s, which is faster: this is a whole upload. */
  decodeBase64: (base64: string) => Uint8Array = base64ToBytes,
): Uint8Array | undefined {
  let base64Data;
  const base64Index = dataUrl.indexOf(";base64,");
  if (base64Index > -1) {
    base64Data = dataUrl.slice(base64Index + ";base64,".length);
  }
  if (base64Data) {
    // TODO: why does it not work with base64url?
    return decodeBase64(base64Data);
  }
}

/** A file of known size whose bytes are read a range at a time. */
export type BinaryFileReader = {
  readonly size: number;
  /** Bytes `start` to `end`, both inclusive, as an HTTP range is. */
  read(start: number, end: number): Promise<Uint8Array>;
};

export function bufferReader(buffer: Uint8Array): BinaryFileReader {
  return {
    size: buffer.length,
    read: async (start, end) => buffer.subarray(start, end + 1),
  };
}

/**
 * Mark the `.jsonValues()` entries a publish just wrote: their marker in the
 * committed source carries the `patch_id` of the patch that last wrote them.
 *
 * A marker with a `patch_id` says "this entry's content is not the bundle's:
 * read it from the server", which is what it already says for an entry a
 * PENDING patch added. After a publish it has to say it too, and nothing else
 * could: the entry's content lives in its `*.val.json`, which the source holds
 * only a marker for, so an edit inside an entry left the source -- and with it
 * every SHA -- exactly as it was. A host that does not rebuild after a publish
 * (memory mode) then served the page's readers, the overlay and the Studio the
 * content from before it, out of the bundle's imports, with no way to tell.
 *
 * Marked, the source moves, the SHAs move with it, and every reader that sees
 * the marker reads the entry from the server, where `adoptedJsonEntries` has
 * the content the commit wrote. A deleted entry needs nothing: its key leaves
 * the source.
 */
function markPublishedJsonEntries(
  adopt: Sources,
  analysis: OrderedPatches,
  patchedJsonEntries: PreparedCommit["patchedJsonEntries"],
): void {
  // The last patch of this commit that wrote each entry, in chain order. The
  // destination of a move or copy is its `path`, like every other op's.
  const lastPatch = new Map<ModuleFilePath, Map<string, PatchId>>();
  for (const { path, patchId, patch } of analysis.patches) {
    const byKey = lastPatch.get(path) ?? new Map<string, PatchId>();
    for (const op of patch) {
      const key = op.path[0];
      if (typeof key === "string") byKey.set(key, patchId);
    }
    lastPatch.set(path, byKey);
  }
  for (const [moduleFilePath, byKey] of lastPatch) {
    const entries = patchedJsonEntries[moduleFilePath];
    const source = adopt[moduleFilePath];
    if (
      entries === undefined ||
      typeof source !== "object" ||
      source === null ||
      Array.isArray(source)
    ) {
      continue;
    }
    const marked: Record<string, Source> = Object.fromEntries(
      Object.entries(source),
    );
    for (const [entryKey, content] of Object.entries(entries)) {
      const patchId = byKey.get(entryKey);
      const marker = marked[entryKey];
      if (
        content === null ||
        patchId === undefined ||
        !Internal.isJson(marker)
      ) {
        continue;
      }
      marked[entryKey] = { ...marker, patch_id: patchId };
    }
    adopt[moduleFilePath] = marked;
  }
}
