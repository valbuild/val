import { Internal, ValConfig, ValModules } from "@valbuild/core";
import {
  createValApiRouter,
  createValServer,
  type CommitContext,
  type CommitResult,
  type ValPatchStore,
} from "@valbuild/server";
import { VERSION } from "../version";
import { valDraftMode, type ValDraftMode } from "./valDraftMode";

/**
 * What `http` mode needs, as one object.
 *
 * A publish there is a commit on the project's repository, so this is the
 * shape of "Val's content service holds my patches and my repo holds my
 * content".
 */
export type ValHttpMode = {
  /** Names the PROJECT to the content service. */
  apiKey: string;
  /** Signs the session cookie. Any sufficiently random string. */
  valSecret: string;
  /** The commit the running code was built from. See the note at the use. */
  gitCommit: string;
  /** The branch a publish commits to. */
  gitBranch: string;
  /**
   * Val's content service, when it is not the real one.
   *
   * For pointing at a local stand-in — `e2e/mock-content-host` in the Val
   * repository, which implements the patch, commit and file routes without a
   * git repository behind them.
   *
   * NOTE this does not redirect everything. `getSettings`, which remote files
   * use, reads `process.env.VAL_CONTENT_URL` at module scope inside
   * `@valbuild/server`; a host that bundles its dependencies separately cannot
   * set that, so remote FILES still address the real host even when patches and
   * commits go here.
   */
  valContentUrl?: string;
};

/**
 * The Val API, as a handler you can mount on a TanStack Start server route.
 *
 * `createValApiRouter` already speaks the platform's own vocabulary — it takes
 * a `Request` and hands back a `ValServerGenericResult` — so all this adds is
 * the conversion to a `Response`, which for Next needed `NextResponse` and here
 * does not need anything.
 */
