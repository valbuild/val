import {
  Internal,
  type Json,
  type ModuleFilePath,
  type SelectorSource,
  type ValModule,
} from "@valbuild/core";
import {
  VAL_SESSION_COOKIE,
  schemaVersionOf,
  type ContentSource,
  type EntryRead,
  type ModuleRead,
  type ModuleVersion,
} from "@valbuild/shared/internal";
import type { Draft } from "./head";
import type { ValRuntime } from "./valRuntime";

/*
 * The draft a server-side reader reads (`fetchVal` and friends, in
 * `@valbuild/next/rsc` and `@valbuild/tanstack/server`): the HEAD of this
 * process's runtime (`valRuntime`, `ValHead`), read directly with the
 * request's session. One copy, for both frameworks.
 *
 * Before phase 6 of `docs/plans/one-content-model.md` each framework built a
 * private Val server and asked it `PUT /sources/~` -- the whole tree,
 * previewed and validated -- once per request, then `/patches` and `/json`
 * for the entries a draft edits, and `/json` again per key read. Now a read
 * asks the head "has the chain moved?" (`seq`) and is answered from modules
 * made once per version: an unpatched module is the reader's own bundle, and
 * nothing is read for it at all.
 */

type Cookies = {
  get(name: string): { name: string; value: string } | undefined;
};
type Headers = { get(name: string): string | null };

/** One module {@link readDraftChanges} read: what a reader's `reads` record. */
export type DraftModuleRead = {
  path: ModuleFilePath;
  from: "server-draft";
  version: ModuleVersion | null;
};

const SERVER_DRAFT = "server-draft";
const PASS: ModuleRead & EntryRead = { status: "pass" };

/**
 * The modules the editor's draft CHANGES, for this request: what
 * `fetchValDraft` hands to `<ValProvider draft>`, in `@valbuild/tanstack/server`
 * and `@valbuild/next/rsc` alike -- this is the whole of the read, and the
 * frameworks add only where draft mode and the cookies come from (and, in
 * TanStack, a proposal's snapshot).
 *
 * `null` -- and no read at all -- unless draft mode is on: a visitor pays one
 * cookie lookup. Otherwise the head's modules a patch touches or a publish
 * wrote and the host has not rebuilt since, with the `.jsonValues()` entries
 * the draft changes in place of their markers, and the version of each (so
 * the page compares versions with what the Studio relays, not content).
 *
 * Also `null` when the session is not one the server accepts, and when the
 * draft could not be read at all (logged): published content, as before this
 * existed -- a draft page that renders the site is a degraded preview, one
 * that fails to render is an outage.
 */
export async function readDraftChanges(opts: {
  runtime: Promise<ValRuntime>;
  isEnabled: () => Promise<boolean>;
  getCookies: () => Promise<Cookies>;
}): Promise<{
  sources: Record<ModuleFilePath, Json>;
  versions: Record<ModuleFilePath, ModuleVersion>;
  reads: DraftModuleRead[];
} | null> {
  try {
    if (!(await opts.isEnabled())) {
      return null;
    }
    // Possibly absent: a local `fs` server answers without one. The runtime
    // decides, as the API does.
    const session = (await opts.getCookies()).get(VAL_SESSION_COOKIE)?.value;
    const runtime = await opts.runtime;
    if (!runtime.authorize(session)) {
      return null;
    }
    const changed = await runtime.ops.head.changed();
    if ("error" in changed) {
      Internal.log.error("could not read the draft", changed.error.message);
      return null;
    }
    const sources: Record<ModuleFilePath, Json> = {};
    const versions: Record<ModuleFilePath, ModuleVersion> = {};
    const reads: DraftModuleRead[] = [];
    for (const path of changed.ok) {
      const draft = await runtime.ops.head.draft(path);
      if ("error" in draft) {
        Internal.log.error("could not read the draft", draft.error.message);
        return null;
      }
      // Left out when its entries cannot all be read: the published render
      // that existed before the draft did is worse than this, and never
      // wrong for long.
      if (draft.ok?.kind !== "draft" || draft.ok.entriesFailed) continue;
      sources[path] = draft.ok.source;
      versions[path] = draft.ok.version;
      reads.push({ path, from: SERVER_DRAFT, version: draft.ok.version });
    }
    return { sources, versions, reads };
  } catch (err) {
    Internal.log.error("could not read the draft", err);
    return null;
  }
}

/** One thing this source has started to read, or has read. */
type Loading<T> =
  | { done: false; ready: Promise<void> }
  | { done: true; value: T };

