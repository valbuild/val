import {
  Internal,
  type Json,
  type ModuleFilePath,
  type PatchId,
  type SelectorSource,
  type ValModule,
} from "@valbuild/core";
import {
  JSON_ENTRIES_BATCH_MAX,
  VAL_SESSION_COOKIE,
  memoizePerRequest,
  schemaVersionOf,
  type ContentSource,
  type EntryRead,
  type ModuleRead,
  type ModuleVersion,
  type RequestScopedMemo,
} from "@valbuild/shared/internal";
import type { ValServer } from "./ValServer";

/*
 * The draft a server-side reader reads (`fetchVal` and friends, in
 * `@valbuild/next/rsc` and `@valbuild/tanstack/server`): Val's server in
 * the same process, asked as the Studio asks over HTTP, with the request's
 * session. One copy, for both frameworks -- they had one each, line for line.
 *
 * Phase 6 of `docs/plans/one-content-model.md` replaces the whole-tree read
 * with the head; until then this is what `serverDraftSource` answers from.
 */

/** What the draft readers read: the tree, the entries, and the patches' ops. */
export type DraftValServer = {
  "/sources/~": ValServer["/sources/~"];
  "/json": ValServer["/json"];
  "/patches": Pick<ValServer["/patches"], "GET">;
};

/**
 * The `modules` map every reader in one request shares. Derived from the
 * route's own response type rather than restated, so it cannot drift from
 * what `/sources/~` returns.
 */
export type DraftSources = Extract<
  Awaited<ReturnType<ValServer["/sources/~"]["PUT"]>>,
  { status: 200 }
>["json"]["modules"];

/**
 * Where the reader gets its per-request memo box: React's `cache()` in an RSC
 * (`createReactCacheScope`), a `WeakMap` keyed on the `Request` in TanStack
 * Start (`createTanStackRequestScope`). Injected, so that "this reader needs a
 * request to scope its cache to" is part of its contract and a test can supply
 * a scope it controls.
 */
export type GetDraftSourcesScope =
  () => Promise<RequestScopedMemo<DraftSources | null> | null>;

type Cookies = {
  get(name: string): { name: string; value: string } | undefined;
};
type Headers = { get(name: string): string | null };

/**
 * ONE read of the whole module tree, for the session in `sessionCookie`.
 *
 * `path` stays `"/"` on purpose, and the measurement is why. `/sources/~`
 * evaluates, previews and validates EVERY module and only THEN filters the
 * response by `req.path` (the two TODOs in `ValServer.ts` say so), so narrowing
 * the path shrinks the answer and changes the work not at all: on a 60-module
 * project, `path: "/"` took 53.6ms and a single-module path 53.5ms. And this is
 * an in-process call rather than a round trip, so the object it builds is never
 * serialised or sent anywhere — the bytes it saves are not bytes anyone pays
 * for. Narrowing would also give each caller a different answer to cache, which
 * is what would cost the saving that IS real (2.7x on the same project).
 *
 * `draftRead.perf.test.ts` (in `@valbuild/next`) prints both numbers; re-run it
 * before believing anything different.
 *
 * Returns `null` when the session is not one the server accepts; the caller
 * then renders published content, which is what it did before.
 */
export async function loadDraftSources(
  valServer: Promise<Pick<DraftValServer, "/sources/~">>,
  sessionCookie: string | undefined,
): Promise<DraftSources | null> {
  const treeRes = await (
    await valServer
  )["/sources/~"]["PUT"]({
    path: "/",
    query: {
      validate_sources: true,
      validate_binary_files: false,
      exclude_patches: false,
      // The server-side read uses the legacy "server applies patches" path.
      apply_patches: undefined,
    },
    cookies: {
      [VAL_SESSION_COOKIE]: sessionCookie,
    },
  });
  if (treeRes.status === 200) {
    return treeRes.json.modules;
  }
  if (treeRes.status === 401) {
    Internal.log.debug("authentication error: ", treeRes.json.message);
    return null;
  }
  throw Error(JSON.stringify(treeRes.json, null, 2));
}

/**
 * The tree for this request: read once, however many readers ask
 * (`memoizePerRequest`). The key is the session, so a box that somehow
 * outlived its request misses rather than serving another author's draft.
 */
