import {
  Internal,
  type Json,
  type ModuleFilePath,
  type PatchId,
  type ResolvableModule,
  type SelectorSource,
  type SourcePath,
  type ValConfig,
  type ValModule,
  type ValModules,
} from "@valbuild/core";
import {
  EMPTY_CHAIN,
  baseVersionOf,
  createValClient,
  engineWork,
  schemaVersionOf,
  versionHashCount,
  type ModuleVersion,
  type ProjectVersion,
} from "@valbuild/shared/internal";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { setTimeout as realSleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import {
  encodeJwt,
  getExpire,
  loadValModules as evaluateProject,
  type ValContentVersion,
  type ValProposal,
} from "@valbuild/server";
import {
  InMemoryPatchStore,
  initValContent,
  initValServer,
} from "@valbuild/tanstack/server";
import {
  ValExternalStore,
  applyValEvent,
  awaitResolved,
  getModuleIds,
  raw,
  readWork,
  readsOfFetchVal,
  resolveModuleEntry,
  resolveVal,
  type DecodeVal,
  type ReadEnv,
  type ReadOf,
  type Ready,
  type Resolution,
  type Resolvable,
  type ResolvedVal,
  // The page's half of the relay, both frameworks': the draft store a
  // provider starts from, what it reports, and when it refreshes.
  createDraftStore,
  draftHolds,
  isDraft,
  startRefreshLoop,
  type RefreshLoop,
  type ValDraft,
} from "@valbuild/react/stega";
// The Studio's own code, by path: `@valbuild/ui` exports the built Studio,
// not its stores. Each of these is what the Studio runs, unchanged.
import { createValSystem } from "../../../packages/ui/spa/stores/react/createValSystem";
import { loadValModules } from "../../../packages/ui/spa/stores/react/loadValModules";
import { statSnapshotOf } from "../../../packages/ui/spa/stores/react/statSnapshotOf";
import {
  parseSocketMessage,
  requestStat,
  statStateAfterAnswer,
  statStateAfterSocketMessage,
  statWait,
  type StatState,
} from "../../../packages/ui/spa/hooks/useStatus";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { stringFieldPatch } from "../../../packages/ui/spa/components/fields/stringFieldPatch";
import { writePatch } from "../../../packages/ui/spa/stores/react/writePatch";
import { directFileUploadSettings } from "../../../packages/ui/spa/stores/react/directFileUploadSettings";
import type { Patch } from "@valbuild/core/patch";
import { SchemaValidator } from "../../../packages/ui/spa/validation/validateModule";
import type { System } from "../../../packages/ui/spa/stores/createSystem";
import type { PublishResult } from "../../../packages/ui/spa/stores/PublishSeam";
import {
  RecordingActivity,
  type WorkKind,
} from "../../../packages/ui/spa/stores/activity";
import { createNetwork, type Handler, type Network } from "./network";
import {
  startOverlayRelay,
  type OverlayEvent,
} from "../../../packages/ui/spa/stores/react/sourceRelay";
// The page's own code, by path: what TanStack's hooks read with (the env
// their provider's state makes, and a route's read), which the package does
// not export.
import {
  moduleRouteRead,
  pageReadEnv,
  type PageReadState,
} from "../../../packages/tanstack/src/client/initValClient";
import { readsOfFetchValDraft } from "../../../packages/tanstack/src/server/initValContent";
import { inRequest } from "./tanstackStart";
import {
  createFrames,
  type FrameVersion,
  type FrameVersions,
  type Frames,
} from "./frames";
import { startFakeClock, type Clock } from "./clock";
import { installXmlHttpRequest } from "./xmlHttpRequest";
import { startContentHost, type ContentHost } from "./contentHost";
import {
  createProposalsClient,
  type ProposalsClient,
} from "../../../packages/ui/spa/proposals/proposalsClient";
import {
  buildProposal,
  runCodeTool,
  type CodeToolAnswer,
  type ProposalBuildOutcome,
} from "../../../packages/ui/spa/proposals/proposalCode";
import {
  createStudioJobClient,
  type StudioJobClient,
} from "@valbuild/shared/publish";
import { readCodeMode } from "../../../packages/ui/spa/proposals/codeMode";
import {
  commitProposal,
  type CommitOutcome,
} from "../../../packages/ui/spa/proposals/commitProposal";
import {
  buildOnTheirPush,
  type BuildOnPushOutcome,
} from "../../../packages/ui/spa/proposals/buildOnTheirPush";

/**
 * A world a scenario runs in: Val's real server behind a network the test
 * controls, and Studios and pages that talk to it with their real code.
 *
 * The rule (`.agent/rules.md`, "A test drives the product's code"): every action
 * the world takes is a call to the function the product calls for it. Where
 * that function was buried in a component or a hook, it was extracted and the
 * product calls the extracted one too -- never a second copy here.
 */
export type World = {
  /**
   * Which mode the server runs in: for fs, the project directory; for http,
   * where the content service is.
   */
  server:
    | { mode: "memory" }
    | { mode: "fs"; root: string }
    | { mode: "http"; contentUrl: string };
  network: Network;
  frames: Frames;
  studio(name: string): Promise<Studio>;
  /**
   * A page of the app. `at: "site"` serves it from the SITE's build in a
   * world at a proposal's address: the same content service and the same
   * editor's cookie, without the proposal -- with the content version the
   * platform hands a site isolate now (`VAL_CONTENT`), read per request.
   */
  page(route: string, options: { draftMode: boolean; at?: "site" }): Page;
  /** In a world at a proposal's address (http only): see {@link ProposalAt}. */
  proposal: ProposalAt | null;
  /** Every surface reads what it reads, and the answers become frames. */
  observe(): Promise<void>;
  /**
   * Let the world run until it is quiet: every Studio sends what it has not
   * saved, every poll that has news takes it, and time moves forward in steps
   * until nothing changes for a while. Parked long polls are quiet.
   */
  settle(): Promise<void>;
  /** The world's fake clock. See `clock.ts`. */
  clock: Clock;
  /**
   * New code reaches the app's server, as HMR does in development: the server
   * module is evaluated again, so `initValServer` and every page's
   * `initValContent` are called again with the new registry. Pending edits
   * stay where they are (fs: `.val/patches`; memory: the same patch store).
   * In http mode the new build is also reported live to the content service,
   * as the platform does, which moves the chain version once for it.
   */
  deployCode(modules: AnyModule[]): Deployment;
  /**
   * A page in the browser with the Val overlay on it (not inside the Studio),
   * loaded the way a TanStack page is: the server renders it from a
   * server-read draft (`fetchValDraft`, the `draft` prop), the browser
   * hydrates from the same draft, then the overlay's Studio starts from the
   * page's own client modules and the base the page serves, and relays what
   * it holds to the page's store. Every surface records a frame at each step
   * and at every store change, so a value that comes and goes is caught.
   */
  loadPage(route: string, options: PageLoadOptions): Promise<LoadedPage>;
  /**
   * New code. In local development: {@link deployCode}, then every Studio's
   * {@link Studio.receiveCode}. At a proposal's address it is the assistant
   * changing the proposal's code: `files` (the `.val.ts` text of `modules`,
   * by repository path) are staged through its `write_files`
   * ({@link ProposalAt.stage}), and the build the platform makes of them is
   * served and reaches every Studio. A staging that is refused throws.
   */
  changeCode(
    modules: AnyModule[],
    files?: Record<string, string | null>,
  ): Promise<void>;
  /** The invariants every scenario is held to. See `frames.ts`. */
  expectInvariants(): void;
  /**
   * The server's manifest (`GET /manifest`, through the network, as an
   * editor's browser asks it): every module's version and the project's.
   * With `since`, "since `seq` N" from that manifest: a delta when the
   * server can (`since` on the answer), `null` when nothing moved (304).
   */
  manifest(): Promise<Manifest>;
  manifest(since: Manifest): Promise<Manifest | null>;
  /**
   * Where the world's counted work stands now, for {@link expectWork}: work
   * done by Val's own code outside the Studios (the server and the readers),
   * never the world's own observing. A Studio's is its own, since phase 5
   * (it applies patches with the same engine and computes its own versions),
   * and is budgeted with `studio.expectWork`.
   */
  workPosition(): WorldWorkPosition;
  /**
   * The work Val's code did since `since`, against a budget. `version:hash`:
   * how many times a version was hashed (risk 3 in the plan: versions are
   * computed when content changes, never when it is read).
   * `engine:apply-patch`: patches the engine applied (`applyPatchRecord`).
   * `engine:clone-bytes`: what it copied doing so, 8 bytes a reference
   * (risk 4: copy-on-write, so a patch costs its path, not its module).
   * `read:resolve`: how many times a reader resolved (`resolveVal`,
   * `resolveValEntry`): once per read, plus once per wait it met.
   * `read:encode`: how many of those encoded a value (risk 6: `stegaEncode`
   * once per read, never once per wait).
   */
  expectWork(since: WorldWorkPosition, budget: WorldWorkBudget): void;
  /** Stops what the world started, and puts the working directory back. */
  dispose(): Promise<void>;
};

/** What `GET /manifest` answers. */
export type Manifest = {
  project: ProjectVersion;
  modules: Partial<Record<ModuleFilePath, ModuleVersion>>;
  /** Its ETag. */
  tag?: string;
  /** On a delta: the `seq` of the manifest it is relative to. */
  since?: number;
};

/** See {@link World.workPosition}. */
export type WorldWorkPosition = {
  versionHashes: number;
  engineApplies: number;
  engineCloneBytes: number;
  readResolves: number;
  readEncodes: number;
};

/** See {@link World.expectWork}. */
export type WorldWorkBudget = {
  "version:hash"?: { atMost: number } | { exactly: number };
  "engine:apply-patch"?: { atMost: number } | { exactly: number };
  "engine:clone-bytes"?: { atMost: number } | { exactly: number };
  "read:resolve"?: { atMost: number } | { exactly: number };
  "read:encode"?: { atMost: number } | { exactly: number };
};

/**
 * The proposal a world is at the address of, and what the platform and the
 * Studio do with it.
 */
export type ProposalAt = {
  name: string;
  branch: string;
  /**
   * The assistant's `write_files`, as the Studio runs it (`runCodeTool`):
   * stages files in the proposal through the app's `/proposals-api`.
   */
  stage(
    files: Record<string, string | null>,
    message?: string,
  ): Promise<CodeToolAnswer>;
  /**
   * What the platform does after a save or a staging: serve the address from
   * a new isolate, with the overlay content's overlay step wrote
   * (`VAL_OVERLAY`, read here from the content host as the platform holds it).
   */
  redeploy(): Promise<void>;
  /** Publish in the proposal: the press the Studio makes (`pressMerge`). */
  merge(commitMessage?: string): ReturnType<StudioJobClient["pressMerge"]>;
  /**
   * Turn code mode on or off, as the `</>` and the assistant's
   * `request_code_mode` card do (`ProposalsClient.setCodeMode`): at the
   * proposal's address, Val's server saves every pending change first.
   */
  codeMode(on: boolean): ReturnType<ProposalsClient["setCodeMode"]>;
  /** Commit, as the Studio's Commit does after saving (`commitProposal`). */
  commit(message: string): Promise<CommitOutcome>;
  /**
   * Somebody else pushes to the proposal's git branch, as a developer does
   * from a laptop: the content host's control plane. Val has not seen it.
   * `files`: what the push changes, as project paths (`null` deletes). A
   * second push before the first is taken in goes on top of it. Answers
   * their commit's sha.
   */
  someonePushes(push: {
    author: string;
    message: string;
    files?: Record<string, string | null>;
  }): Promise<string>;
  /**
   * Build on their push, as the Studio's notice does after Commit or Publish
   * was refused (`buildOnTheirPush`): `sha` is their commit, as the refusal
   * named it.
   */
  buildOnTheirPush(sha: string): Promise<BuildOnPushOutcome>;
  /**
   * Build the proposal and serve the build at its address, as the Studio's
   * Build does (`buildProposal`). The bundler is the world's edge: nothing
   * is bundled, and the build is "uploaded" as it is handed the files, which
   * it records in `built`. Then `redeploy` serves it.
   */
  build(): Promise<ProposalBuildOutcome>;
  /** The files each `build` handed the bundler, oldest first. */
  built: Record<string, string | null>[];
  /** The product's client for content's proposals API, through the app. */
  client: ProposalsClient;
};

export type Studio = {
  name: string;
  system: System;
  /**
   * What a string field writes when typing pauses, through the same path.
   * Answers the new patch's id.
   */
  edit(module: AnyModule, fieldPath: string[], value: string): Promise<PatchId>;
  /**
   * Any patch, written the way a field writes it (`writePatch`, what
   * `useAddPatch` calls): one with `file` ops uploads its bytes first, through
   * the Studio's own upload (`XMLHttpRequest`, to where
   * `directFileUploadSettings` says). Answers the patch's id.
   */
  write(
    module: AnyModule,
    patch: Patch,
    fileType?: "image" | "file",
  ): Promise<PatchId>;
  /** {@link write}, to a module named by its path (`useAddModuleFilePatch`'s shape). */
  writeAt(
    moduleFilePath: ModuleFilePath,
    patch: Patch,
    fileType?: "image" | "file",
  ): Promise<PatchId>;
  /** Discard patches, as Review's "Discard" does (`System.discard`). */
  discard(patchIds: PatchId[]): ReturnType<System["discard"]>;
  /**
   * Publish, as the Publish button does (`System.publish`): every patch in
   * the chain when `patchIds` is not given.
   */
  publish(patchIds?: PatchId[]): Promise<PublishResult>;
  /** The Studio's `/stat` poll: what it last took in. */
  readonly stat: StatState;
  /**
   * New code reaches the Studio: what `ValStoreProvider` does when the app's
   * `<ValModulesClient>` registers a new registry (`val-modules-updated`):
   * `loadValModules`, then `HostStore.receive`.
   */
  receiveCode(modules: AnyModule[]): Promise<void>;
  /**
   * A registry reaches the Studio, as `<ValModulesClient>` registers one: for
   * a registry whose modules are not all plain (a `def` that rejects, as a
   * module whose code throws does). {@link receiveCode} is this, for modules.
   */
  receiveRegistry(registry: ValModules): Promise<void>;
  /** The messages the Studio is showing the editor (`StatusStore`). */
  errors(): string[];
  /** The work the Studio's stores record (`activity.ts`), counted. */
  work: RecordingActivity;
  /**
   * The work done since `since` (a `work.position()`), against a budget:
   * a failure lists every kind that went over, with its count.
   */
  expectWork(since: number, budget: WorkBudget): void;
  /** A surface: the Studio's own value at a field, as a field reads it. */
  reads(surface: string, module: AnyModule, fieldPath: string[]): void;
};

/** At most, or exactly, this many of a kind of work. */
export type WorkBudget = Partial<
  Record<WorkKind, { atMost: number } | { exactly: number }>
>;

export type Page = {
  route: string;
  /** A surface: something the page reads on the server (a loader). */
  reads(surface: string, read: (val: PageReaders) => Promise<unknown>): void;
};

/** What a deploy leaves behind: the build that answered until now, and the new one. */
export type Deployment = { previous: Handler; current: Handler };

export type PageLoadOptions = {
  /**
   * The modules the page's BROWSER bundle carries. The server's when not
   * given; an older set models a browser running the previous build's
   * client code (a cached `/_app/app.js`).
   */
  clientModules?: AnyModule[];
  /**
   * What the page shows through its hooks, each a surface: a field of what
   * `useVal(module)` gives back, or of one `.jsonValues()` entry through
   * `useValKey(module, key)`, or of a route's entry through
   * `useValRoute(module, params)`.
   */
  shows: PageShow[];
  /**
   * What the page shows from its LOADERS: a field read on the server with
   * `fetchVal`, at the server render and again every time the page's refresh
   * loop (`startRefreshLoop`, as `ValTanStackProvider` runs it) re-runs them.
   */
  loaderShows?: Array<{ surface: string; module: AnyModule; field: string[] }>;
  /**
   * Whether the page passes `<ValProvider draft>` (TanStack's server-read
   * draft). Default `true`; without it the server renders and the browser
   * hydrates the bundle, and draft mode is unknown until `/draft/stat`.
   */
  draftProp?: boolean;
  /**
   * What happens between the page's server render (and hydration) and its
   * overlay connecting: another tab discarding the draft the page was
   * rendered with, say (S28).
   */
  beforeOverlay?: () => Promise<void>;
  /** `<ValProvider suspend>`: the hooks may wait for the draft (S24). */
  suspend?: boolean;
};

/** A read a hook suspended on, instead of showing a value. */
export type PageSuspension = { surface: string; step: string };

export type PageShow = {
  surface: string;
  module: AnyModule;
  field: string[];
  via?: { useValKey: string } | { useValRoute: Record<string, string> };
};

export type LoadedPage = {
  /** The overlay's Studio. */
  studio: Studio;
  /** Everything the overlay sent the page, in order. */
  events: OverlayEvent[];
  /** How many times the refresh loop has re-run the loaders. */
  readonly refreshes: number;
  /** When (on the world's clock) each of those refreshes was asked for. */
  readonly refreshTimes: readonly number[];
  /**
   * Every read a hook suspended on, at the step of the page's load it was
   * at: `server render`, `hydration`, `overlay mounted`, `draft mode known`,
   * `synced`, `relayed`, `hot reload`.
   */
  readonly suspensions: readonly PageSuspension[];
};

export type PageReaders = {
  /** The real `fetchVal` of `@valbuild/tanstack/server`, with edit tags removed. */
  fetchVal<T extends Resolvable>(module: T): Promise<DecodeVal<ResolvedVal<T>>>;
  /** The real `fetchValKey`: one `.jsonValues()` entry. Edit tags removed. */
  fetchValKey(module: ResolvableModule, key: string): Promise<unknown>;
  /** The real `fetchValRoute`: a router's entry for these params. Edit tags removed. */
  fetchValRoute(
    module: ResolvableModule,
    params: Record<string, string>,
  ): Promise<unknown>;
};

type AnyModule = ValModule<SelectorSource>;

export type WorldOptions = {
  config: ValConfig;
  modules: AnyModule[];
  /**
   * Where pending edits live, as an app's server decides it:
   * - `memory`: the host holds the source and the patches (`sourceFiles`, a
   *   patch store passed to both `initValServer` and `initValContent`).
   * - `fs`: local development. The project is the working directory
   *   (`initHandlerOptions` reads `process.cwd()`), so the world makes a
   *   fresh temporary directory and works in it for its lifetime; patches
   *   land in its `.val/patches`, where both the API and the readers find
   *   them, as in an app.
   * - `http`: a deployed app. Patches live on Val's content service, here the
   *   mock content host in this process (`contentHost.ts`), reached over
   *   real HTTP; the API and the readers are given the same `http` options
   *   (credentials, `valContentUrl`, the content version and the proposal),
   *   as an app passes one `ValHttpMode` to both. Every request carries a
   *   signed session cookie, as a signed-in editor's browser does.
   */
  server: ServerMode;
  /**
   * http only: the content version the platform hands the build
   * (`VAL_CONTENT`, read by `contentFromEnv`): the site's content when it is
   * newer than what the bundle holds.
   */
  contentVersion?: ValContentVersion;
  /**
   * http only: the proposal whose address the build serves (`VAL_PROPOSAL`,
   * `VAL_BRANCH`, `VAL_OVERLAY`, read by `proposalFromEnv`). `{ open }`
   * opens a new one on the content host first, as New proposal does on the
   * site (`createProposalsClient().create`, through the site's build), and
   * serves its address: then `world.proposal` is how it is driven.
   */
  proposal?: ValProposal | { open: string };
  /**
   * The `.val.ts` text of modules, for what reads it: a publish rewrites it.
   * Written into the project directory in fs mode and handed over as
   * `sourceFiles` in memory mode, as an app's host would.
   */
  sourceText?: Record<string, string>;
};

export type ServerMode = "memory" | "fs" | "http";

/** What an app passes to both `initValServer` and `initValContent` for a mode. */
type ServerHost =
  | {
      mode: "memory";
      sourceFiles: Record<string, string>;
      patchStore: InMemoryPatchStore;
      unsafelyAllowUnauthenticated: true;
    }
  | { mode: "fs"; root: string; restore: () => void }
  | {
      mode: "http";
      contentHost: ContentHost;
      http: HttpOptions;
      /** The `val_session` cookie a signed-in editor's browser sends. */
      cookie: string;
    };

/** `ValHttpMode`, as `initValServer` and `initValContent` both take it. */
type HttpOptions = {
  apiKey: string;
  valSecret: string;
  gitCommit: string;
  gitBranch: string;
  valContentUrl: string;
  contentVersion?: ValContentVersion;
  proposal?: ValProposal;
  projectSource?: Record<string, string>;
};

/** What session cookies are signed with: the app's `VAL_SECRET`. */
const VAL_SECRET = "scenario-secret";

async function hostFor(
  options: WorldOptions,
  sourceText: Record<string, string>,
): Promise<ServerHost> {
  const mode = options.server;
  if (mode === "http") {
    const contentHost = await startContentHost(sourceText);
    const [org, project] = contentHost.project.split("/");
    // As `e2e/http/httpMode.ts` mints one: the login round trip goes to
    // admin.val.build, which is not what these scenarios are about. The
    // profile is one the mock knows, so a patch has an author.
    const token = encodeJwt(
      {
        sub: "profile-ada",
        exp: getExpire(),
        token: "scenario-val-build-token",
        org,
        project,
      },
      VAL_SECRET,
    );
    return {
      mode,
      contentHost,
      cookie: `${Internal.VAL_SESSION_COOKIE}=${encodeURIComponent(token)}`,
      http: {
        apiKey: contentHost.apiKey,
        valSecret: VAL_SECRET,
        gitCommit: contentHost.initialCommit,
        gitBranch: contentHost.branch,
        valContentUrl: contentHost.url,
        ...(options.contentVersion !== undefined
          ? { contentVersion: options.contentVersion }
          : {}),
        ...(options.proposal !== undefined && !("open" in options.proposal)
          ? { proposal: options.proposal }
          : {}),
        /*
         * The platform builds a proposal's address itself and embeds the
         * project's source in the build, which is where a save there reads
         * the `.val.ts` text it patches (under the proposal's own files).
         */
        ...(options.proposal !== undefined
          ? {
              projectSource: Object.fromEntries(
                Object.entries(sourceText).map(([path, text]) => [
                  path.replace(/^\/+/, ""),
                  text,
                ]),
              ),
            }
          : {}),
      },
    };
  }
  if (mode === "memory") {
    return {
      mode,
      sourceFiles: Object.fromEntries(
        Object.entries(sourceText).map(([path, text]) => [
          path.replace(/^\//, ""),
          text,
        ]),
      ),
      patchStore: new InMemoryPatchStore(),
      unsafelyAllowUnauthenticated: true,
    };
  }
  const root = mkdtempSync(join(tmpdir(), "val-scenario-"));
  for (const [path, text] of Object.entries(sourceText)) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  const previous = process.cwd();
  process.chdir(root);
  return {
    mode,
    root,
    restore: () => {
      process.chdir(previous);
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/** The options both server-side entry points get, for the host's mode. */
function hostOptions(host: ServerHost): {
  sourceFiles?: Record<string, string>;
  patchStore?: InMemoryPatchStore;
  unsafelyAllowUnauthenticated?: boolean;
  http?: HttpOptions;
} {
  if (host.mode === "memory") {
    return {
      sourceFiles: host.sourceFiles,
      patchStore: host.patchStore,
      unsafelyAllowUnauthenticated: host.unsafelyAllowUnauthenticated,
    };
  }
  if (host.mode === "http") {
    // The SAME object for both, as the bindings ask.
    return { http: host.http };
  }
  return {};
}

/**
 * The config the app's server is given: in http mode it names the project,
 * as `val.config.ts`'s `project` does in a deployed app.
 */
function hostConfig(host: ServerHost, config: ValConfig): ValConfig {
  return host.mode === "http"
    ? { ...config, project: host.contentHost.project }
    : config;
}

/** A browser's `fetch`, sending the session cookie it holds (http mode). */
function withSession(
  host: ServerHost,
  send: (input: string, init: RequestInit) => Promise<Response>,
): (input: string, init: RequestInit) => Promise<Response> {
  if (host.mode !== "http") return send;
  return (input, init) => {
    const headers = new Headers(init.headers);
    headers.set("cookie", host.cookie);
    return send(input, { ...init, headers });
  };
}

/**
 * The browser's upload, which in http mode goes straight to the content
 * service (`direct-file-upload-settings` answers its url, with a nonce), not
 * through the app: over real HTTP to the mock, as the browser would.
 */
function toContentHost(
  host: ServerHost,
  send: (input: string, init: RequestInit) => Promise<Response>,
): (input: string, init: RequestInit) => Promise<Response> {
  if (host.mode !== "http") return send;
  const origin = host.contentHost.url;
  return (input, init) =>
    input.startsWith(origin) ? fetch(input, init) : send(input, init);
}

/**
 * The socket's url, on the port this world's content host listens on: the
 * mock names the port it was imported with, and listens on a new one per
 * world (see `contentHost.ts`).
 */
function socketUrl(host: ServerHost, url: string): string {
  if (host.mode !== "http") return url;
  const target = new URL(url);
  target.host = new URL(host.contentHost.url).host;
  return target.href;
}

/** A request for a page, as the browser sends it: with its cookies. */
function pageRequest(host: ServerHost, route: string): Request {
  return new Request(new URL(route, "http://localhost").href, {
    headers: host.mode === "http" ? { cookie: host.cookie } : {},
  });
}

/** A JSON object, as the content host's control plane answers. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isObject(value)) throw new Error("not an object of strings");
  const out: Record<string, string> = {};
  for (const [key, text] of Object.entries(value)) {
    if (typeof text !== "string") throw new Error(`${key} is not a string`);
    out[key] = text;
  }
  return out;
}

function stringOrNull(value: unknown): string | null {
  if (value === null || typeof value === "string") return value;
  throw new Error("not a string or null");
}

/** The overlay the platform holds for a proposal's address: a `ValProposal`. */
function parseProposalOverlay(body: unknown): ValProposal {
  if (
    !isObject(body) ||
    typeof body.name !== "string" ||
    typeof body.branch !== "string" ||
    !isObject(body.modules)
  ) {
    throw new Error("not a proposal overlay");
  }
  return {
    name: body.name,
    branch: body.branch,
    commit: stringOrNull(body.commit),
    modules: body.modules,
    files: stringRecord(body.files),
  };
}

/** The site's content version, as the platform would hand it to an isolate now. */
function parseContentVersion(body: unknown): ValContentVersion {
  if (
    !isObject(body) ||
    typeof body.id !== "string" ||
    !isObject(body.modules)
  ) {
    throw new Error("not a content version");
  }
  return {
    id: body.id,
    job: stringOrNull(body.job),
    commit: stringOrNull(body.commit),
    modules: body.modules,
    files: stringRecord(body.files),
  };
}

/**
 * What the platform hands a site isolate (`VAL_CONTENT`): the content the
 * site's publishes made since the bundle, or none while there is none.
 */
async function siteContentVersion(
  contentHost: ContentHost,
): Promise<ValContentVersion | undefined> {
  const res = await fetch(`${contentHost.url}/__test__/content-version`);
  if (!res.ok) throw new Error(`No content version: ${res.status}`);
  const version = parseContentVersion(await res.json());
  return Object.keys(version.modules).length === 0 &&
    Object.keys(version.files).length === 0
    ? undefined
    : version;
}

/** A world's `fetch` for a sender, in the shape a product client takes. */
function asFetch(
  send: (input: string, init: RequestInit) => Promise<Response>,
): typeof fetch {
  return (input, init) =>
    send(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
      init ?? {},
    );
}

export async function createWorld(options: WorldOptions): Promise<World> {
  const registryOf = (modules: AnyModule[]): ValModules => ({
    config: options.config,
    modules: modules.map((module) => ({
      def: () => Promise.resolve({ default: module }),
    })),
  });
  let valModules = registryOf(options.modules);
  // One place for pending edits, shared by the API and the readers -- as an
  // app passes the same options to `initValServer` and `initValContent`.
  const host = await hostFor(options, options.sourceText ?? {});
  const serverConfig = hostConfig(host, options.config);
  const apiDraftMode = { on: true };
  if (host.mode === "http" && host.http.proposal !== undefined) {
    // A proposal handed over whole exists on content already, with its saves.
    const seeded = await fetch(`${host.contentHost.url}/__test__/proposals`, {
      method: "POST",
      body: JSON.stringify(host.http.proposal),
    });
    if (!seeded.ok)
      throw new Error(`could not seed the proposal: ${seeded.status}`);
  }
  /** The site's http options in a world at a proposal's address. */
  const siteHttp = host.mode === "http" ? { ...host.http } : null;
  if (
    host.mode === "http" &&
    options.proposal !== undefined &&
    "open" in options.proposal
  ) {
    // A project with proposals turned on: a setting on content, off by default.
    await fetch(`${host.contentHost.url}/__test__/proposals-enabled`, {
      method: "POST",
      body: JSON.stringify({ enabled: true }),
    });
    // New proposal, pressed in a Studio on the site: through the site's build.
    const site = initValServer(valModules, serverConfig, {
      http: host.http,
      draftMode: draftModeOf(apiDraftMode),
    }).valApiHandler;
    const opened = await createProposalsClient({
      api: "/api/val",
      fetchImpl: asFetch(
        withSession(host, (input, init) =>
          site(new Request(new URL(input, "http://localhost").href, init)),
        ),
      ),
    }).create({ displayName: options.proposal.open, requestId: randomUUID() });
    host.http = {
      ...host.http,
      proposal: {
        name: opened.name,
        branch: opened.branch,
        commit: null,
        modules: {},
        files: {},
      },
    };
  }
  const serverFor = (registry: ValModules) =>
    withStaticFiles(
      host,
      initValServer(registry, serverConfig, {
        ...hostOptions(host),
        draftMode: draftModeOf(apiDraftMode),
      }).valApiHandler,
    );
  let serverModules = options.modules;
  let currentHandler = serverFor(valModules);
  const network = createNetwork(currentHandler);
  let builds = 1;
  network.name(currentHandler, `build ${builds}`);
  const pages: Array<() => void> = [];
  /**
   * http: the new builds the platform has reported live to the content
   * service and the service has not answered yet. A deployed app's build
   * does not count itself (`seq` is the content service's `headVersion`):
   * the platform, or GitHub, tells the service that it went live, and the
   * service moves the branch's chain version once for it (valbuild/home,
   * `patches.countDeploymentLive`). An edge, so it is the world that reports
   * it, as the platform would; waited for by {@link changeCode},
   * {@link settle} and {@link manifest}.
   */
  let reportingLive: Promise<void> = Promise.resolve();
  const reportLive = (build: string) => {
    if (host.mode !== "http") return;
    const url = `${host.contentHost.url}/__test__/deployment`;
    // At a proposal's address the build serves the proposal's branch.
    const branch = host.http.proposal?.branch ?? host.contentHost.branch;
    reportingLive = reportingLive.then(async () => {
      const res = await fetch(url, {
        method: "POST",
        body: JSON.stringify({
          deploymentId: build,
          deploymentState: "success",
          branch,
        }),
      });
      if (!res.ok) {
        throw new Error(`The content host refused ${build}: ${res.status}`);
      }
    });
  };
  const deployCode = (modules: AnyModule[]): Deployment => {
    // The app's own code is evaluated again too: where a scenario names a
    // module by the object it wrote, the app now holds the new build's
    // object at that path (`currentModule`).
    for (const module of modules) {
      const previous = moduleAt(serverModules, moduleFilePathOf(module));
      if (previous !== null && previous !== module)
        replaceModule(previous, module);
    }
    serverModules = modules;
    valModules = registryOf(modules);
    const previous = currentHandler;
    currentHandler = serverFor(valModules);
    network.name(currentHandler, `build ${++builds}`);
    network.route(currentHandler);
    reportLive(`build ${builds}`);
    for (const reload of pages) reload();
    return { previous, current: currentHandler };
  };
  /** Loaded pages that follow the server's code, re-read after a dev reload. */
  const hotPages: Array<(modules: AnyModule[]) => Promise<void>> = [];
  /**
   * What the dev server does after a publish rewrote the project's files: the
   * bundler sees them change and re-evaluates them, so the app's server and
   * every page's readers (`deployCode`), the Studio (`receiveCode`, as
   * `<ValModulesClient>` re-registers) and the page in the browser get modules
   * evaluated from the NEW files.
   *
   * The bundler's hot reload is outside Val, an edge; the evaluation is Val's
   * own evaluator of project files, `loadValModules` from `@valbuild/server`
   * (what `val validate` runs), over the world's project directory. Only the
   * modules the world has as files are re-evaluated; the rest keep their code,
   * as files that did not change do in a dev server.
   */
  const devReload = async (): Promise<void> => {
    if (host.mode !== "fs") return;
    const textBacked = Object.keys(options.sourceText ?? {}).filter((path) =>
      path.endsWith(".val.ts"),
    );
    if (textBacked.length === 0) return;
    writeProjectShell(host.root, textBacked);
    const registry = evaluateProject(host.root);
    const evaluated = new Map<string, AnyModule>();
    for (const entry of registry.modules) {
      const module = (await entry.def()).default;
      evaluated.set(String(Internal.getValPath(module)), module);
    }
    const next = serverModules.map(
      (module) => evaluated.get(String(Internal.getValPath(module))) ?? module,
    );
    deployCode(next);
    for (const { studio } of studios) {
      await studio.receiveCode(next);
    }
    for (const reload of hotPages) {
      await reload(next);
    }
  };
  /**
   * Which module object a dev reload put in place of which: the scenario
   * names a module by the object it wrote, and after a reload the app's own
   * (reloaded) code holds the new build's object for it.
   */
  const reloadedAs = new Map<unknown, AnyModule>();
  const replaceModule = (module: AnyModule, replacement: AnyModule) => {
    reloadedAs.set(module, replacement);
    // A module the scenario wrote may have been replaced before.
    for (const [original, current] of reloadedAs) {
      if (current === module) reloadedAs.set(original, replacement);
    }
  };
  const currentModule = <T>(module: T): T => sameModuleAs(reloadedAs, module);
  /** The readers a page's server uses, for the server's current code. */
  const readersFor = (draft: { on: boolean }) =>
    initValContent(serverConfig, valModules, {
      ...hostOptions(host),
      draftMode: draftModeOf(draft),
    });
  const relays: Array<() => void> = [];
  const refreshLoops: RefreshLoop[] = [];
  const frames = createFrames();
  const surfaces: Array<{
    name: string;
    read: () => Promise<{ value: unknown; versions?: FrameVersions }>;
  }> = [];
  /*
   * Versions the WORLD hashes to observe (a Studio's version, a bundle's),
   * kept apart from what Val's code hashes, which is what a budget counts.
   */
  const versioning = createVersioning();
  /*
   * What the page's server readers read during one page read: requests do
   * not nest (`inRequest`), so one list at a time is enough. Each reader the
   * world calls says what it read itself (`readsOfFetchVal`: the read behind
   * the public `fetchVal`, which only drops them).
   */
  let collecting: ReadOf[] | null = null;
  const fetchValReading = async <T extends Resolvable>(
    content: { fetchValStega: object },
    module: T,
  ): Promise<ResolvedVal<T>> => {
    const withReads = readsOfFetchVal(content.fetchValStega);
    if (withReads === null) {
      throw new Error("This fetchVal does not say what it read.");
    }
    const { value, reads } = await withReads(module);
    collecting?.push(...reads);
    return value;
  };
  /** `fetchValDraft`, with what it read: `readsOfFetchValDraft`. */
  const fetchValDraftReading = (content: {
    fetchValDraft: object;
  }): Promise<Ready<ValDraft | null>> => {
    const withReads = readsOfFetchValDraft(content.fetchValDraft);
    if (withReads === null) {
      throw new Error("This fetchValDraft does not say what it read.");
    }
    return withReads();
  };
  const withReads = async <T>(
    fn: () => Promise<T>,
  ): Promise<{ value: T; reads: ReadOf[] }> => {
    const reads: ReadOf[] = [];
    const outer = collecting;
    collecting = reads;
    try {
      return { value: await fn(), reads };
    } finally {
      collecting = outer;
    }
  };
  /**
   * What a page's server read shows each module at: the version its source
   * carried, the bundle's (the world hashes the module the server runs), or
   * none for a snapshot. `readWith` is the schema of the module object the
   * app's code passed, else the server's.
   */
  const versionsOfReads = (
    reads: readonly ReadOf[],
    passed: ReadonlyMap<ModuleFilePath, AnyModule>,
  ): FrameVersions => {
    const versions: FrameVersions = {};
    for (const read of reads) {
      const own = passed.get(read.path) ?? moduleAt(serverModules, read.path);
      versions[read.path] = {
        from: read.from,
        version:
          read.from === "server-draft"
            ? read.version
            : read.from === "bundle" && own !== null
              ? versioning.bundle(own)
              : null,
        readWith: own === null ? null : versioning.schemaOfModule(own),
      };
    }
    return versions;
  };
  const clock = startFakeClock();
  // The browser's upload: through the same network as everything else.
  const uninstallXhr = installXmlHttpRequest(
    toContentHost(host, withSession(host, network.fetchFor("browser:xhr"))),
  );
  const studios: Array<{
    studio: Studio;
    stop: () => void;
    polling: Promise<void>;
    /** Messages its socket has brought (http mode), for `settle`. */
    socketMessages: () => number;
  }> = [];
  /**
   * The world's counted work, Val's server's alone: the engine and the
   * hashing count per process, and since phase 5 a Studio applies patches
   * and computes versions in this process too -- so what each Studio says it
   * did (its own `version:hash`, `source:apply-patch` and
   * `engine:clone-bytes`) is left out here, and budgeted with
   * `studio.expectWork`.
   */
  const serverWork = (): WorldWorkPosition => {
    let hashes = 0;
    let applies = 0;
    let cloneBytes = 0;
    for (const { studio } of studios) {
      hashes += studio.work.total("version:hash");
      applies += studio.work.count("source:apply-patch");
      cloneBytes += studio.work.total("engine:clone-bytes");
    }
    const engine = engineWork();
    const reads = readWork();
    return {
      versionHashes: versioning.productHashes() - hashes,
      engineApplies: engine.applyPatch - applies,
      engineCloneBytes: engine.cloneBytes - cloneBytes,
      readResolves: reads.resolve,
      readEncodes: reads.encode,
    };
  };

  /** What has to stay the same for the world to count as quiet. */
  const signature = () =>
    JSON.stringify([
      network.log.map((exchange) => exchange.status),
      studios.map(({ studio, socketMessages }) => [
        "data" in studio.stat ? studio.stat.data?.patches : null,
        studio.system.patchSync.currentState().status,
        socketMessages(),
      ]),
    ]);

  /**
   * A Studio, as `ValStoreProvider` starts one: a system on the real client,
   * the modules in (with the base the page serves, when it serves one), then
   * the /stat poll. `beforeIntake` runs what mounts beside the provider, such
   * as the overlay's relay.
   */
  const startStudio = async (
    name: string,
    registry: ValModules,
    options: {
      base?: Record<ModuleFilePath, Json>;
      beforeIntake?: (system: System) => void;
    } = {},
  ): Promise<Studio> => {
    const client = createValClient("/api/val", null, {
      fetch: withSession(host, network.fetchFor(`studio:${name}`)),
    });
    const validator = new SchemaValidator();
    let seq = 0;
    const work = new RecordingActivity(() => ++seq);
    const system = createValSystem(client, {
      activity: work,
      writes: true,
      mode: host.mode === "http" ? "http" : "fs",
      uploadSettings: () => directFileUploadSettings(client),
      schemaValidation: {
        validate: async (moduleFilePath, source, serializedSchema, version) =>
          validator.validate(moduleFilePath, source, serializedSchema, version),
      },
    });
    options.beforeIntake?.(system);
    // Intake, then /stat: the order `ValStoreProvider` uses. With the base the
    // page serves, where it is not the bundle's (`window.__VAL_BASE__`).
    system.host.receive(await loadValModules(registry), options.base);

    // The Studio's /stat poll: what is asked (`requestStat`), what an answer
    // does to it (`statStateAfterAnswer`) and when it asks again
    // (`statWait`) are the hook's own functions; the answer reaches the
    // stores through `statSnapshotOf`, as `ValStoreProvider` hands it on.
    // What is left here is only the loop that strings them together, which
    // in the Studio is a React effect. fs and memory long-poll; http answers
    // `use-websocket`, and the Studio opens the content service's socket.
    let stat: StatState = { status: "not-asked" };
    let socket: WebSocket | null = null;
    let socketMessages = 0;
    const connectionId = randomUUID();
    // What `execStat` does with a `use-websocket` answer: open the socket,
    // subscribe with the nonce, and take each message in through the hook's
    // own `parseSocketMessage` and `statStateAfterSocketMessage`.
    let subscribed: Promise<void> | null = null;
    const openSocket = (url: string, nonce: string) => {
      socket?.close();
      const opened = new WebSocket(socketUrl(host, url));
      socket = opened;
      subscribed = new Promise<void>((resolve) => {
        opened.on("message", (data) => {
          if (parseSocketMessage(String(data))?.type === "subscribed") {
            resolve();
          }
        });
      });
      opened.on("open", () => {
        opened.send(JSON.stringify({ nonce, type: "subscribe", connectionId }));
      });
      opened.on("message", (data) => {
        const message = parseSocketMessage(String(data));
        if (message === null) return;
        socketMessages++;
        const next = statStateAfterSocketMessage(stat, message, Date.now());
        if (next === null) return;
        stat = next;
        if ("data" in stat && stat.data) {
          system.stat.receiveStat(statSnapshotOf(stat.data));
        }
      });
    };
    let stopped = false;
    // Wakes the poll's wait when the Studio stops: with a socket's interval
    // (http mode) that wait is twenty minutes, as the hook's timer is until
    // the component unmounts.
    let wake: (() => void) | null = null;
    const ask = async () => {
      const res = await requestStat(client, stat);
      const next = statStateAfterAnswer(stat, res, socket !== null, Date.now());
      if (next === null) {
        throw new Error(`/stat answered ${res.status}`);
      }
      stat = next;
      if ("data" in stat && stat.data) {
        system.stat.receiveStat(statSnapshotOf(stat.data));
      }
      if (res.status === 200 && res.json.type === "use-websocket") {
        openSocket(res.json.url, res.json.nonce);
      }
    };
    await ask();
    // A Studio is ready once its socket is subscribed: the content service
    // sends a change only to the sockets subscribed when it happens, so an
    // edit made before that is not heard until the next `/stat`, twenty
    // minutes on. The Playwright harness waits for the same thing
    // (`openHttpStudio`). Real I/O, so a real-time bound.
    if (subscribed !== null) {
      const bound = new AbortController();
      try {
        await Promise.race([
          subscribed,
          realSleep(SUBSCRIBE_MAX_MS, undefined, { signal: bound.signal }).then(
            () => {
              throw new Error(`studio ${name}: its socket never subscribed`);
            },
          ),
        ]);
      } finally {
        bound.abort();
      }
    }
    const polling = (async () => {
      while (!stopped) {
        const wait = statWait(stat, false, Date.now());
        if (wait === null) return;
        if (wait > 0) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, wait);
            wake = () => {
              clearTimeout(timer);
              resolve();
            };
          });
          wake = null;
        }
        if (stopped) return;
        try {
          await ask();
        } catch (error) {
          if (!stopped) throw error;
        }
      }
    })();

    /** The version this Studio shows a module at, with the seq of its last stat. */
    const studioFrameVersion = (
      moduleFilePath: ModuleFilePath,
    ): FrameVersion => {
      const seq = "data" in stat ? stat.data?.version?.seq : undefined;
      return {
        from: "studio",
        // The Studio's own (phase 5): the schema it holds, the base its
        // chain is applied to, and the chain of what applied, unconfirmed
        // patches included -- the server's version once confirmed.
        version: system.sourceStore.versionOf(moduleFilePath) ?? null,
        readWith: null,
        ...(seq !== undefined ? { seq } : {}),
      };
    };
    const studio: Studio = {
      name,
      system,
      async edit(module, fieldPath, value) {
        const [moduleFilePath, patchPath] = patchTarget(module, fieldPath);
        // What `useAddPatch` does for a field: the same call, the same
        // arguments, minus the field instance's id.
        const res = await system.patchStore.createPatch(
          moduleFilePath,
          stringFieldPatch(patchPath, value),
        );
        if (res.status !== "created") {
          throw new Error(`The edit was refused: ${res.message}`);
        }
        return res.record.patchId;
      },
      async write(module, patch, fileType) {
        return studio.writeAt(moduleFilePathOf(module), patch, fileType);
      },
      async writeAt(moduleFilePath, patch, fileType) {
        const res = await writePatch(system, moduleFilePath, patch, {
          ...(fileType !== undefined ? { fileType } : {}),
        });
        if (res.status === "error") {
          throw new Error(`The patch was refused: ${res.message}`);
        }
        return res.patchId;
      },
      discard(patchIds) {
        return system.discard(patchIds);
      },
      async publish(patchIds) {
        const result = await system.publish(
          patchIds ??
            system.patchStore.allRecords().map((record) => record.patchId),
        );
        // A publish in local development rewrites the files, and the dev
        // server reloads them.
        if (result.status === "published") await devReload();
        return result;
      },
      get stat() {
        return stat;
      },
      async receiveCode(modules) {
        system.host.receive(await loadValModules(registryOf(modules)));
      },
      async receiveRegistry(registry) {
        system.host.receive(await loadValModules(registry));
      },
      work,
      expectWork(since, budget) {
        const over: string[] = [];
        for (const [kind, limit] of Object.entries(budget)) {
          if (limit === undefined || !isWorkKind(kind)) continue;
          // An amount is summed; anything else is counted.
          const count = SUMMED_KINDS.has(kind)
            ? work.total(kind, { since })
            : work.count(kind, { since });
          const ok =
            "atMost" in limit ? count <= limit.atMost : count === limit.exactly;
          if (!ok) {
            over.push(
              `  ${kind}: ${count} (budget ${"atMost" in limit ? `at most ${limit.atMost}` : `exactly ${limit.exactly}`})`,
            );
          }
        }
        if (over.length > 0) {
          throw new Error(
            `✕ work over budget in studio "${name}":\n${over.join("\n")}\nAll work since: ${JSON.stringify(work.summary(since))}`,
          );
        }
      },
      errors() {
        return system.status.current().errors.map((error) => error.message);
      },
      reads(surface, module, fieldPath) {
        const path = sourcePathOf(module, fieldPath);
        const moduleFilePath = moduleFilePathOf(module);
        surfaces.push({
          name: surface,
          read: async () => {
            const read = await system.sourceStore.get(path, null);
            return {
              value: "data" in read ? read.data : `(${read.status})`,
              versions: {
                [moduleFilePath]: studioFrameVersion(moduleFilePath),
              },
            };
          },
        });
      },
    };
    studios.push({
      studio,
      stop: () => {
        stopped = true;
        wake?.();
        socket?.close();
      },
      socketMessages: () => socketMessages,
      polling,
    });
    return studio;
  };

  /** `world.proposal`: the proposal a world is at the address of. */
  const proposalAt = (): ProposalAt | null => {
    if (host.mode !== "http" || host.http.proposal === undefined) return null;
    const { name, branch } = host.http.proposal;
    const send = asFetch(
      withSession(host, network.fetchFor("studio:proposals")),
    );
    const client = createProposalsClient({ api: "/api/val", fetchImpl: send });
    const notWriteFiles = (): never => {
      throw new Error("write_files does not build, typecheck or offer");
    };
    const built: Record<string, string | null>[] = [];
    return {
      name,
      branch,
      client,
      stage: (files, message) =>
        runCodeTool(
          "write_files",
          { files, ...(message !== undefined ? { message } : {}) },
          {
            proposal: { name },
            client,
            siteSource: async () => null,
            build: {
              start: notWriteFiles,
              running: () => null,
              report: notWriteFiles,
              cancel: () => false,
            },
            typecheck: notWriteFiles,
            offerProposal: notWriteFiles,
            // As the Studio's assistant asks it (`useAI`): no names here.
            codeMode: () => readCodeMode(client, name, () => null),
          },
        ),
      codeMode: (on) => client.setCodeMode(name, on),
      commit: (message) => commitProposal(client, name, message),
      async someonePushes(push) {
        const res = await fetch(
          `${host.contentHost.url}/__test__/proposals/${name}/push`,
          {
            method: "POST",
            body: JSON.stringify({
              author: { name: push.author },
              message: push.message,
              ...(push.files !== undefined ? { files: push.files } : {}),
            }),
          },
        );
        if (!res.ok) throw new Error(`Could not push: ${res.status}`);
        const answer: unknown = await res.json();
        if (
          typeof answer !== "object" ||
          answer === null ||
          !("sha" in answer) ||
          typeof answer.sha !== "string"
        ) {
          throw new Error("The push answered no sha");
        }
        return answer.sha;
      },
      buildOnTheirPush: (sha) => buildOnTheirPush(client, name, sha),
      built,
      build: () =>
        buildProposal({
          name,
          client,
          canBuildHere: () => true,
          deploy: async (files) => {
            built.push(files);
            return { status: "uploaded", publishId: randomUUID() };
          },
        }),
      async redeploy() {
        const res = await fetch(
          `${host.contentHost.url}/__test__/proposals/${name}/overlay`,
        );
        if (!res.ok) throw new Error(`No overlay for ${name}: ${res.status}`);
        const overlay = parseProposalOverlay(await res.json());
        host.http = { ...host.http, proposal: overlay };
        deployCode(serverModules);
      },
      merge: (commitMessage) =>
        createStudioJobClient({ api: "/api/val", fetchImpl: send }).pressMerge(
          name,
          randomUUID(),
          "scenario-tab",
          undefined,
          commitMessage,
        ),
    };
  };
  const proposal = proposalAt();
  async function readManifest(): Promise<Manifest>;
  async function readManifest(since: Manifest): Promise<Manifest | null>;
  async function readManifest(since?: Manifest): Promise<Manifest | null> {
    await reportingLive;
    const client = createValClient("/api/val", null, {
      fetch: withSession(host, network.fetchFor("world:manifest")),
    });
    const res = await client("/manifest", "GET", {
      headers: { "if-none-match": since?.tag },
      query: {
        since: since !== undefined ? String(since.project.seq) : undefined,
      },
    });
    if (since !== undefined && res.status === 304) return null;
    if (res.status !== 200) {
      throw new Error(`GET /manifest answered ${res.status}`);
    }
    return res.json;
  }
  return {
    server:
      host.mode === "fs"
        ? { mode: "fs", root: host.root }
        : host.mode === "http"
          ? { mode: "http", contentUrl: host.contentHost.url }
          : { mode: "memory" },
    network,
    frames,
    studio: (name) => startStudio(name, valModules),
    proposal,
    async loadPage(route, pageOptions) {
      const request = () => pageRequest(host, route);
      // The page's browser bundle: the server's code unless the scenario gives
      // it another build's, and then hot-reloaded with the server's when the
      // project's files change (`devReload`).
      let clientModules = pageOptions.clientModules ?? serverModules;
      const followsServer = pageOptions.clientModules === undefined;
      // The bundle's own entry imports, which a hook suspends on: started and
      // waited for here, before reading, for each build's modules -- what the
      // hook's first `React.use` of each would have waited for.
      for (const modules of [serverModules, clientModules]) {
        await loadBundledEntries(modules);
      }
      /**
       * What the page's store holds each module at: the server's draft as it
       * rendered, then what the overlay relayed. A module in neither is the
       * page's bundle (or a snapshot over it).
       */
      const held = new Map<ModuleFilePath, FrameVersion>();
      const suspensions: PageSuspension[] = [];
      /**
       * The provider's state, which is what the hooks read with
       * (`pageReadEnv`): `ValTanStackProvider` moves it through the steps
       * below, and a hook renders again when it moves (React re-renders a
       * context's readers when its value changes, and only then).
       */
      let state: PageReadState;
      let store: ValExternalStore;
      let modulesNow: AnyModule[];
      let step = "server render";
      const record = () => {
        const env = pageReadEnv({ ...state, store }, false);
        for (const show of pageOptions.shows) {
          const module = moduleLike(modulesNow, show.module);
          const read = readShow(module, show, env);
          if (read.status === "pending") {
            // The component suspends: it shows its boundary's fallback, not
            // a value.
            suspensions.push({ surface: show.surface, step });
            continue;
          }
          const versions: FrameVersions = {};
          for (const path of idsOf([module])) {
            const own = moduleAt(modulesNow, path);
            const readWith =
              own === null ? null : versioning.schemaOfModule(own);
            const from =
              read.reads.find((r) => r.path === path)?.from ?? "bundle";
            const kept = held.get(path);
            versions[path] =
              (from === "overlay" || from === "seeded") && kept !== undefined
                ? { ...kept, readWith }
                : from === "snapshot"
                  ? { from: "snapshot", version: null, readWith }
                  : {
                      from: "bundle",
                      version: own === null ? null : versioning.bundle(own),
                      readWith,
                    };
          }
          frames.record(show.surface, read.value, versions);
        }
        frames.tick();
      };
      /** The provider's next state: the hooks render again if it moved. */
      const moveTo = (next: PageReadState, at: string) => {
        const moved = (Object.keys(next) as (keyof PageReadState)[]).some(
          (key) => next[key] !== state[key],
        );
        state = next;
        step = at;
        if (moved) record();
      };
      // 1. The server renders the page: the layout's loader reads the draft
      //    (`fetchValDraft`) when the page passes the `draft` prop, and the
      //    provider seeds its store from it. Without it, draft mode is
      //    unknown until the browser asks.
      const withDraftProp = pageOptions.draftProp !== false;
      const { value: draft, reads: draftReads } = withDraftProp
        ? await inRequest(request(), () =>
            fetchValDraftReading(readersFor({ on: true })),
          )
        : { value: null, reads: [] };
      for (const read of draftReads) {
        held.set(read.path, {
          from: read.from,
          version: read.version,
          readWith: null,
        });
      }
      const initialState = (loaded: ValDraft | null): PageReadState => ({
        draftMode: isDraft(loaded) ? true : null,
        // `suspend` is switched on after hydration, never before.
        suspend: false,
        draftModeReady: undefined,
        draftSourcesSynced: isDraft(loaded),
        snapshot: loaded?.snapshot,
      });
      state = initialState(draft);
      store = createDraftStore(draft);
      modulesNow = serverModules;
      record();
      // The page's loaders, read on the server: at the server render, and
      // whenever the refresh loop re-runs them. One `initValContent` per page
      // server, made again on a deploy, as the server module is.
      let content = readersFor({ on: true });
      pages.push(() => {
        content = readersFor({ on: true });
      });
      const readLoaders = async () => {
        for (const show of pageOptions.loaderShows ?? []) {
          const module = currentModule(show.module);
          const { value, reads } = await withReads(() =>
            inRequest(request(), async () =>
              raw(await fetchValReading(content, module)),
            ),
          );
          frames.record(
            show.surface,
            fieldOf(value, show.field),
            versionsOfReads(
              reads,
              new Map([[moduleFilePathOf(module), module]]),
            ),
          );
        }
        if ((pageOptions.loaderShows ?? []).length > 0) frames.tick();
      };
      await readLoaders();
      // 2. The browser hydrates from the same draft, as loader data -- which
      //    is JSON on the way -- with its own client modules.
      const loaderData: ValDraft | null =
        draft === null ? null : JSON.parse(JSON.stringify(draft));
      store = createDraftStore(loaderData);
      modulesNow = clientModules;
      state = initialState(loaderData);
      step = "hydration";
      record();
      await pageOptions.beforeOverlay?.();
      // 3. The overlay mounts (the Val Enable cookie is there): the provider
      //    switches `suspend` on, if the page asked for it, with a promise
      //    for draft mode becoming known; then `/draft/stat` answers.
      let draftModeKnown = () => {};
      const draftModeReady =
        pageOptions.suspend === true
          ? new Promise<void>((resolve) => {
              draftModeKnown = resolve;
            })
          : undefined;
      moveTo(
        { ...state, suspend: pageOptions.suspend === true, draftModeReady },
        "overlay mounted",
      );
      draftModeKnown();
      moveTo({ ...state, draftMode: true }, "draft mode known");
      // 4. The overlay's Studio takes in the page's client modules with the
      //    base the page serves (`window.__VAL_BASE__`), and its relay hands
      //    the page's store what the Studio holds.
      const events: OverlayEvent[] = [];
      // The provider's refresh loop: the loaders re-run once per version the
      // Studio says the server has confirmed, with at most one in flight --
      // and never on the clock (`startRefreshLoop`, as both providers run it).
      const refreshTimes: number[] = [];
      const loop = startRefreshLoop({
        refresh: () => {
          refreshTimes.push(Date.now());
          return readLoaders();
        },
      });
      refreshLoops.push(loop);
      const studio = await startStudio(
        `overlay ${route}`,
        registryOf(clientModules),
        {
          base: isDraft(loaderData) ? loaderData.base : undefined,
          beforeIntake: (system) => {
            relays.push(
              startOverlayRelay(
                system,
                (event) => {
                  events.push(event);
                  if (event.type === "source-update") {
                    // What the overlay's Studio holds the module at, as it
                    // hands it over.
                    held.set(event.moduleFilePath, {
                      from: "overlay",
                      version:
                        event.read.status === "ready"
                          ? event.read.version
                          : null,
                      readWith: null,
                    });
                  }
                  const outcome = applyValEvent(store, event);
                  if (outcome.type === "synced") {
                    moveTo({ ...state, draftSourcesSynced: true }, "synced");
                  }
                  if (outcome.type === "confirmed") {
                    // Where the provider tells its loop.
                    loop.confirmed(outcome.seq);
                  }
                  if (outcome.type === "updated" && outcome.changed) {
                    step = "relayed";
                    record();
                    loop.changed();
                  }
                },
                // What the provider reports when the overlay connects: the
                // modules it was rendered with a draft of.
                { holds: () => draftHolds(loaderData) },
              ),
            );
          },
        },
      );
      if (followsServer) {
        hotPages.push(async (modules) => {
          clientModules = modules;
          await loadBundledEntries(modules);
          // The page re-renders with the new code.
          modulesNow = modules;
          step = "hot reload";
          record();
          await readLoaders();
        });
      }
      return {
        studio,
        events,
        suspensions,
        get refreshes() {
          return loop.refreshes;
        },
        refreshTimes,
      };
    },
    page(route, pageOptions) {
      const draft = { on: pageOptions.draftMode };
      const atSite = pageOptions.at === "site";
      if (atSite && siteHttp === null) {
        throw new Error("A page at the site is for a world in http mode.");
      }
      let version: ValContentVersion | undefined;
      const contentFor = (registry: ValModules) =>
        initValContent(serverConfig, registry, {
          ...(atSite && siteHttp !== null
            ? {
                http: {
                  ...siteHttp,
                  ...(version !== undefined ? { contentVersion: version } : {}),
                },
              }
            : hostOptions(host)),
          draftMode: draftModeOf(draft),
        });
      let content = contentFor(valModules);
      /** A site isolate gets the content version the platform holds now. */
      const refreshSite = async () => {
        if (!atSite || host.mode !== "http") return;
        const next = await siteContentVersion(host.contentHost);
        if (next?.id !== version?.id) {
          version = next;
          content = contentFor(valModules);
        }
      };
      pages.push(() => {
        content = contentFor(valModules);
      });
      /** The module objects the app's code passed, by path, in this read. */
      const passed = new Map<ModuleFilePath, AnyModule>();
      // The app's code reads the modules of the build it runs: after a
      // reload, the same module from the new build (`currentModule`).
      const readers: PageReaders = {
        async fetchVal(module) {
          const current: typeof module = currentModule(module);
          // A module itself, not a field of one: its schema is the module's.
          if (
            Internal.isValModule(current) &&
            String(Internal.getValPath(current)) === moduleFilePathOf(current)
          ) {
            passed.set(moduleFilePathOf(current), current);
          }
          return raw(await fetchValReading(content, current));
        },
        async fetchValKey(module, key) {
          return raw(
            await content.fetchValKeyStega(currentModule(module), key),
          );
        },
        async fetchValRoute(module, params) {
          return raw(
            await content.fetchValRouteStega(currentModule(module), params),
          );
        },
      };
      return {
        route,
        reads(surface, read) {
          surfaces.push({
            name: surface,
            read: async () => {
              await refreshSite();
              passed.clear();
              const { value, reads } = await withReads(() =>
                inRequest(pageRequest(host, route), () => read(readers)),
              );
              return { value, versions: versionsOfReads(reads, passed) };
            },
          });
        },
      };
    },
    async observe() {
      for (const surface of surfaces) {
        const { value, versions } = await surface.read();
        frames.record(surface.name, value, versions);
      }
      frames.tick();
    },
    expectInvariants() {
      frames.expectInvariants();
    },
    manifest: readManifest,
    workPosition: serverWork,
    expectWork(since, budget) {
      const over: string[] = [];
      const now = serverWork();
      const counts: Record<keyof WorldWorkBudget, number> = {
        "version:hash": now.versionHashes - since.versionHashes,
        "engine:apply-patch": now.engineApplies - since.engineApplies,
        "engine:clone-bytes": now.engineCloneBytes - since.engineCloneBytes,
        "read:resolve": now.readResolves - since.readResolves,
        "read:encode": now.readEncodes - since.readEncodes,
      };
      const kinds: (keyof WorldWorkBudget)[] = [
        "version:hash",
        "engine:apply-patch",
        "engine:clone-bytes",
        "read:resolve",
        "read:encode",
      ];
      for (const kind of kinds) {
        const limit = budget[kind];
        if (limit === undefined) continue;
        const count = counts[kind];
        const ok =
          "atMost" in limit ? count <= limit.atMost : count === limit.exactly;
        if (!ok) {
          over.push(
            `  ${kind}: ${count} (budget ${"atMost" in limit ? `at most ${limit.atMost}` : `exactly ${limit.exactly}`})`,
          );
        }
      }
      if (over.length > 0) {
        throw new Error(`✕ work over budget in the world:\n${over.join("\n")}`);
      }
    },
    clock,
    deployCode,
    async changeCode(modules, files) {
      const at = proposal;
      if (at !== null) {
        if (files === undefined) {
          throw new Error(
            "At a proposal's address code changes by a staging: give changeCode the files it writes.",
          );
        }
        const staged = await at.stage(files, "Change the code");
        if (staged.isError) {
          throw new Error(
            `write_files was refused: ${JSON.stringify(staged.result)}`,
          );
        }
        // The platform builds what is staged and serves it at the address.
        serverModules = modules;
        await at.redeploy();
      } else {
        deployCode(modules);
      }
      await reportingLive;
      for (const { studio } of studios) {
        await studio.receiveCode(modules);
      }
    },
    async settle() {
      await reportingLive;
      let quiet = 0;
      for (let round = 0; round < SETTLE_MAX_ROUNDS; round++) {
        const before = signature();
        // What the save loop does by itself after an edit; started rather
        // than awaited, because a retry waits on the clock this loop moves.
        for (const { studio } of studios) {
          void studio.system.patchSync.flush();
        }
        await clock.advance(SETTLE_STEP_MS);
        if (host.mode === "http") await drained(host.contentHost);
        quiet = signature() === before ? quiet + 1 : 0;
        if (quiet >= SETTLE_QUIET_ROUNDS) return;
      }
      throw new Error(
        `The world did not settle in ${(SETTLE_MAX_ROUNDS * SETTLE_STEP_MS) / 1000}s of its time. Last requests:\n${network.log
          .slice(-10)
          .map((e) => `  ${e.from} ${e.method} ${e.path} ${e.status}`)
          .join("\n")}`,
      );
    },
    async dispose() {
      // What a test held and did not let go of would hold the Studio's poll.
      network.release();
      for (const stop of relays) stop();
      for (const loop of refreshLoops) loop.stop();
      for (const { stop } of studios) stop();
      // A parked long poll ends when the server's own interval runs out.
      await clock.advance(LONG_POLL_MS);
      await Promise.all(studios.map(({ polling }) => polling));
      clock.stop();
      uninstallXhr();
      if (host.mode === "fs") host.restore();
      if (host.mode === "http") {
        // Whatever is still on its way to the app finishes first: its answer
        // needs the content service.
        await network.idle();
        await host.contentHost.stop();
      }
    },
  };
}

/** One step of `settle`: longer than fs mode's 250 ms look at the patch log. */
const SETTLE_STEP_MS = 300;
/** Quiet for this many steps in a row is quiet. */
const SETTLE_QUIET_ROUNDS = 3;
/** A minute of the world's time, past which something is spinning. */
const SETTLE_MAX_ROUNDS = 200;
/** The server's long poll, plus a margin (`ValOpsFS` / `ValOpsMemory`). */
const LONG_POLL_MS = 21_000;

/**
 * Until the app's server has had every call to the content service answered,
 * and has made no new one for a few real milliseconds: those calls are real
 * HTTP, so they finish in real time, not when the fake clock moves.
 */
async function drained(contentHost: ContentHost): Promise<void> {
  let idle = 0;
  for (let i = 0; i < DRAIN_MAX_MS && idle < 3; i++) {
    await realSleep(1);
    idle = contentHost.inFlight() === 0 ? idle + 1 : 0;
  }
}

/** Real time a Studio's socket has to subscribe in. */
const SUBSCRIBE_MAX_MS = 5000;

/** A real second: past it, a call to the content host is not coming back. */
const DRAIN_MAX_MS = 1000;

/** The kinds whose records carry an amount, which a budget sums. */
const SUMMED_KINDS: ReadonlySet<WorkKind> = new Set<WorkKind>([
  "engine:clone-bytes",
  "version:hash",
]);

/** Narrows a budget's key, which `Object.entries` widens to string. */
function isWorkKind(kind: string): kind is WorkKind {
  return kind.includes(":");
}

function draftModeOf(flag: { on: boolean }) {
  return {
    isEnabled: async () => flag.on,
    enable: async () => {
      flag.on = true;
    },
    disable: async () => {
      flag.on = false;
    },
  };
}

/** The module ids a read needs, as `useValStega` subscribes to them. */
function idsOf(modules: AnyModule[]): ModuleFilePath[] {
  const ids = new Set<ModuleFilePath>();
  for (const module of modules) {
    for (const id of getModuleIds(module)) {
      ids.add(id as ModuleFilePath);
    }
  }
  return [...ids];
}

/** The module in `modules` with the same path as `module`: the same module in another build. */
function moduleLike(modules: AnyModule[], module: AnyModule): AnyModule {
  const path = Internal.getValPath(module);
  const found = modules.find((m) => Internal.getValPath(m) === path);
  if (found === undefined) {
    throw new Error(`No module at ${String(path)} in this build`);
  }
  return found;
}

/**
 * What a hook gives back for one show, read the way the hook reads it --
 * `useVal`, `useValKey` or `useValRoute` -- with the page's env: the field
 * the show names, edit tags removed, or the wait the hook suspends on.
 */
function readShow(
  module: AnyModule,
  show: PageShow,
  env: ReadEnv,
): Resolution<unknown> {
  const via = show.via;
  const read: Resolution<unknown> =
    via === undefined
      ? resolveVal(module, env)
      : "useValKey" in via
        ? resolveModuleEntry(module, via.useValKey, env)
        : moduleRouteRead(module, via.useValRoute, env);
  return read.status === "ready"
    ? { ...read, value: fieldOf(raw(read.value), show.field) }
    : read;
}

/**
 * Every `.jsonValues()` entry the modules bundle, imported: what a hook's
 * `React.use` would wait for, done before reading, through the bundle's own
 * source (which keeps them, by build), so a read finds them there.
 */
async function loadBundledEntries(modules: AnyModule[]): Promise<void> {
  const env: ReadEnv = { sources: [], encode: false };
  for (const module of modules) {
    const source = Internal.getSource(module);
    if (typeof source !== "object" || source === null) continue;
    for (const [key, entry] of Object.entries(source)) {
      if (!Internal.isJson(entry)) continue;
      await awaitResolved((settled) =>
        resolveModuleEntry(module, key, env, { settled }),
      ).catch(() => undefined);
    }
  }
}

/** A field of a value read through a reader. */
function fieldOf(read: unknown, field: string[]): unknown {
  let value = read;
  for (const key of field) {
    value =
      typeof value === "object" && value !== null
        ? Object.entries(value).find(([k]) => k === key)?.[1]
        : undefined;
  }
  return value;
}

/** The source path of a field, built the way a module's fields are walked. */
function sourcePathOf(module: AnyModule, fieldPath: string[]): SourcePath {
  let path = Internal.getValPath(module);
  for (const key of fieldPath) {
    path = Internal.createValPathOfItem(path, key);
  }
  if (path === undefined) {
    throw new Error(
      `No source path for ${fieldPath.join(".")}: is the module defined with c.define?`,
    );
  }
  return path;
}

/** A module's file path. */
export function moduleFilePathOf(module: AnyModule): ModuleFilePath {
  const [moduleFilePath] = Internal.splitModuleFilePathAndModulePath(
    sourcePathOf(module, []),
  );
  return moduleFilePath;
}

/** Where a field's edit goes: its module, and its patch path, as `useAddPatch` computes it. */
function patchTarget(
  module: AnyModule,
  fieldPath: string[],
): [ModuleFilePath, string[]] {
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(sourcePathOf(module, fieldPath));
  return [moduleFilePath, Internal.createPatchPath(modulePath)];
}

/**
 * The files of a project that only its modules were written for: a
 * `tsconfig.json`, a `val.config.ts` (as the scenarios' own `initVal({})`), a `val.modules.ts`
 * naming the modules, and `@valbuild/core` where the project resolves its
 * packages, which an app's install would put there. Written once.
 */
function writeProjectShell(root: string, modulePaths: string[]): void {
  const config = join(root, "val.config.ts");
  if (!existsSync(config)) {
    writeFileSync(
      config,
      [
        `import { initVal, Internal } from "@valbuild/core";`,
        `export const { s, c, val, config } = initVal({});`,
        `export const tanstackRouter = Internal.tanstackRouter;`,
        ``,
      ].join("\n"),
    );
  }
  writeFileSync(
    join(root, "val.modules.ts"),
    [
      `import { modules } from "@valbuild/core";`,
      `import { config } from "./val.config";`,
      `export default modules(config, [`,
      ...modulePaths.map(
        (path) => `  { def: () => import(".${path.replace(/\.ts$/, "")}") },`,
      ),
      `]);`,
      ``,
    ].join("\n"),
  );
  const tsconfig = join(root, "tsconfig.json");
  if (!existsSync(tsconfig)) {
    writeFileSync(
      tsconfig,
      JSON.stringify({
        compilerOptions: {
          strict: true,
          module: "esnext",
          moduleResolution: "bundler",
          resolveJsonModule: true,
        },
      }),
    );
  }
  const core = join(root, "node_modules", "@valbuild", "core");
  if (!existsSync(core)) {
    mkdirSync(dirname(core), { recursive: true });
    symlinkSync(dirname(require.resolve("@valbuild/core/package.json")), core);
  }
}

/**
 * The app's own static files, beside Val's API: what the framework serves
 * from `public/` (a published local file's url is its path without
 * `/public`). An edge, like the network: it is the framework's, not Val's.
 * Memory mode has no disk, and its published files are remote.
 */
function withStaticFiles(host: ServerHost, api: Handler): Handler {
  if (host.mode !== "fs") return api;
  return async (request) => {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/api/val") || request.method !== "GET") {
      return api(request);
    }
    const file = join(host.root, "public", decodeURIComponent(pathname));
    if (!file.startsWith(join(host.root, "public")) || !existsSync(file)) {
      return new Response(null, { status: 404 });
    }
    return new Response(new Uint8Array(readFileSync(file)), { status: 200 });
  };
}

