import { Internal } from "@valbuild/core";
import type { ModuleFilePath, ValModules } from "@valbuild/core";
import {
  STAGED_SCHEMA_PREFIX,
  type BuildRegistry,
  type ModuleVersion,
  type ProjectVersion,
} from "@valbuild/shared/internal";
import type { CodeReload, HostStore } from "./HostStore";
import type { SourceStore } from "./SourceStore";
import type { PatchSync } from "./PatchSync";
import type { PatchStore } from "./PatchStore";
import { noopActivity, type ActivitySink } from "./activity";

/**
 * Import a build's registry from its entry (`registry.entry` on the
 * manifest). In the browser, `import()` of a URL on the site's origin; a
 * test hands over the registry of the build it deployed.
 */
export type ImportRegistry = (entry: string) => Promise<ValModules>;

/**
 * The URL to import a build's registry from: `entry` resolved against the
 * page, and only when it is on the page's own origin. `null` for anything
 * else -- another host, `//host/…`, `data:`, `blob:` -- which is not
 * imported at all.
 *
 * The entry comes from the server's manifest, and an `import()` runs what it
 * names with the Studio's privileges: the editor's session, their unsaved
 * edits. A build's registry is always one of the site's own chunks
 * (`/_app/val-modules-<build>.js`), so nothing legitimate is refused.
 */
export function registryEntryUrl(entry: string, page: string): string | null {
  let url: URL;
  let origin: string;
  try {
    url = new URL(entry, page);
    origin = new URL(page).origin;
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.origin !== origin) return null;
  return url.href;
}

/**
 * Reload the page: the Studio's answer to a build whose code it cannot take
 * in place. Nothing is lost by it -- where the editor is and the chat
 * session are in the URL, and it waits until every edit is on the server.
 */
export type ReloadStudio = () => void;

/**
 * How long the schemas have to disagree before the Studio reloads the page
 * for them. In local development against a content service (http mode with
 * HMR), a schema edit reaches the server's manifest and this page's HMR in
 * either order; within this, HMR has always come.
 */
export const STUDIO_RELOAD_GRACE_MS = 3_000;

/**
 * How long a build's registry may take to import before the Studio stops
 * waiting for it. The manifest that named it is adopted only after its code
 * is in (`ManifestSource` waits on {@link BuildCode.follow}), so an import
 * that hangs -- a chunk the network never finishes -- held up every manifest
 * after it, and with them every other editor's change and every publish
 * reaching this Studio. Past this it is a registry that did not load: the
 * manifest is adopted, and the page reloads once the grace is up.
 */
export const REGISTRY_IMPORT_DEADLINE_MS = 15_000;

/** A manifest, as far as the code it names goes. */
export type ManifestCode = {
  project: ProjectVersion;
  modules: Readonly<Record<ModuleFilePath, ModuleVersion>>;
  registry?: BuildRegistry;
};

/**
 * A new build's code, into a Studio that is open: phase 9 of
 * `docs/plans/one-content-model.md`, "Reloading the schema while the Studio
 * runs". What replaced `SchemaFreshnessWatch` and its one-way "A new version
 * has been deployed" dialog.
 *
 * Every manifest the Studio reads is shown here before it is adopted
 * (`ManifestSource`). Where it names a schema this Studio does not run, for
 * a module the Studio is not ahead on (new code it took itself: HMR, staged
 * code it evaluated), the code has to move first, or the Studio shows the
 * old fields over the new build's content:
 *
 * - **The build names its registry** (a build the platform made: `registry`
 *   on the manifest): it is imported and handed to `HostStore.reloadCode`,
 *   checked against the manifest that named it, and the Studio runs the
 *   build's code -- before the manifest is adopted, so the content moves
 *   with its schema in one go. Once per build.
 * - **Local development (`fs` mode)**: HMR brings the code
 *   (`val-modules-updated`), whichever arrives first. Nothing to do here.
 * - **Anything else** -- a deploy the platform did not build (Next.js, a
 *   self-hosted TanStack Start), a build with another Val
 *   (`other-val-version`), a registry that does not load: the page is
 *   reloaded, without asking, once {@link STUDIO_RELOAD_GRACE_MS} has passed
 *   with the schemas still apart and no edit is on its way to the server --
 *   neither a patch nor the bytes of one (`PatchStore.uploadsInFlight`).
 *
 * What the watch knew, kept:
 *
 * - _A tab can load a new bundle and be answered by an old build for a
 *   while_: a previous build still answering says so (`superseded`), and
 *   its manifest never reaches here. And the page is never reloaded unless
 *   this Studio's code and the server's have agreed once: a page that loads
 *   on a build the server does not run would reload into the same page.
 * - _During a deploy old and new builds both answer_: manifests are ordered
 *   by `seq`, and one read at a time.
 * - _In dev, a schema edit reaches the server and HMR in either order_:
 *   the grace, and a look at the newest manifest when it is up.
 */
export class BuildCode {
  /** This Studio's code and the server's have agreed at least once. */
  private agreed = false;
  /** What each build's registry came to: one import per build. */
  private answers = new Map<string, CodeReload>();
  /** The newest manifest shown, and what the Studio is ahead on. */
  private latest: {
    manifest: ManifestCode;
    ahead: ReadonlySet<ModuleFilePath>;
  } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private waitingForSave: (() => void) | null = null;
  private reloading = false;
  private stopped = false;
  private readonly activity: ActivitySink;
  private readonly graceMs: number;

