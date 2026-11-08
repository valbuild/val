import {
  DEFAULT_CONTENT_HOST,
  type ValConfig,
  type ValModules,
} from "@valbuild/core";
import type { ValServerGenericResult } from "@valbuild/shared/internal";
import { ValServer, type ValServerConfig } from "../ValServer";
import { createValRequestHandler } from "../ValRouterCore";
import type { ValPatchStore } from "../ValOpsMemory";
import type { ValServerPlatform } from "../platform";
import type { ValRuntime } from "../valRuntime";
import { browserPlatform } from "./browserPlatform";

/** A `fetch`, as far as the Studio's client calls one. */
export type InTabFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

/**
 * Val's API, served in this tab: a `fetch` that never touches the network.
 *
 * The whole server -- the router's request parsing, `ValServer`'s routes,
 * memory mode's patch chain -- runs here, exactly as it runs on a server.
 * What is removed is the hop between them, and nothing else, which is why the
 * demo built on it cannot drift from the product: there is no second
 * implementation to drift. See `docs/plans/demo-mode.md`.
 *
 * Memory mode with no source files, because nothing here publishes (only a
 * publish reads `.val.ts` text), and without authentication, because the only
 * caller is the page this runs in.
 */
export function createInTabValFetch(
  valModules: ValModules,
  options: InTabValOptions,
): InTabFetch {
  return createInTabVal(valModules, options).fetch;
}

export type InTabValOptions = {
  config: ValConfig;
  /**
   * Where edits live. Memory by default, which is what the demo wants: the
   * edits last as long as the tab's page does, and a reload starts over.
   */
  patchStore?: ValPatchStore;
  /** The path the Studio's client calls. */
  route?: string;
  /** The binding that started it, for the Studio's version list. */
  framework?: ValServerConfig["framework"];
};

/**
 * {@link createInTabValFetch}, and the runtime behind it: the data layer the
 * server reads through, whose head (`runtime.ops.head`) is what a draft
 * reader reads (`serverDraftSource`). So a caller that reads in-process reads
 * what the API serves, through the same object, as `createValRuntime` gives
 * a server's readers. The isolate probe (`scenarios/measure/isolate/`) reads
 * a draft page this way.
 *
 * `authorize` lets every session read the draft: the server is made with
 * `unsafelyAllowUnauthenticated`, and the only caller is the page it runs in.
 */
export function createInTabVal(
  valModules: ValModules,
  options: InTabValOptions,
): { fetch: InTabFetch; runtime: ValRuntime } {
  const route = options.route ?? "/api/val";
  const serverConfig: ValServerConfig = {
    mode: "memory",
    route,
    sourceFiles: {},
    patchStore: options.patchStore,
    unsafelyAllowUnauthenticated: true,
    valContentUrl: DEFAULT_CONTENT_HOST,
    config: options.config,
    ...(options.framework !== undefined
      ? { framework: options.framework }
      : {}),
  };
  // The server makes its ops once, when it is constructed: kept here so they
  // can be handed out.
  const made: { ops: ValRuntime["ops"] | null } = { ops: null };
  const platform: ValServerPlatform = {
    ...browserPlatform,
    createOps: (modules, config) => {
      const ops = browserPlatform.createOps(modules, config);
      made.ops = ops;
      return ops;
    },
  };
  const server = ValServer(
    valModules,
    serverConfig,
    {
      // Draft content is the only content a demo has.
      isEnabled: async () => true,
      onEnable: async () => {},
      onDisable: async () => {},
    },
    platform,
  );
  const ops = made.ops;
  if (ops === null) throw new Error("the server made no data layer");
  const runtime: ValRuntime = { ops, authorize: () => true };
  const handle = createValRequestHandler(
    route,
    Promise.resolve(server),
    toResponse,
  );
  const fetch: InTabFetch = (input, init) => {
    const base =
      typeof window === "undefined"
        ? "http://localhost"
        : window.location.origin;
    // A `Request` already has an absolute URL, and `init` overrides what it
    // carries, as it does for `fetch`. Only a string or URL is resolved.
    return handle(
      input instanceof Request
        ? new Request(input, init)
        : new Request(new URL(String(input), base).href, init),
    );
  };
  return { fetch, runtime };
}

/**
 * The server's answer as a `Response`. The same conversion a host makes,
 * less the cookies: a `Response` made in the page cannot set one, and a server
 * that never authenticates has none to set.
 */
function toResponse(valRes: ValServerGenericResult): Response {
  const headers = new Headers();
  const valResHeaders = ("headers" in valRes && valRes.headers) || {};
  for (const key in valResHeaders) {
    const value = valResHeaders[key];
    if (typeof value === "string") {
      headers.set(key, value);
    }
  }
  if ("json" in valRes) {
    headers.set("Content-Type", "application/json");
    return new Response(JSON.stringify(valRes.json), {
      headers,
      status: valRes.status,
    });
  }
  if (valRes.status === 302) {
    headers.set("Location", valRes.redirectTo);
    return new Response(null, { status: valRes.status, headers });
  }
  return new Response("body" in valRes ? valRes.body : null, {
    headers,
    status: valRes.status,
  });
}