/**
 * The module object the app's code holds for `module`: what a dev reload put
 * in its place, or `module` itself when nothing did. Typed as the caller's,
 * because the reloaded object is the value the app's own reloaded code passes
 * where the scenario's code names the one it was written against.
 */
function sameModuleAs<T>(reloadedAs: Map<unknown, AnyModule>, module: T): T;
function sameModuleAs(
  reloadedAs: Map<unknown, AnyModule>,
  module: unknown,
): unknown {
  return reloadedAs.get(module) ?? module;
}

/** The module in `modules` at a path, or `null`: the same module in a build. */
function moduleAt(
  modules: readonly AnyModule[],
  path: ModuleFilePath,
): AnyModule | null {
  return (
    modules.find((module) => String(Internal.getValPath(module)) === path) ??
    null
  );
}

/**
 * The versions the world computes to OBSERVE what a surface shows: a bundle's
 * (from the module the reader runs) and the schema a reader's own code has --
 * a Studio computes its own since phase 5 (`SourceStore.versionOf`), and the
 * relay carries it. With the product's own functions (`schemaVersionOf`,
 * `baseVersionOf`), memoised by object so an
 * observation does not hash what it hashed before, and counted apart from
 * Val's own hashing, which is what `world.expectWork` budgets.
 */
function createVersioning() {
  let ownHashes = 0;
  const own = <T>(fn: () => T): T => {
    const before = versionHashCount();
    try {
      return fn();
    } finally {
      ownHashes += versionHashCount() - before;
    }
  };
  const schemas = new WeakMap<object, string>();
  const bases = new WeakMap<object, string>();
  const bundles = new WeakMap<object, ModuleVersion | null>();
  const baseOf = (source: unknown): string => {
    if (typeof source !== "object" || source === null) {
      return own(() => baseVersionOf(source));
    }
    const known = bases.get(source);
    if (known !== undefined) return known;
    const version = own(() => baseVersionOf(source));
    bases.set(source, version);
    return version;
  };
  const schemaOfModule = (module: AnyModule): string | null => {
    const schema = Internal.getSchema(module);
    if (schema === undefined) return null;
    const known = schemas.get(module);
    if (known !== undefined) return known;
    const version = own(() => schemaVersionOf(schema["executeSerialize"]()));
    schemas.set(module, version);
    return version;
  };
  return {
    /** How many hashes Val's own code did: all of them, less the world's. */
    productHashes: () => versionHashCount() - ownHashes,
    schemaOfModule,
    /** The version of a module as its bundle has it: no chain. */
    bundle(module: AnyModule): ModuleVersion | null {
      if (bundles.has(module)) return bundles.get(module) ?? null;
      const schema = schemaOfModule(module);
      const version =
        schema === null
          ? null
          : {
              schema,
              base: baseOf(Internal.getSource(module)),
              chain: EMPTY_CHAIN,
            };
      bundles.set(module, version);
      return version;
    },
  };
}
