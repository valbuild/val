import {
  Internal,
  type Json,
  type ModuleFilePath,
  type PatchId,
} from "@valbuild/core";
import type { Patch } from "@valbuild/core/patch";
import {
  EMPTY_CHAIN,
  baseModuleContent,
  sameModuleVersion,
  type ModuleVersion,
  type ProjectVersion,
} from "@valbuild/shared/internal";
import type { HostStore } from "./HostStore";
import type { PatchStore } from "./PatchStore";
import type { SourceStore } from "./SourceStore";
import type { StatStore } from "./StatStore";
import type { ModuleAt } from "./studioView";
import { originTier, type FetchModule, type OriginModule } from "./originTier";
import type { ActivitySink } from "./activity";
import { noopActivity } from "./activity";

/*
 * What each module IS on the server, and the Studio's source moved to it:
 * `manifestSource` in `docs/plans/one-content-model.md`, "The Studio loads
 * everything from one place" (phase 7).
 *
 Every `/stat` the Studio adopts whose `seq` moved is followed here: the
 * manifest is read "since `seq` N" (`GET /manifest?since=N`, with the ETag
 * held: a 304 while nothing moved, the modules whose version moved
 * otherwise), each module is read at the version it names from the store --
 * the versions this Studio computed itself, the bundle's own module, or its
 * own server (`originTier.ts`, the patches from the version held) -- and
 * then, in ONE turn, the source store moves to them
 * (`SourceStore.adoptServer`). Nothing renders in between.
 *
 * After the stat, not before it: the patch store takes the stat's list at
 * once, as it always has (the head a save names, the records the review
 * lists), and the CONTENT follows the manifest. A patch another editor made
 * is shown once the server's version has it -- never replayed here on a
 * base that may not be the one it was made on.
 *
 * What this replaced:
 *
 * - `BaseAlignment`, which compared the `sourcesSha` of the build that
 *   answered `/stat` with the bundle's and fetched that build's whole base
 *   (`PUT /sources/~?apply_patches=false`) to put the chain on. A version
 *   names the base it is on, per module, so a base this Studio does not hold
 *   is one read of one module, and the server's module at its version is
 *   relative to its own base by construction: there is no base and chain
 *   from two builds to keep apart.
 * - `window.__VAL_BASE__`, the page's base for a content version the bundle
 *   was not built with: the manifest names those bases, and they are read by
 *   version like any other.
 * - The client's replay of other editors' patches on the bundle (`chainSource`),
 *   and the `GET /patches` round trip that verified every patch a `/stat`
 *   stopped naming: the server's version says what it has, and a patch it
 *   does not have that the server held before the manifest was asked for is
 *   gone (`PatchStore.decidedGone`).
 */

/** What `GET /manifest` answered. */
export type ManifestFetchAnswer =
  | {
      kind: "manifest";
      project: ProjectVersion;
      modules: Record<ModuleFilePath, ModuleVersion>;
      /** This answer's ETag, to ask "since" with. */
      tag?: string;
      /** A delta: only the modules that moved since the manifest held. */
      since?: number;
    }
  /** 304: nothing moved since the manifest held. */
  | { kind: "unchanged" }
  /**
   * A previous build answered, still being served while a newer one is
   * live: its versions are its own bases', which the site does not serve.
   * Not moved to; the next stat asks again (S26).
   */
  | { kind: "superseded" }
  | { kind: "error"; message: string };

/**
 * `GET /manifest`, "since" the manifest held when there is one. The network,
 * as a seam: `createValSystem` is the one place that knows it is HTTP.
 */
export type FetchManifest = (
  held: { tag: string; seq: number } | null,
) => Promise<ManifestFetchAnswer>;

type Manifest = {
  project: ProjectVersion;
  modules: Record<ModuleFilePath, ModuleVersion>;
  tag: string | undefined;
};

type Resolved = {
  version: ModuleVersion;
  /** Its content, or the patches of a version this Studio computed. */
  at: ModuleAt | { applied: readonly PatchId[] };
  base?: Json;
};

/** What one manifest read came to, ready to adopt in one turn. */
type Loaded = {
  manifest: Manifest;
  resolved: Map<ModuleFilePath, Resolved>;
  decided: ModuleFilePath[];
  /** Some module could not be read: the next stat reads the manifest again. */
  incomplete: boolean;
};

export class ManifestSource {
  /** The manifest the source store is at, or `null` before one. */
  private manifest: Manifest | null = null;
  /** The last read left a module unread: read again on the next stat. */
  private incomplete = false;

