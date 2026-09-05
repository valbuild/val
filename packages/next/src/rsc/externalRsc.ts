import {
  Internal,
  type ExternalRecordSrc,
  type ModuleFilePath,
  type ValModule,
} from "@valbuild/core";
import { VAL_OPS, type ValServer } from "@valbuild/server";
import type { ItemOfModule } from "@valbuild/server";
import { stegaEncode } from "@valbuild/react/stega";
import { getJsonEntryStegaRoot } from "../routeFromVal";

/**
 * Reading an external record from a server component.
 *
 * The one thing that makes these different from every other reader: an external
 * record's content is NEVER bundled with the app. `fetchVal` on an ordinary
 * module reads the module — the module IS the content — and only asks the server
 * when draft mode is on. Here there is nothing to read locally, so the store has
 * to be reached on every render, draft mode or not.
 *
 * That is why these go through the in-process `ValOps` (see `VAL_OPS`) rather
 * than the HTTP handlers. The handlers require a session, correctly: enumerating
 * someone's product table is not a capability to hand to anonymous callers. A
 * server component is not an anonymous caller — it is the app, rendering its own
 * content — and reaching `ValOps` directly is how it says so without opening the
 * route.
 */

export type ExternalModule = ValModule<ExternalRecordSrc>;

/** A page of an external record's keys. */
export type ValKeysPage = {
  keys: string[];
  /** `null` means this was the last page. */
  cursor: string | null;
  /**
   * How many entries there are, when the store will say.
   *
   * Absent means the adapter declined to count (`count: false`) — which is NOT
   * zero, and a pager that renders it as zero is lying about an empty record.
   * `exact: false` means Val counted as far as it was willing to walk, so the
   * honest rendering is "10,000+".
   */
  total?: { count: number; exact: boolean };
};

/**
 * What these readers need, and no more: a server that carries the in-process ops
 * handle, and a way to ask whether Val is on.
 *
 * Stated as the handle rather than as `ValServer` so a caller holding a narrowed
 * server (the single-entry readers do) can pass it, and so a test can supply a
 * fake without standing up twenty-seven routes.
 */
type Reader = {
  valServerPromise: Promise<Partial<Pick<ValServer, typeof VAL_OPS>>>;
  isEnabled: () => Promise<boolean>;
};

async function opsOf(reader: Reader) {
  const server = await reader.valServerPromise;
  const ops = server[VAL_OPS];
  if (ops === undefined) {
    throw new Error(
      "Val: this server cannot read external records — it was created without the in-process ops handle. External content is never bundled with the app, so there is nothing to fall back to.",
    );
  }
  return ops;
}

function pathOf(module: ExternalModule): ModuleFilePath {
  const path = Internal.getValPath(module);
  if (path === undefined) {
    throw new Error(
      "fetchVal: the value passed is not a Val module — it has no path.",
    );
  }
  return path as unknown as ModuleFilePath;
}

/**
 * Whether Val is on for this request.
 *
 * Only decides whether DRAFT content is read and whether the result carries edit
 * tags. It does not decide whether the store is read at all — see the note at the
 * top of this file.
 */
async function enabled(reader: Reader): Promise<boolean> {
  try {
    return await reader.isEnabled();
  } catch {
    // Not in a server context where draftMode is readable.
    return false;
  }
}

export const initFetchValKeys =
  (reader: Reader) =>
  async (
    module: ExternalModule,
    args?: { cursor?: string | null; limit?: number },
  ): Promise<ValKeysPage> => {
    const ops = await opsOf(reader);
    const res = await ops.getExternalKeys(
      pathOf(module),
      { cursor: args?.cursor ?? null, limit: args?.limit ?? 50 },
      { applyPatches: await enabled(reader) },
    );
    if (res.status !== "success") {
      throw new Error(`Val: could not read external keys: ${res.message}`);
    }
    // Counted once, on the first page. A store with no `count` is counted by
    // walking its keys, and doing that again for every page of a paged read
    // would turn a cheap read into a quadratic one.
    const counted =
      (args?.cursor ?? null) === null
        ? await ops.getExternalCount(pathOf(module), {
            applyPatches: await enabled(reader),
          })
        : null;
    return {
      keys: res.keys,
      cursor: res.cursor,
      ...(counted?.status === "success" && counted.count.status === "counted"
        ? { total: { count: counted.count.count, exact: counted.count.exact } }
        : {}),
    };
  };

