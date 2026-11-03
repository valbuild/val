import {
  Internal,
  type Json,
  type ModuleFilePath,
  type PatchId,
  type SerializedSchema,
} from "@valbuild/core";
import type { ReadonlyJSONValue } from "@valbuild/core/patch";
import {
  EMPTY_CHAIN,
  applyChain,
  baseModuleContent,
  baseVersionOf,
  chainOf,
  moduleKey,
  parseModuleKey,
  schemaVersionOf,
  type ModuleContent,
  type ModuleVersion,
} from "@valbuild/shared/internal";
import type { FetchManifest, ManifestFetchAnswer } from "./manifestSource";
import type { FetchModule, ModuleFetchAnswer } from "./originTier";
import type { PatchRecord } from "./types";

/**
 * A fake of Val's server's `GET /manifest` and `GET /modules`, for the
 * stores' tests: a server whose base is `bases()` and whose chain is
 * `chain()`, answering as `ValHead` does -- each module's version, the chain
 * applied with THE engine (`applyChain`, stopping at the first patch that
 * does not apply, as the server does), a base by its version, and the
 * patches from a version the caller holds.
 *
 * A fake at an edge the stores do not own (the network and the server),
 * built from the same shared functions the server's head is.
 */
export function createFakeManifest(server: {
  /** Each module's base on the server, and its schema. */
  bases: () => ReadonlyMap<
    ModuleFilePath,
    { source: Json; schema: SerializedSchema | undefined }
  >;
  /** The server's chain, in order, records only. */
  chain: () => readonly PatchRecord[];
  /** How the answers wait: a microtask by default. */
  delay?: () => Promise<void>;
}): {
  fetchManifest: FetchManifest;
  fetchModule: FetchModule;
  /** How many of each were asked: the work a test can count. */
  asked: () => { manifests: number; modules: number };
} {
  let manifests = 0;
  let modules = 0;
  // A microtask, not a timer: async, and still settled by the one turn the
  // stores' tests let a stat take -- the manifest is read before a stat is
  // adopted, so a timer here would move every such test's timing.
  const delay = server.delay ?? (() => Promise.resolve());

  type Made = {
    version: ModuleVersion;
    content: ModuleContent;
    applied: PatchRecord[];
    failed: { patchId: PatchId; message: string } | null;
  };
  const made = new Map<string, Made>();

  function moduleAt(path: ModuleFilePath): Made | null {
    const base = server.bases().get(path);
    if (base === undefined) return null;
    const records = server
      .chain()
      .filter((record) => record.moduleFilePath === path);
    // The Studio names a module without a schema by the empty string.
    const schema =
      base.schema === undefined ? "" : schemaVersionOf(base.schema);
    const baseVersion = baseVersionOf(base.source);
    const key = `${path}\0${schema}\0${baseVersion}\0${records
      .map((record) => record.patchId)
      .join(",")}`;
    const known = made.get(key);
    if (known !== undefined) return known;
    const applied = applyChain(
      baseModuleContent(base.source as ReadonlyJSONValue),
      records,
      base.schema,
    );
    const ids = records.slice(0, applied.applied).map((r) => r.patchId);
    const result: Made = {
      version: { schema, base: baseVersion, chain: chainOf(ids) },
      content: applied.module,
      applied: records.slice(0, applied.applied),
      failed: applied.failed,
    };
    made.set(key, result);
    return result;
  }

  const fetchManifest: FetchManifest = async (held) => {
    manifests++;
    await delay();
    const versions: Record<ModuleFilePath, ModuleVersion> = {};
    for (const path of server.bases().keys()) {
      const at = moduleAt(path);
      if (at !== null) versions[path] = at.version;
    }
    const tag = JSON.stringify(versions);
    if (held !== null && held.tag === tag) return { kind: "unchanged" };
    const answer: ManifestFetchAnswer = {
      kind: "manifest",
      project: { build: "test", seq: manifests },
      modules: versions,
      tag,
    };
    return answer;
  };

  const fetchModule: FetchModule = async (path, query) => {
    modules++;
    await delay();
    const at = moduleAt(path);
    if (at === null) {
      return { kind: "error", message: `Module not found: ${path}` };
    }
    const base = server.bases().get(path);
    const current = moduleKey(path, at.version);
    if (query.v !== undefined && query.v !== current) {
      const baseVersion: ModuleVersion = { ...at.version, chain: EMPTY_CHAIN };
      if (base !== undefined && query.v === moduleKey(path, baseVersion)) {
        return whole(baseVersion, baseModuleContent(base.source), []);
      }
      const answer: ModuleFetchAnswer = {
        kind: "not-held",
        current: at.version,
      };
      return answer;
    }
    const have = query.have !== undefined ? parseModuleKey(query.have) : null;
    if (
      have !== null &&
      have.version.schema === at.version.schema &&
      have.version.base === at.version.base
    ) {
      for (let n = at.applied.length; n >= 0; n--) {
        const ids = at.applied.slice(0, n).map((r) => r.patchId);
        if (chainOf(ids) === have.version.chain) {
          return {
            kind: "delta",
            from: have.version,
            to: at.version,
            patches: at.applied
              .slice(n)
              .map(({ patchId, patch }) => ({ patchId, patch })),
          };
        }
      }
    }
    return whole(
      at.version,
      at.content,
      at.applied.map((r) => r.patchId),
      at.failed,
    );
  };

  return {
    fetchManifest,
    fetchModule,
    asked: () => ({ manifests, modules }),
  };
}

function whole(
  version: ModuleVersion,
  content: ModuleContent,
  patches: PatchId[],
  failed: { patchId: PatchId; message: string } | null = null,
): ModuleFetchAnswer {
  const entries: Extract<ModuleFetchAnswer, { kind: "module" }>["entries"] = {};
  for (const [key, state] of content.entries) {
    if (state.kind === "content") {
      entries[key] = { content: state.content as Json };
    } else if (state.kind === "deleted") {
      entries[key] = { deleted: true };
    } else if (state.kind === "error") {
      entries[key] = { error: state.message, patchId: state.patchId };
    }
  }
  return {
    kind: "module",
    version,
    source: stripImports(content.source as Json),
    entries,
    patches,
    ...(failed !== null ? { failed } : {}),
  };
}

/** `.jsonValues()` markers as the wire has them: without their `import()`. */
function stripImports(source: Json): Json {
  if (source === null || typeof source !== "object" || Array.isArray(source)) {
    return source;
  }
  const out: Record<string, Json> = {};
  for (const [key, value] of Object.entries(source)) {
    out[key] = Internal.isJson(value)
      ? (JSON.parse(JSON.stringify(value)) as Json)
      : value;
  }
  return out;
}