  /**
   * Whether the source store has been in step with the server at least once:
   * a manifest adopted, or a stat adopted as it stands because none could
   * be read. See {@link onInStep}. Never goes back to `false`.
   */
  private inStep = false;
  private inStepListeners = new Set<() => void>();

  /**
   * Modules whose schema this Studio moved to by new code (HMR, staged code
   * the tab evaluated) and no build has answered with yet: the Studio is
   * AHEAD of the server there. See {@link codeMoved}.
   */
  private ahead = new Set<ModuleFilePath>();

  /** Whether intake has happened: before it there is no base to move. */
  private intaken = false;

  /**
   * Bases read from the origin that are not the bundle's, by module: put
   * back when a re-intake (HMR, staged code) puts the bundle's under a
   * module the server is on another base for, in that same turn.
   */
  private fetchedBases = new Map<
    ModuleFilePath,
    { version: string; source: Json }
  >();

  /** A read under way; another stat meanwhile reads again after it. */
  private loading: Promise<void> | null = null;
  private again = false;
  /** A stat was adopted: there is something to read once intake is in. */
  private statSeen = false;

  constructor(
    private readonly host: HostStore,
    private readonly sourceStore: SourceStore,
    private readonly patchStore: PatchStore,
    private readonly fetchManifest: FetchManifest | undefined,
    private readonly fetchModule: FetchModule | undefined,
    private readonly activity: ActivitySink = noopActivity,
  ) {}

  /**
   * New code moved these modules' schemas (`schema:init` after the first
   * intake): until a build answers with them, this Studio is ahead of the
   * server for them, and keeps the base its own code wrote -- the server's
   * was evaluated without the field the new code added (S10b, C11). Where
   * the SERVER is ahead (a deploy, a proposal built without the tab
   * evaluating it), its version is taken: keeping the old base there would
   * drop what that build already contains.
   */
  codeMoved(modules: readonly ModuleFilePath[]): void {
    if (!this.intaken) return;
    for (const moduleFilePath of modules) this.ahead.add(moduleFilePath);
  }

  /**
   * Call `listener` once the source store is first in step with the server:
   * a manifest adopted after intake, or a stat adopted as it stands because
   * no manifest could be read. At once if that has happened already.
   *
   * Until then the store holds the bundle's source -- which after a publish,
   * or on a site serving a content version, is not what the server has -- so
   * what hands source to a page waits for this (`ValOverlayEmitter`, the
   * canvas relay), or the page is shown the old text and then the new.
   */
  onInStep(listener: () => void): () => void {
    if (this.inStep) {
      listener();
      return () => {};
    }
    this.inStepListeners.add(listener);
    return () => {
      this.inStepListeners.delete(listener);
    };
  }

  private markInStep(): void {
    if (this.inStep || !this.intaken) return;
    this.inStep = true;
    const listeners = [...this.inStepListeners];
    this.inStepListeners.clear();
    for (const listener of listeners) listener();
  }

  /** The manifest adopted last, or `null`. */
  current(): {
    project: ProjectVersion;
    modules: Readonly<Record<ModuleFilePath, ModuleVersion>>;
  } | null {
    return this.manifest;
  }

  listenTo(stat: StatStore): () => void {
    const offStat = stat.events.on("stat:receive", (event) => {
      this.statSeen = true;
      this.follow(event.seq);
    });
    const offHost = this.host.events.on("host:base-received", () => {
      const first = !this.intaken;
      this.intaken = true;
      if (first) {
        // A stat adopted before intake had nothing to move: read it now.
        if (this.statSeen) this.follow(undefined);
        return;
      }
      this.restoreBases();
    });
    return () => {
      offStat();
      offHost();
    };
  }

  /**
   * Read the manifest for a stat at `seq`, unless the store is at it
   * already. One read at a time: a stat that arrives during one reads again
   * after it, so the newest answer always lands last.
   */
  private follow(seq: number | undefined): void {
    if (this.fetchManifest === undefined) {
      // No server to ask: the store stays on the bundle, every patch on top.
      this.markInStep();
      return;
    }
    if (!this.intaken) return;
    const manifest = this.manifest;
    if (
      manifest !== null &&
      !this.incomplete &&
      seq !== undefined &&
      seq === manifest.project.seq
    ) {
      // Nothing moved since the manifest the store is at.
      this.markInStep();
      return;
    }
    if (this.loading !== null) {
      this.again = true;
      return;
    }
    const fetchManifest = this.fetchManifest;
    const run = async (): Promise<void> => {
      do {
        this.again = false;
        await this.readOnce(fetchManifest);
      } while (this.again);
    };
    this.loading = run().finally(() => {
      this.loading = null;
    });
  }