const initValApiHandler = (
  valModules: ValModules,
  config: ValConfig,
  draftMode: ValDraftMode,
  formatter?: (code: string, filePath: string) => Promise<string> | string,
  commitPrepared?: (commit: {
    patchedSourceFiles: Record<string, string | null>;
  }) => Promise<void>,
  sourceFiles?: Record<string, string>,
  patchStore?: ValPatchStore,
  apiKey?: string,
  publishOverride?: (context: CommitContext) => Promise<CommitResult>,
  http?: ValHttpMode,
): ((req: Request) => Promise<Response>) => {
  const route = "/api/val"; // TODO: get from config
  const coreVersion = Internal.VERSION.core;
  if (!coreVersion) {
    throw new Error("Could not get @valbuild/core package version");
  }
  const tanstackVersion = VERSION;
  if (!tanstackVersion) {
    throw new Error("Could not get @valbuild/tanstack package version");
  }

  return createValApiRouter(
    route,
    createValServer(
      valModules,
      route,
      {
        versions: {
          /*
           * Reported as `next` because that is the field the wire contract has.
           *
           * `Versions` in `@valbuild/server` names the framework half of the
           * pair `next`, and admin.val.build reads it. Renaming it is a change
           * to a published contract with a server on the other end, so the
           * TanStack package fills the same field rather than adding one
           * nothing reads.
           */
          next: tanstackVersion,
          core: coreVersion,
        },
        ...config,
        /*
         * Present only when the host supplied one: `sourceFiles` is what
         * SELECTS the in-memory store, so a key set to `undefined` would be
         * indistinguishable from a host that meant to supply nothing, and
         * `initHandlerOptions` checks presence.
         */
        ...(sourceFiles !== undefined ? { sourceFiles } : {}),
        ...(patchStore !== undefined ? { patchStore } : {}),
        ...(apiKey !== undefined ? { apiKey } : {}),
        /*
         * What puts the server in `http` mode: the patches live on Val's
         * content service, and a publish is a commit on the project's
         * repository.
         *
         * `gitCommit` is the commit the RUNNING code was built from, and it is
         * load bearing rather than bookkeeping: every read of a `.val.ts` in
         * this mode fetches that path from the content service AT THAT COMMIT.
         * Give it a commit the deployed code did not come from and Val edits a
         * different version of the file than the one the site is running.
         */
        ...(http !== undefined ? http : {}),
      },
      config,
      {
        isEnabled() {
          return draftMode.isEnabled();
        },
        onEnable() {
          return draftMode.enable();
        },
        onDisable() {
          return draftMode.disable();
        },
      },
      formatter,
      commitPrepared,
      publishOverride,
    ),
    (valRes): Response => {
      const headers = new Headers();
      const valResHeaders = ("headers" in valRes && valRes.headers) || {};
      for (const key in valResHeaders) {
        const value = valResHeaders[key];
        if (typeof value === "string") {
          headers.set(key, value);
        }
      }
      if ("cookies" in valRes && valRes.cookies) {
        for (const [cookieName, cookie] of Object.entries(valRes.cookies)) {
          headers.append("Set-Cookie", serializeCookie(cookieName, cookie));
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
        /*
         * Built by hand rather than with `Response.redirect`.
         *
         * `Response.redirect` produces an immutable response whose headers
         * cannot be added to, and the redirect that enables Val is precisely
         * the one that has to set cookies on its way out.
         */
        return new Response(null, {
          status: valRes.status,
          headers,
        });
      }
      return new Response("body" in valRes ? valRes.body : null, {
        headers,
        status: valRes.status,
      });
    },
  );
};

/**
 * One `Set-Cookie` header value.
 *
 * `value` is nullable because clearing a cookie is expressed as a null value
 * rather than a separate op — which is also why a falsy value gets `Max-Age=0`
 * below when no explicit expiry was given.
 */
type ValResponseCookie = {
  value: string | null;
  options?: {
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: string | boolean;
    path?: string;
    expires?: Date;
  };
};

function serializeCookie(name: string, cookie: ValResponseCookie): string {
  const options = cookie.options;
  /*
   * `Path=/` unless told otherwise — the default is not "the whole site".
   *
   * A `Set-Cookie` with no `Path` defaults to the DIRECTORY of the request
   * that set it, and every cookie Val sets is set by a response from
   * `/api/val/...`. So `val_enable` — which the page reads from
   * `document.cookie` to decide whether to mount the Studio overlay — was
   * scoped to `/api/val` and invisible on the site itself: enabling Val
   * appeared to do nothing at all. Next's `NextResponse` normalises this for
   * the Next package; a plain `Response` does not.
   */
  const path = options?.path ?? "/";
  return (
    `${name}=${encodeURIComponent(cookie.value || "")}` +
    `${options?.httpOnly ? "; HttpOnly" : ""}` +
    `${options?.secure ? "; Secure" : ""}` +
    `${options?.sameSite ? `; SameSite=${options.sameSite}` : ""}` +
    `; Path=${path}` +
    `${
      options?.expires
        ? `; Expires=${options.expires.toISOString()}`
        : `${!cookie.value ? "; Max-Age=0" : ""}`
    }`
  );
}

export function initValServer(
  valModules: ValModules,
  config: ValConfig & {
    disableCache?: boolean;
  },
  opts?: {
    formatter?: (code: string, filePath: string) => Promise<string> | string;
    /**
     * How preview mode is stored for a browser.
     *
     * Defaults to Val's own cookie (`valDraftMode()`), which is what an app
     * wants unless it already has a preview mechanism of its own to hang this
     * off. Whatever is passed here MUST be the same object the content readers
     * get, or the API will enable a preview the loaders cannot see.
     */
    draftMode?: ValDraftMode;
    /**
     * Called after a save has applied its patches, with the files it produced.
     *
     * EXPERIMENTAL — see VAL_PROMPT.md. For a host where "commit" is not
     * "write to the working tree and let git take it from here": the files are
     * `path -> content` (null = delete), which is what such a host publishes.
     * It runs in addition to the save, not instead of it.
     */
    commitPrepared?: (commit: {
      patchedSourceFiles: Record<string, string | null>;
    }) => Promise<void>;
    /**
     * The project's source, by path — and, by being present, the choice of an
     * in-memory store over the local filesystem.
     *
     * EXPERIMENTAL — see VAL_PROMPT.md. For a host that HOLDS the source rather
     * than having it on a disk: `fs` mode wants a working tree it can watch and
     * write, and giving such a host a shimmed filesystem to read through is
     * what produced a `/stat` long-polling watchers that cannot fire. Here it
     * simply hands the source over, and `commitPrepared` is where the publish
     * goes.
     */
    /**
     * Val's api key, for a host that cannot give the server one through the
     * environment.
     *
     * `@valbuild/server` normally reads `VAL_API_KEY` itself. That works where
     * it and the app are built together; it does not where the app is bundled
     * separately from its dependencies — the build inlines env vars into the
     * APP and leaves the dependency chunks alone, so Val's own
     * `process.env.VAL_API_KEY` is undefined however the host sets it. The app
     * can see it, so the app passes it.
     *
     * Only needed for REMOTE files, which upload to Val's content host at
     * publish.
     */
    apiKey?: string;
    /**
     * What a publish DOES, when Val's content service holds the patches.
     *
     * EXPERIMENTAL — see `ValServerOptions.publishOverride`. By default a
     * publish in that mode is a git commit; a host that publishes by building
     * says so here. It is handed the default as `commitToGit`, so it can
     * replace the commit or also perform it.
     */
    publishOverride?: (context: CommitContext) => Promise<CommitResult>;
    /**
     * Put this server in `http` mode: Val's content service owns the patches.
     *
     * Everything here is required together — `initHandlerOptions` throws for a
     * proxy config missing any of them — which is why it is one option and not
     * four.
     */
    http?: ValHttpMode;
    sourceFiles?: Record<string, string>;
    /**
     * Where pending patches live, with {@link sourceFiles}. Defaults to memory,
     * which dies with the process — see `ValPatchStore` for the durable swap.
     */
    patchStore?: ValPatchStore;
  },
): {
  /**
   * The Val API. Mount it on `/api/val/$` for every method:
   *
   * @example
   * // src/routes/api/val.$.ts
   * import { createFileRoute } from "@tanstack/react-router";
   * import { valApiHandler } from "../../val/server";
   *
   * export const Route = createFileRoute("/api/val/$")({
   *   server: {
   *     handlers: {
   *       GET: ({ request }) => valApiHandler(request),
   *       POST: ({ request }) => valApiHandler(request),
   *       PUT: ({ request }) => valApiHandler(request),
   *       PATCH: ({ request }) => valApiHandler(request),
   *       DELETE: ({ request }) => valApiHandler(request),
   *       HEAD: ({ request }) => valApiHandler(request),
   *     },
   *   },
   * });
   */
  valApiHandler: (req: Request) => Promise<Response>;
  /** The draft-mode flag this server reads and writes. */
  draftMode: ValDraftMode;
} {
  const draftMode = opts?.draftMode ?? valDraftMode();
  return {
    valApiHandler: initValApiHandler(
      valModules,
      config,
      draftMode,
      opts?.formatter,
      opts?.commitPrepared,
      opts?.sourceFiles,
      opts?.patchStore,
      opts?.apiKey,
      opts?.publishOverride,
      opts?.http,
    ),
    draftMode,
  };
}