export async function draftTree(
  valServer: Promise<Pick<DraftValServer, "/sources/~">>,
  sessionCookie: string | undefined,
  scope: GetDraftSourcesScope | null,
): Promise<DraftSources | null> {
  return memoizePerRequest(
    scope === null ? null : await scope(),
    sessionCookie ?? "",
    () => loadDraftSources(valServer, sessionCookie),
  );
}

/**
 * A module's draft source, as the browser would have received it, with the
 * `.jsonValues()` entries the draft edits filled in -- or `undefined` when
 * they could not all be read.
 *
 * Two things, both because `/sources/~` keeps each such entry as a MARKER
 * (its content lives in its own file):
 *
 * - Read in-process, a marker still carries its `import()` thunk, which no
 *   serializer can send. So the source is put in its wire shape first, the
 *   same one the Studio gets over HTTP: a marker without its thunk, which the
 *   hooks read as "no draft for this entry" and resolve from the bundle.
 * - An entry edited in the draft is still a marker there, so the page would
 *   render the published entry and swap it once the Studio loads it. Those
 *   entries -- the ones an applied patch touches, and the ones whose marker
 *   says the bundle's copy is not current (`Internal.isJsonFromServer`: a
 *   publish wrote them, and the host has not rebuilt) -- are read through
 *   `/json` and put in place of their markers, which is the shape the
 *   Studio's own store gives them once it has.
 */
export async function withDraftJsonEntries(
  valServer: Promise<Pick<DraftValServer, "/json" | "/patches">>,
  sessionCookie: string | undefined,
  moduleFilePath: ModuleFilePath,
  source: Json | undefined,
  appliedPatchIds: readonly PatchId[],
): Promise<Json | undefined> {
  if (source === undefined) {
    return undefined;
  }
  const wire: Json = JSON.parse(JSON.stringify(source));
  if (!isRecordOfJsonMarkers(source)) {
    return wire;
  }
  // The entries whose content is the server's and not the bundle's -- one a
  // publish wrote, on a host that has not rebuilt since -- whether or not a
  // patch is pending on them.
  const edited = new Set<string>(
    Object.keys(source).filter((key) => Internal.isJsonFromServer(source[key])),
  );
  const server = await valServer;
  const cookies = { [VAL_SESSION_COOKIE]: sessionCookie };
  if (appliedPatchIds.length > 0) {
    const patchesRes = await server["/patches"]["GET"]({
      query: {
        patch_id: [...appliedPatchIds],
        exclude_patch_ops: false,
      },
      cookies,
    });
    if (patchesRes.status !== 200) {
      return undefined;
    }
    for (const { path, patch } of patchesRes.json.patches) {
      if (path !== moduleFilePath) {
        continue;
      }
      for (const op of patch ?? []) {
        const touched = [op.path[0]];
        if (op.op === "move" || op.op === "copy") {
          touched.push(op.from[0]);
        }
        for (const key of touched) {
          if (key === undefined) {
            // A write of the whole record: no smaller set of entries to read.
            return undefined;
          }
          if (Internal.isJson(source[key])) {
            edited.add(key);
          }
        }
      }
    }
  }
  if (edited.size === 0) {
    return wire;
  }
  const keys = [...edited];
  const draft = wire as Record<string, Json>;
  for (let i = 0; i < keys.length; i += JSON_ENTRIES_BATCH_MAX) {
    const res = await server["/json"]["GET"]({
      query: {
        path: moduleFilePath,
        key: undefined,
        keys: keys.slice(i, i + JSON_ENTRIES_BATCH_MAX),
        offset: undefined,
        limit: undefined,
        apply_patches: true,
      },
      cookies,
    });
    if (
      res.status !== 200 ||
      !("entries" in res.json) ||
      res.json.errors.length > 0 ||
      res.json.missing.length > 0
    ) {
      return undefined;
    }
    for (const { key, content } of res.json.entries) {
      draft[key] = content;
    }
  }
  return draft;
}

/**
 * Whether {@link withDraftJsonEntries} has anything to read from the server
 * for a module: an entry a patch touches, or one a publish wrote.
 */