  /** Whether a read is under way: for a test to wait on. */
  settled(): Promise<void> {
    return this.loading ?? Promise.resolve();
  }

  /** One read of the manifest, adopted in one turn when it lands. */
  private async readOnce(fetchManifest: FetchManifest): Promise<void> {
    const epoch = this.patchStore.nextManifestEpoch();
    let loaded: Loaded | null;
    try {
      loaded = await this.load(fetchManifest);
    } catch (error) {
      Internal.log.debug("could not read the manifest", error);
      loaded = null;
    }
    if (loaded === null) {
      // Nothing decided: the patches beyond the server's version stay on
      // top until a manifest can be read, which the next stat asks for
      // whatever its `seq`. In step all the same, so a page is not held back
      // on a server that does not answer this.
      this.incomplete = true;
      this.markInStep();
      return;
    }
    this.manifest = loaded.manifest;
    this.incomplete = loaded.incomplete;
    this.decidedAt = epoch;
    this.sourceStore.adoptServer(loaded.resolved, loaded.decided, epoch);
    // What the last stat stopped naming is decided now: settled by this
    // manifest, which was asked for after it.
    this.patchStore.manifestAdopted();
    this.markInStep();
  }

  /**
   * A re-intake put the bundle's base back under modules the server is on
   * another base for: put the server's back, in this turn, so the bundle's
   * is never on screen under the server's version.
   */
  private restoreBases(): void {
    const manifest = this.manifest;
    if (manifest === null) return;
    const restored = new Map<ModuleFilePath, Resolved>();
    for (const [moduleFilePath, version] of Object.entries(
      manifest.modules,
    ) as [ModuleFilePath, ModuleVersion][]) {
      if (this.ahead.has(moduleFilePath)) continue;
      const held = this.sourceStore.baseOf(moduleFilePath);
      if (held === undefined || held.version === version.base) continue;
      const fetched = this.fetchedBases.get(moduleFilePath);
      const below = this.sourceStore.serverModuleOf(moduleFilePath);
      if (fetched?.version !== version.base || below === null) continue;
      restored.set(moduleFilePath, {
        version: below.version,
        at: below.at,
        base: fetched.source,
      });
    }
    if (restored.size > 0) {
      this.sourceStore.adoptServer(restored, [], this.decidedAt);
    }
  }

  /** The epoch the adopted manifest was asked for at. */
  private decidedAt = -1;

  private async load(fetchManifest: FetchManifest): Promise<Loaded | null> {
    const held = this.manifest;
    this.activity.work("manifest:fetch");
    const answer = await fetchManifest(
      held !== null && held.tag !== undefined && !this.incomplete
        ? { tag: held.tag, seq: held.project.seq }
        : null,
    );
    if (answer.kind === "error") {
      Internal.log.debug("could not read the manifest", answer.message);
      return null;
    }
    if (answer.kind === "superseded") {
      Internal.log.debug(
        "a previous build answered the manifest; asking again on the next stat",
      );
      return null;
    }
    let manifest: Manifest;
    if (answer.kind === "unchanged") {
      if (held === null) return null;
      manifest = held;
    } else {
      const delta = answer.since !== undefined && held !== null;
      manifest = {
        project: answer.project,
        modules: delta
          ? { ...held.modules, ...answer.modules }
          : answer.modules,
        tag: answer.tag,
      };
    }
    const resolved = new Map<ModuleFilePath, Resolved>();
    const decided: ModuleFilePath[] = [];
    let incomplete = false;
    // Every module the manifest names: the ones that did not move are
    // decided at this manifest too, and cost nothing to look at.
    const names = Object.keys(manifest.modules) as ModuleFilePath[];
    await Promise.all(
      names.map(async (moduleFilePath) => {
        const version = manifest.modules[moduleFilePath];
        const read = await this.resolve(moduleFilePath, version);
        if (read === "skip") return;
        if (read === "failed") {
          incomplete = true;
          return;
        }
        decided.push(moduleFilePath);
        if (read !== "held") resolved.set(moduleFilePath, read);
      }),
    );
    return { manifest, resolved, decided, incomplete };
  }