  constructor(
    private readonly host: HostStore,
    private readonly sourceStore: SourceStore,
    private readonly patchSync: PatchSync,
    private readonly patchStore: PatchStore,
    private readonly options: {
      /** `fs`: local development, where HMR brings new code. */
      mode: () => "fs" | "http";
      importRegistry?: ImportRegistry;
      /** Absent: a driver that cannot reload, which then keeps its code. */
      reloadStudio?: ReloadStudio;
      graceMs?: number;
      importDeadlineMs?: number;
      activity?: ActivitySink;
    },
  ) {
    this.activity = options.activity ?? noopActivity;
    this.graceMs = options.graceMs ?? STUDIO_RELOAD_GRACE_MS;
    this.importDeadlineMs =
      options.importDeadlineMs ?? REGISTRY_IMPORT_DEADLINE_MS;
  }

  private readonly importDeadlineMs: number;

  /** The registry at `entry`, or a rejection once the deadline has passed. */
  private importWithDeadline(
    importRegistry: ImportRegistry,
    entry: string,
  ): Promise<ValModules> {
    return new Promise<ValModules>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(
            `The new build's code (${entry}) did not finish loading within ${Math.round(this.importDeadlineMs / 1000)} s.`,
          ),
        );
      }, this.importDeadlineMs);
      importRegistry(entry).then(
        (registry) => {
          clearTimeout(timer);
          resolve(registry);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  /**
   * A manifest about to be adopted. Resolves once the code it needs is in,
   * where it can be: the caller adopts the manifest after.
   */
  async follow(
    manifest: ManifestCode,
    ahead: ReadonlySet<ModuleFilePath>,
  ): Promise<void> {
    if (this.stopped) return;
    this.latest = { manifest, ahead };
    const moved = this.moved(manifest, ahead);
    if (moved.length === 0) {
      this.agreed = true;
      this.cancel();
      return;
    }
    if (this.options.mode() === "fs") return;
    const registry = manifest.registry;
    const importRegistry = this.options.importRegistry;
    if (registry !== undefined && importRegistry !== undefined) {
      let answer = this.answers.get(registry.entry);
      if (answer === undefined) {
        this.activity.work("code:import-build");
        answer = await this.host.reloadCode(
          () => this.importWithDeadline(importRegistry, registry.entry),
          {
            byContent: true,
            expected: { core: registry.core, modules: manifest.modules },
          },
        );
        if (answer.status === "kept" && answer.reason === "superseded") {
          // Other code arrived meanwhile (HMR): the next manifest decides.
          return;
        }
        this.answers.set(registry.entry, answer);
        if (answer.status === "kept") {
          Internal.log.debug(
            `the new build's code was not taken in (${answer.reason})`,
            answer.details,
          );
        }
      }
      if (answer.status === "reloaded") return;
      if (answer.reason === "not-the-manifest's") return;
    }
    this.scheduleReload();
  }

  /**
   * The modules whose code the manifest says moved: a schema this Studio
   * does not run, a module it does not have, or one it has and the build
   * does not. Not a module this Studio is ahead on, nor one staged after
   * the build serving a proposal (`staged:`), which no build's code has.
   */
  private moved(
    manifest: ManifestCode,
    ahead: ReadonlySet<ModuleFilePath>,
  ): ModuleFilePath[] {
    const moved: ModuleFilePath[] = [];
    for (const [moduleFilePath, version] of Object.entries(
      manifest.modules,
    ) as [ModuleFilePath, ModuleVersion][]) {
      if (version.schema.startsWith(STAGED_SCHEMA_PREFIX)) continue;
      if (ahead.has(moduleFilePath)) continue;
      if (
        this.sourceStore.schemaVersionOfModule(moduleFilePath) !==
        version.schema
      ) {
        moved.push(moduleFilePath);
      }
    }
    for (const moduleFilePath of this.host.loadedModules()) {
      if (
        manifest.modules[moduleFilePath] === undefined &&
        !ahead.has(moduleFilePath)
      ) {
        moved.push(moduleFilePath);
      }
    }
    return moved;
  }

  private scheduleReload(): void {
    if (this.options.reloadStudio === undefined) return;
    if (this.timer !== null || this.reloading) return;
    if (!this.agreed) {
      Internal.log.debug(
        "the server runs other code than this page was loaded with, and the two have never agreed: not reloading into the same page",
      );
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.reloadIfStillMoved();
    }, this.graceMs);
  }

  private reloadIfStillMoved(): void {
    if (this.stopped || this.reloading || this.latest === null) return;
    if (this.moved(this.latest.manifest, this.latest.ahead).length === 0) {
      return;
    }
    if (
      this.patchSync.currentState().status !== "in-sync" ||
      this.patchStore.uploadsInFlight() > 0
    ) {
      // An edit is on its way to the server -- its bytes, or the patch
      // itself: reloaded now, it would be lost. An upload comes first and
      // the patch exists only after it, so "in sync" is not enough.
      if (this.waitingForSave !== null) return;
      const again = () => {
        if (
          this.patchSync.currentState().status !== "in-sync" ||
          this.patchStore.uploadsInFlight() > 0
        ) {
          return;
        }
        this.waitingForSave?.();
        this.waitingForSave = null;
        this.reloadIfStillMoved();
      };
      const offSync = this.patchSync.events.on("patch:sync-state", again);
      const offUploads = this.patchStore.events.on("patch:uploads", again);
      this.waitingForSave = () => {
        offSync();
        offUploads();
      };
      return;
    }
    this.reloading = true;
    this.activity.work("code:reload-studio");
    Internal.log.info(
      "the site runs new code that this Studio cannot take in without reloading: reloading",
    );
    this.options.reloadStudio?.();
  }

  private cancel(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.waitingForSave?.();
    this.waitingForSave = null;
  }

  dispose(): void {
    this.stopped = true;
    this.cancel();
  }
}