export function hasDraftJsonEntries(
  source: Json | undefined,
  appliedPatchIds: readonly PatchId[],
): boolean {
  return (
    source !== undefined &&
    isRecordOfJsonMarkers(source) &&
    (appliedPatchIds.length > 0 ||
      Object.values(source).some((value) => Internal.isJsonFromServer(value)))
  );
}

/** One module {@link readDraftChanges} read: what a reader's `reads` record. */
export type DraftModuleRead = {
  path: ModuleFilePath;
  from: "server-draft";
  version: ModuleVersion | null;
};

/**
 * The modules the editor's draft CHANGES, for this request: what
 * `fetchValDraft` hands to `<ValProvider draft>`, in `@valbuild/tanstack/server`
 * and `@valbuild/next/rsc` alike -- this is the whole of the read, and the
 * frameworks add only where draft mode and the cookies come from (and, in
 * TanStack, a proposal's snapshot).
 *
 * `null` -- and no read at all -- unless draft mode is on: a visitor pays one
 * cookie lookup. Otherwise the SAME read every `fetchVal` in the request
 * shares ({@link draftTree}, memoised per request), cut down to the modules a
 * patch touches or a publish wrote and the host has not rebuilt since, with
 * the `.jsonValues()` entries the draft edits filled in
 * ({@link withDraftJsonEntries}).
 *
 * Also `null` when the session is not one the server accepts, and when the
 * draft could not be read at all (logged): published content, as before this
 * existed -- a draft page that renders the site is a degraded preview, one
 * that fails to render is an outage.
 */
export async function readDraftChanges(opts: {
  valServer: Promise<DraftValServer>;
  isEnabled: () => Promise<boolean>;
  getCookies: () => Promise<Cookies>;
  scope: GetDraftSourcesScope | null;
}): Promise<{
  sources: Record<ModuleFilePath, Json>;
  reads: DraftModuleRead[];
} | null> {
  try {
    if (!(await opts.isEnabled())) {
      return null;
    }
    // Possibly absent: a local `fs` server answers without one. The server
    // decides, and a 401 is `null` -- the same rule `fetchVal` follows.
    const sessionCookie = (await opts.getCookies()).get(
      VAL_SESSION_COOKIE,
    )?.value;
    const modules = await draftTree(opts.valServer, sessionCookie, opts.scope);
    if (!modules) {
      return null;
    }
    const sources: Record<ModuleFilePath, Json> = {};
    const reads: DraftModuleRead[] = [];
    for (const [path, module] of Object.entries(modules)) {
      // A module no patch touches is the bundle's -- unless a publish wrote
      // some of its entries and the host has not rebuilt since.
      if (
        module.patches === undefined &&
        !hasJsonEntriesFromServer(module.source)
      ) {
        continue;
      }
      const moduleFilePath = path as ModuleFilePath;
      // Left out when its entries cannot all be read: the published render
      // that existed before the draft did is worse than this, and never
      // wrong for long.
      const source = await withDraftJsonEntries(
        opts.valServer,
        sessionCookie,
        moduleFilePath,
        module.source,
        module.patches?.applied ?? [],
      );
      if (source !== undefined) {
        sources[moduleFilePath] = source;
        reads.push({
          path: moduleFilePath,
          from: SERVER_DRAFT,
          version: module.version ?? null,
        });
      }
    }
    return { sources, reads };
  } catch (err) {
    Internal.log.error("could not read the draft", err);
    return null;
  }
}

/** Whether `source` is a record holding an entry read from the server without a patch naming it. */
export function hasJsonEntriesFromServer(source: Json | undefined): boolean {
  return (
    source !== undefined &&
    isRecordOfJsonMarkers(source) &&
    Object.values(source).some((value) => Internal.isJsonFromServer(value))
  );
}

function isRecordOfJsonMarkers(source: Json): source is Record<string, Json> {
  return (
    typeof source === "object" &&
    source !== null &&
    !Array.isArray(source) &&
    Object.values(source).some((value) => Internal.isJson(value))
  );
}

/**
 * ONE `.jsonValues()` entry's DRAFT content, through `/json` (which replays
 * pending patches). `gone` is authoritative -- the draft has no such entry,
 * removed by a pending patch or never there -- and is not a reason to fall
 * back to the published entry; `pass` means it could not ask.
 */