  /**
   * One module at the version the manifest names, from the cheapest place
   * that has it: what the source store is at already, a version this Studio
   * computed, the bundle, or the origin.
   */
  private async resolve(
    moduleFilePath: ModuleFilePath,
    version: ModuleVersion,
  ): Promise<Resolved | "held" | "skip" | "failed"> {
    const base = this.sourceStore.baseOf(moduleFilePath);
    // A module this Studio does not have: nothing to show it in.
    if (base === undefined) return "skip";
    const ours = this.sourceStore.schemaVersionOfModule(moduleFilePath);
    if (version.schema === ours) {
      this.ahead.delete(moduleFilePath);
    } else if (this.ahead.has(moduleFilePath)) {
      return "skip";
    }
    const held = this.sourceStore.serverVersionOf(moduleFilePath);
    if (
      held !== undefined &&
      base.version === version.base &&
      sameModuleVersion(held, version)
    ) {
      return "held";
    }
    // The base it is on.
    let baseSource: Json | undefined;
    let movedBase: Json | undefined;
    if (base.version === version.base) {
      baseSource = base.source;
    } else {
      const fetched = this.fetchedBases.get(moduleFilePath);
      if (fetched?.version === version.base) {
        baseSource = fetched.source;
      } else {
        const read = await this.readModule(moduleFilePath, {
          ...version,
          chain: EMPTY_CHAIN,
        });
        if (read === null) return "failed";
        baseSource = read.content.source as Json;
        this.fetchedBases.set(moduleFilePath, {
          version: version.base,
          source: baseSource,
        });
      }
      movedBase = baseSource;
    }
    const atBase = (): ModuleAt =>
      this.sourceStore.atOfServer(
        moduleFilePath,
        {
          version: { ...version, chain: EMPTY_CHAIN },
          content: baseModuleContent(baseSource),
          patches: [],
        },
        baseSource,
      );
    if (version.chain === EMPTY_CHAIN) {
      return {
        version,
        at: atBase(),
        ...(movedBase !== undefined ? { base: movedBase } : {}),
      };
    }
    // The memory tier: a version this Studio computed itself -- its own
    // edit, now confirmed -- by its content, or by its patches alone when
    // what is shown has moved on from it (a save confirmed while the editor
    // typed on).
    if (version.schema === ours && movedBase === undefined) {
      const known = this.sourceStore.knownChain(moduleFilePath, version);
      if (known !== null) {
        this.activity.work("manifest:memory-hit", moduleFilePath);
        return { version, at: "at" in known ? known.at : known };
      }
    }
    // The origin, with the version held of the same schema and base.
    const below =
      movedBase === undefined &&
      held !== undefined &&
      held.schema === version.schema &&
      held.base === version.base
        ? this.sourceStore.serverModuleOf(moduleFilePath)
        : null;
    const have =
      below !== null
        ? below
        : { version: { ...version, chain: EMPTY_CHAIN }, at: atBase() };
    const read = await this.readModule(moduleFilePath, version, {
      version: have.version,
      extend: (patches) => {
        const at = this.sourceStore.extendServer(
          moduleFilePath,
          have.at,
          patches,
          baseSource,
        );
        if (at === null || at.version.chain !== version.chain) return null;
        return { version, content: at.content, patches: at.applied };
      },
    });
    if (read === null) return "failed";
    return {
      version: read.version,
      at: this.sourceStore.atOfServer(moduleFilePath, read, baseSource),
      ...(movedBase !== undefined ? { base: movedBase } : {}),
    };
  }

  private async readModule(
    moduleFilePath: ModuleFilePath,
    version: ModuleVersion,
    have?: {
      version: ModuleVersion;
      extend: (
        patches: { patchId: PatchId; patch: Patch }[],
      ) => OriginModule | null;
    },
  ): Promise<OriginModule | null> {
    if (this.fetchModule === undefined) return null;
    this.activity.work("manifest:origin", moduleFilePath);
    let read: Awaited<ReturnType<typeof originTier>>;
    try {
      read = await originTier(
        this.fetchModule,
        moduleFilePath,
        version,
        have ?? null,
      );
    } catch (error) {
      read = {
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      };
    }
    if (read.status === "found") return read.module;
    Internal.log.debug("could not read a module at the manifest's version", {
      moduleFilePath,
      version,
      ...(read.status === "error" ? { message: read.message } : {}),
    });
    return null;
  }
}
