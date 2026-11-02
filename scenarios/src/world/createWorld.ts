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
import { createValClient } from "@valbuild/shared/internal";
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
  getModuleIds,
  raw,
  type DecodeVal,
  type Resolvable,
  type ResolvedVal,
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
// The page's own code, by path: TanStack's draft store and how `useVal`
// reads it, which the package does not export.
import {
  applyValEvent,
  createDraftStore,
  isDraft,
} from "../../../packages/tanstack/src/draftStore";
import {
  readEntryWithOverlay,
  readRouteEntryWithOverlay,
  readSelectorWithOverlay,
  type CommittedEntries,
  type OverlayView,
} from "../../../packages/tanstack/src/client/overlayRead";
import { bundledJsonEntryImport } from "../../../packages/tanstack/src/routeFromVal";
import type { ValExternalStore } from "../../../packages/tanstack/src/ValOverlayContext";
import type { ValDraft } from "../../../packages/tanstack/src/ValDraft";
import {
  startRefreshLoop,
  type RefreshLoop,
} from "../../../packages/tanstack/src/refreshLoop";
import { inRequest } from "./tanstackStart";
import { createFrames, type Frames } from "./frames";
import { startFakeClock, type Clock } from "./clock";
import { installXmlHttpRequest } from "./xmlHttpRequest";
import { startContentHost, type ContentHost } from "./contentHost";
import {
  createProposalsClient,
  type ProposalsClient,
} from "../../../packages/ui/spa/proposals/proposalsClient";
import {
  runCodeTool,
  type CodeToolAnswer,
} from "../../../packages/ui/spa/proposals/proposalCode";
import {
  createStudioJobClient,
  type StudioJobClient,
} from "@valbuild/shared/publish";

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
  /** {@link deployCode}, then every Studio's {@link Studio.receiveCode}. */
  changeCode(modules: AnyModule[]): Promise<void>;
  /** The invariants every scenario is held to. See `frames.ts`. */
  expectInvariants(): void;
  /** Stops what the world started, and puts the working directory back. */
  dispose(): Promise<void>;
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
  merge(): ReturnType<StudioJobClient["pressMerge"]>;
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
};

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
  const deployCode = (modules: AnyModule[]): Deployment => {
    serverModules = modules;
    valModules = registryOf(modules);
    const previous = currentHandler;
    currentHandler = serverFor(valModules);
    network.name(currentHandler, `build ${++builds}`);
    network.route(currentHandler);
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
    serverModules.forEach((module, i) => {
      const replacement = next[i];
      if (replacement === undefined || replacement === module) return;
      reloadedAs.set(module, replacement);
      // A module the scenario wrote may have been replaced before.
      for (const [original, current] of reloadedAs) {
        if (current === module) reloadedAs.set(original, replacement);
      }
    });
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
  const surfaces: Array<{ name: string; read: () => Promise<unknown> }> = [];
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
          const count = work.count(kind, { since });
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
        surfaces.push({
          name: surface,
          read: async () => {
            const read = await system.sourceStore.get(path, null);
            return "data" in read ? read.data : `(${read.status})`;
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
          },
        ),
      async redeploy() {
        const res = await fetch(
          `${host.contentHost.url}/__test__/proposals/${name}/overlay`,
        );
        if (!res.ok) throw new Error(`No overlay for ${name}: ${res.status}`);
        const overlay = parseProposalOverlay(await res.json());
        host.http = { ...host.http, proposal: overlay };
        deployCode(serverModules);
      },
      merge: () =>
        createStudioJobClient({ api: "/api/val", fetchImpl: send }).pressMerge(
          name,
          randomUUID(),
          "scenario-tab",
        ),
    };
  };
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
    proposal: proposalAt(),
    async loadPage(route, pageOptions) {
      const request = () => pageRequest(host, route);
      // The page's browser bundle: the server's code unless the scenario gives
      // it another build's, and then hot-reloaded with the server's when the
      // project's files change (`devReload`).
      let clientModules = pageOptions.clientModules ?? serverModules;
      const followsServer = pageOptions.clientModules === undefined;
      // The bundle's own entry imports, which a hook suspends on: resolved
      // here, before reading, for each build's modules.
      const committed = new Map<AnyModule[], CommittedEntries>();
      for (const modules of [serverModules, clientModules]) {
        committed.set(modules, await committedEntriesOf(modules));
      }
      const record = (modules: AnyModule[], view: OverlayView) => {
        const entries = committed.get(modules);
        if (entries === undefined) throw new Error("unresolved build");
        for (const show of pageOptions.shows) {
          frames.record(
            show.surface,
            readShow(moduleLike(modules, show.module), show, view, entries),
          );
        }
        frames.tick();
      };
      // 1. The server renders the page: the layout's loader reads the draft
      //    (`fetchValDraft`) and the provider seeds its store from it.
      const draft = await inRequest(request(), () =>
        readersFor({ on: true }).fetchValDraft(),
      );
      const serverStore = createDraftStore(draft);
      const read = (store: ValExternalStore, modules: AnyModule[]) =>
        record(modules, {
          moduleMap: store.get(idsOf(modules)),
          draftMode: isDraft(draft) ? true : null,
          snapshot: draft?.snapshot,
        });
      read(serverStore, serverModules);
      // The page's loaders, read on the server: at the server render, and
      // whenever the refresh loop re-runs them. One `initValContent` per page
      // server, made again on a deploy, as the server module is.
      let content = readersFor({ on: true });
      pages.push(() => {
        content = readersFor({ on: true });
      });
      const readLoaders = async () => {
        for (const show of pageOptions.loaderShows ?? []) {
          const value: unknown = await inRequest(request(), async () =>
            raw(await content.fetchValStega(currentModule(show.module))),
          );
          frames.record(show.surface, fieldOf(value, show.field));
        }
        if ((pageOptions.loaderShows ?? []).length > 0) frames.tick();
      };
      await readLoaders();
      // 2. The browser hydrates from the same draft, as loader data -- which
      //    is JSON on the way -- with its own client modules.
      const loaderData: ValDraft | null =
        draft === null ? null : JSON.parse(JSON.stringify(draft));
      const pageStore = createDraftStore(loaderData);
      read(pageStore, clientModules);
      // 3. The overlay mounts: its Studio takes in the page's client modules
      //    with the base the page serves (`window.__VAL_BASE__`), and its
      //    relay hands the page's store what the Studio holds.
      const events: OverlayEvent[] = [];
      // The provider's refresh loop: an edit landing in the page's store
      // re-runs the loaders, at most every 500 ms, with the safety net behind.
      const pending = { current: 0 };
      let refreshing = false;
      let refreshes = 0;
      const loop = startRefreshLoop({
        pending,
        refresh: () => {
          refreshing = true;
          refreshes++;
          void readLoaders().finally(() => {
            refreshing = false;
          });
        },
        isRefreshing: () => refreshing,
        isHidden: () => false,
      });
      refreshLoops.push(loop);
      const studio = await startStudio(
        `overlay ${route}`,
        registryOf(clientModules),
        {
          base: isDraft(loaderData) ? loaderData.base : undefined,
          beforeIntake: (system) => {
            relays.push(
              startOverlayRelay(system, (event) => {
                events.push(event);
                const outcome = applyValEvent(pageStore, event);
                if (outcome.type === "updated" && outcome.changed) {
                  read(pageStore, clientModules);
                  // Where the provider counts an edit and fires
                  // VAL_EDIT_LANDED, which its loop listens for.
                  pending.current++;
                  loop.editLanded();
                }
              }),
            );
          },
        },
      );
      if (followsServer) {
        hotPages.push(async (modules) => {
          clientModules = modules;
          committed.set(modules, await committedEntriesOf(modules));
          // The page re-renders with the new code.
          read(pageStore, clientModules);
          await readLoaders();
        });
      }
      return {
        studio,
        events,
        get refreshes() {
          return refreshes;
        },
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
      // The app's code reads the modules of the build it runs: after a
      // reload, the same module from the new build (`currentModule`).
      const readers: PageReaders = {
        async fetchVal(module) {
          const current: typeof module = currentModule(module);
          return raw(await content.fetchValStega(current));
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
              return inRequest(pageRequest(host, route), () => read(readers));
            },
          });
        },
      };
    },
    async observe() {
      for (const surface of surfaces) {
        frames.record(surface.name, await surface.read());
      }
      frames.tick();
    },
    expectInvariants() {
      frames.expectInvariants();
    },
    clock,
    deployCode,
    async changeCode(modules) {
      deployCode(modules);
      for (const { studio } of studios) {
        await studio.receiveCode(modules);
      }
    },
    async settle() {
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
 * What a hook gives back for one show, read the way the hook reads it:
 * `useVal`, `useValKey` or `useValRoute`'s pure part.
 */
function readShow(
  module: AnyModule,
  show: PageShow,
  view: OverlayView,
  entries: CommittedEntries,
): unknown {
  const via = show.via;
  if (via === undefined) {
    return fieldOf(
      raw(readSelectorWithOverlay(module, view, false, entries)),
      show.field,
    );
  }
  const modulePath = moduleFilePathOf(module);
  const draftSource =
    view.moduleMap && view.draftMode ? view.moduleMap[modulePath] : undefined;
  const snapshotSource = view.snapshot?.[modulePath];
  const one = (_: unknown, key: string) =>
    entries(module, modulePath, [key])[0];
  const value =
    "useValKey" in via
      ? readEntryWithOverlay(
          module,
          via.useValKey,
          draftSource,
          snapshotSource,
          false,
          one,
        )
      : readRouteEntryWithOverlay(
          module,
          via.useValRoute,
          draftSource,
          snapshotSource,
          false,
          one,
        );
  return fieldOf(raw(value), show.field);
}

/**
 * The committed content of every `.jsonValues()` entry the modules bundle,
 * resolved: what a hook's `React.use` would wait for, done before reading.
 */
async function committedEntriesOf(
  modules: AnyModule[],
): Promise<CommittedEntries> {
  const loaded = new Map<string, unknown>();
  for (const module of modules) {
    const source = Internal.getSource(module);
    if (typeof source !== "object" || source === null) continue;
    const modulePath = moduleFilePathOf(module);
    for (const key of Object.keys(source)) {
      const thunk = bundledJsonEntryImport(module, key);
      if (thunk !== undefined) {
        loaded.set(`${modulePath} ${key}`, (await thunk()).default);
      }
    }
  }
  return (_module, modulePath, keys) =>
    keys.map((key) => loaded.get(`${modulePath} ${key}`));
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
function moduleFilePathOf(module: AnyModule): ModuleFilePath {
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