export const initFetchValEntries =
  (reader: Reader) =>
  async <M extends ExternalModule>(
    module: M,
    keys: string[],
  ): Promise<Record<string, ItemOfModule<M>>> => {
    const isEnabled = await enabled(reader);
    const ops = await opsOf(reader);
    const res = await ops.getExternalEntries(pathOf(module), keys, {
      applyPatches: isEnabled,
    });
    if (res.status !== "success") {
      throw new Error(`Val: could not read external entries: ${res.message}`);
    }
    for (const { key, message } of res.errors) {
      // Reported, not thrown: a row that no longer matches the schema still has
      // to render, or one bad row takes a page down.
      console.error(`Val: external entry '${key}' has an error: ${message}`);
    }
    const out: Record<string, ItemOfModule<M>> = {};
    for (const { key, content } of res.entries) {
      if (content === null) {
        continue;
      }
      out[key] = stegaEncode(content, {
        disabled: !isEnabled,
        // The same root a `.jsonValues()` entry gets. That is what lets the
        // Studio open an external entry with the machinery it already has —
        // the edit tag says nothing about where the bytes came from.
        root: getJsonEntryStegaRoot(module, key),
      });
    }
    return out;
  };

export const initFetchValKey =
  (reader: Reader) =>
  async <M extends ExternalModule>(
    module: M,
    key: string,
  ): Promise<ItemOfModule<M> | undefined> => {
    const entries = await initFetchValEntries(reader)(module, [key]);
    return entries[key];
  };

/**
 * Every entry of an external record, paged internally.
 *
 * Slow by construction on a big store, and offered anyway: an editor who wants
 * every entry is allowed to ask for every entry, and a reader that refused would
 * be Val deciding what someone may do with their own content. It fails on a
 * TIMEOUT rather than on a size, because "too big" is not something Val can
 * judge — a 2,000-row product table is nothing, and 2,000 pages of richtext is
 * not.
 */
export const initFetchValAll =
  (reader: Reader) =>
  async <M extends ExternalModule>(
    module: M,
    opts?: { timeoutMs?: number },
  ): Promise<Record<string, ItemOfModule<M>>> => {
    const timeoutMs = opts?.timeoutMs ?? 30_000;
    const startedAt = Date.now();
    const fetchKeys = initFetchValKeys(reader);
    const fetchEntries = initFetchValEntries(reader);
    const out: Record<string, ItemOfModule<M>> = {};
    let cursor: string | null = null;
    for (;;) {
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(
          `Val: reading every entry of ${pathOf(module)} took longer than ${timeoutMs}ms. Read a page at a time with fetchValKeys, or raise timeoutMs.`,
        );
      }
      const page: ValKeysPage = await fetchKeys(module, { cursor, limit: 100 });
      if (page.keys.length > 0) {
        Object.assign(out, await fetchEntries(module, page.keys));
      }
      if (page.cursor === null) {
        return out;
      }
      cursor = page.cursor;
    }
  };

/**
 * Whether a value is a Val module whose entries live behind an adapter.
 *
 * Checked on the SOURCE rather than the schema, because that is what a reader
 * holds: `c.external()` produces the marker, and the marker is the whole of what
 * distinguishes an external module's source from an ordinary record's.
 */
export function isExternalValModule(value: unknown): value is ExternalModule {
  if (!Internal.isValModule(value)) {
    return false;
  }
  return Internal.isExternal(Internal.getSource(value));
}