export async function loadDraftJsonEntry(
  valServer: Promise<Pick<DraftValServer, "/json">>,
  sessionCookie: string | undefined,
  moduleFilePath: ModuleFilePath,
  key: string,
): Promise<EntryRead> {
  const res = await (
    await valServer
  )["/json"]["GET"]({
    query: {
      path: moduleFilePath,
      key,
      keys: undefined, // single-entry shape
      offset: undefined,
      limit: undefined,
      apply_patches: true,
    },
    cookies: {
      [VAL_SESSION_COOKIE]: sessionCookie,
    },
  });
  if (res.status === 200 && "content" in res.json) {
    return { status: "ready", content: res.json.content, from: SERVER_DRAFT };
  }
  if (res.status === 401) {
    Internal.log.debug("authentication error: ", res.json.message);
    return PASS;
  }
  if (res.status === 404) {
    return { status: "gone", from: SERVER_DRAFT };
  }
  Internal.log.error(
    "could not load draft JSON entry: ",
    "message" in res.json ? res.json.message : `status ${res.status}`,
  );
  return PASS;
}

const SERVER_DRAFT = "server-draft";
const PASS: ModuleRead & EntryRead = { status: "pass" };

/** One thing this source has started to read, or has read. */
type Loading<T> =
  | { done: false; ready: Promise<void> }
  | { done: true; value: T };

/**
 * The draft, as a source: Val's server in this process, for this request's
 * session. A module is the tree's (with the `.jsonValues()` entries the
 * draft edits filled in); an entry is `/json`'s. Created per request.
 *
 * Every error is a `pass`, logged: a draft that cannot be read is the
 * published content, which a page can render. That replaces the readers'
 * error fallback, which encoded the published content a second time.
 *
 * `modules` is what module reads need: the tree, and the server to read a
 * record's edited entries from. Without it (the single-entry readers) every
 * module passes.
 */
export function serverDraftSource(opts: {
  valServer: Promise<Pick<DraftValServer, "/json">>;
  session: string | undefined;
  modules: {
    valServer: Promise<DraftValServer>;
    scope: GetDraftSourcesScope | null;
  } | null;
}): ContentSource {
  let tree: Loading<DraftSources | null> | null = null;
  const filled = new Map<ModuleFilePath, Loading<Json | undefined>>();
  const entries = new Map<string, Loading<EntryRead>>();

  const treeNow = (modules: {
    valServer: Promise<DraftValServer>;
    scope: GetDraftSourcesScope | null;
  }): Loading<DraftSources | null> => {
    if (tree === null) {
      const ready = draftTree(
        modules.valServer,
        opts.session,
        modules.scope,
      ).then(
        (modules) => {
          tree = { done: true, value: modules };
        },
        (err: unknown) => {
          Internal.log.error("failed to fetch ", err);
          tree = { done: true, value: null };
        },
      );
      // Not yet replaced: it resolves in a later turn, after this returns.
      tree = { done: false, ready };
    }
    return tree;
  };

  return {
    name: SERVER_DRAFT,
    module(path) {
      const reads = opts.modules;
      if (reads === null) return PASS;
      const now = treeNow(reads);
      if (!now.done) return { status: "pending", ready: now.ready };
      const module = now.value?.[path];
      if (now.value === null || module === undefined) return PASS;
      const version = module.version ?? null;
      const applied = module.patches?.applied ?? [];
      if (!hasDraftJsonEntries(module.source, applied)) {
        return {
          status: "ready",
          source: module.source,
          from: SERVER_DRAFT,
          version,
        };
      }
      // A `.jsonValues()` record the draft edits: those entries are its own.
      let state = filled.get(path);
      if (state === undefined) {
        const ready = withDraftJsonEntries(
          reads.valServer,
          opts.session,
          path,
          module.source,
          applied,
        ).then(
          (source) => {
            filled.set(path, { done: true, value: source });
          },
          (err: unknown) => {
            Internal.log.error("could not read the draft's entries", err);
            filled.set(path, { done: true, value: undefined });
          },
        );
        state = { done: false, ready };
        filled.set(path, state);
      }
      if (!state.done) return { status: "pending", ready: state.ready };
      // Entries that could not be read: the module as the tree has it,
      // markers and all, which the bundle fills -- a stale preview rather
      // than a failed render.
      return {
        status: "ready",
        source: state.value ?? module.source,
        from: SERVER_DRAFT,
        version,
      };
    },
    entry(path, key) {
      const id = `${path}\u0000${key}`;
      let state = entries.get(id);
      if (state === undefined) {
        const ready = loadDraftJsonEntry(
          opts.valServer,
          opts.session,
          path,
          key,
        ).then(
          (read) => {
            entries.set(id, { done: true, value: read });
          },
          (err: unknown) => {
            Internal.log.error("could not load draft JSON entry: ", err);
            entries.set(id, { done: true, value: PASS });
          },
        );
        state = { done: false, ready };
        entries.set(id, state);
      }
      return state.done
        ? state.value
        : { status: "pending", ready: state.ready };
    },
  };
}