/**
 * The draft, as a source: this process's head, for this request's session.
 * Created per request. A module whose newest version is the bundle's own
 * passes, so the reader's bundle answers it and nothing is read; any other is
 * the head's (with the `.jsonValues()` entries the draft changes filled in).
 * An entry is the head's, resolved once per version.
 *
 * Every error is a `pass`, logged: a draft that cannot be read is the
 * published content, which a page can render.
 *
 * `modules: false` (the single-entry readers): every module passes.
 */
export function serverDraftSource(opts: {
  runtime: Promise<ValRuntime>;
  session: string | undefined;
  modules: boolean;
}): ContentSource {
  const drafts = new Map<ModuleFilePath, Loading<Draft | null>>();
  const entries = new Map<string, Loading<EntryRead>>();
  /**
   * The runtime, once this session may read the draft (asked once per
   * request); `null` when it may not, which reads as published content.
   */
  let allowed: Promise<ValRuntime | null> | null = null;
  const runtime = (): Promise<ValRuntime | null> => {
    allowed ??= opts.runtime.then(
      (runtime) => (runtime.authorize(opts.session) ? runtime : null),
      (err: unknown) => {
        Internal.log.error("could not start Val's runtime", err);
        return null;
      },
    );
    return allowed;
  };

  return {
    name: SERVER_DRAFT,
    module(path) {
      if (!opts.modules) return PASS;
      let state = drafts.get(path);
      if (state === undefined) {
        const ready = runtime()
          .then((runtime) =>
            runtime === null ? null : runtime.ops.head.draft(path),
          )
          .then(
            (read) => {
              if (read !== null && "error" in read) {
                Internal.log.error("could not read the draft", read.error);
              }
              drafts.set(path, {
                done: true,
                value: read === null || "error" in read ? null : read.ok,
              });
            },
            (err: unknown) => {
              Internal.log.error("could not read the draft", err);
              drafts.set(path, { done: true, value: null });
            },
          );
        state = { done: false, ready };
        drafts.set(path, state);
      }
      if (!state.done) return { status: "pending", ready: state.ready };
      const draft = state.value;
      if (draft === null || draft.kind === "bundle") return PASS;
      return {
        status: "ready",
        source: draft.source,
        from: SERVER_DRAFT,
        version: draft.version,
      };
    },
    entry(path, key) {
      const id = `${path}\u0000${key}`;
      let state = entries.get(id);
      if (state === undefined) {
        const ready = runtime()
          .then((runtime) =>
            runtime === null ? PASS : readEntry(runtime, path, key),
          )
          .then(
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
 * ONE `.jsonValues()` entry's DRAFT content, from the head. `gone` is
 * authoritative -- the draft has no such entry, removed by a pending patch or
 * never there -- and is not a reason to fall back to the published entry;
 * `pass` means the bundle's entry is the draft's (the record is the bundle's
 * own), or it could not be read.
 */
async function readEntry(
  runtime: ValRuntime,
  path: ModuleFilePath,
  key: string,
): Promise<EntryRead> {
  const draft = await runtime.ops.head.draft(path);
  if ("error" in draft) {
    Internal.log.error("could not load draft JSON entry: ", draft.error);
    return PASS;
  }
  if (draft.ok === null) return { status: "gone", from: SERVER_DRAFT };
  if (draft.ok.kind === "bundle") return PASS;
  const read = await runtime.ops.head.entries(path, [key]);
  if (read.status === "not-found")
    return { status: "gone", from: SERVER_DRAFT };
  if (read.status !== "success") {
    Internal.log.error("could not load draft JSON entry: ", read.message);
    return PASS;
  }
  const entry = read.value.entries[0];
  if (entry !== undefined) {
    return {
      status: "ready",
      content: entry.content,
      from: SERVER_DRAFT,
      version: read.value.entryVersions[key] ?? null,
    };
  }
  const error = read.value.errors[0];
  if (error !== undefined) {
    Internal.log.error("could not load draft JSON entry: ", error.message);
    return PASS;
  }
  return { status: "gone", from: SERVER_DRAFT };
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
  runtime: Promise<ValRuntime>;
  isEnabled: () => Promise<boolean>;
  getCookies: () => Promise<Cookies>;
  /**
   * For module reads (`fetchVal`). They ask for the request's host first, as
   * `fetchVal` always did, and a request without one reads no module from
   * the draft.
   */
  modules?: { getHeaders: () => Promise<Headers> };
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
      runtime: opts.runtime,
      session: cookies.get(VAL_SESSION_COOKIE)?.value,
      modules: opts.modules !== undefined && host !== null,
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