/**
 * Whether this request reads the draft, and the source to read it from.
 *
 * `enabled` is draft mode; it decides edit tags whether or not the draft can
 * be read. The draft is `null` when draft mode is off, or the request's
 * cookies cannot be read (outside a request: published content).
 *
 * `where` names where these readers may be called, for the errors a misuse
 * gets; without it (the single-entry readers) they stay quiet, as they were.
 */
export async function draftForRequest(opts: {
  valServer: Promise<Pick<DraftValServer, "/json">>;
  isEnabled: () => Promise<boolean>;
  getCookies: () => Promise<Cookies>;
  /**
   * For module reads (`fetchVal`): the tree, shared per request. They ask
   * for the request's host first, as `fetchVal` always did, and a request
   * without one reads no module from the draft.
   */
  modules?: {
    valServer: Promise<DraftValServer>;
    getHeaders: () => Promise<Headers>;
    scope: GetDraftSourcesScope;
  };
  where?: string;
}): Promise<{ enabled: boolean; draft: ContentSource | null }> {
  const fail = (what: string, err: unknown) => {
    if (opts.where !== undefined) {
      Internal.log.error(`${what} ${opts.where}`, err);
    }
  };
  let enabled = false;
  try {
    enabled = await opts.isEnabled();
  } catch (err) {
    fail(
      "could not check if Val is enabled! This might be due to an error reading draft mode.",
      err,
    );
  }
  if (!enabled) {
    return { enabled, draft: null };
  }
  let host: string | null = null;
  if (opts.modules !== undefined) {
    try {
      const headers = await opts.modules.getHeaders();
      if (typeof headers.get !== "function") {
        throw new Error("Invalid headers");
      }
      host = getHost(headers);
    } catch (err) {
      fail("could not read headers!", err);
    }
  }
  let cookies: Cookies;
  try {
    cookies = await opts.getCookies();
  } catch (err) {
    fail("could not read cookies!", err);
    return { enabled, draft: null };
  }
  return {
    enabled,
    draft: serverDraftSource({
      valServer: opts.valServer,
      session: cookies.get(VAL_SESSION_COOKIE)?.value,
      modules:
        opts.modules !== undefined && host !== null
          ? { valServer: opts.modules.valServer, scope: opts.modules.scope }
          : null,
    }),
  };
}

function getHost(headers: Headers): string | null {
  const host = headers.get("host");
  let proto = "https";
  if (headers.get("x-forwarded-proto") === "http") {
    proto = "http";
  } else if (headers.get("referer")?.startsWith("http://")) {
    proto = "http";
  } else if (host?.startsWith("localhost")) {
    proto = "http";
  }
  return host ? `${proto}://${host}` : null;
}

const schemaVersions = new WeakMap<object, string | null>();

/**
 * The version of the schema a reader's own code has for a module: what the
 * readers hold a draft's version against (`layered`'s schema rule), so
 * content is never read with a schema it was not made for. Hashed once per
 * module object, which a build makes once: a load cost, not a read cost.
 */
export function readerSchemaVersion(
  module: ValModule<SelectorSource>,
): string | null {
  const cached = schemaVersions.get(module);
  if (cached !== undefined) return cached;
  const schema = Internal.getSchema(module);
  const version =
    schema === undefined ? null : schemaVersionOf(schema["executeSerialize"]());
  schemaVersions.set(module, version);
  return version;
}
