import type {
  ModuleFilePath,
  ReifiedRender,
  SerializedSchema,
  Source,
  SourcePath,
  ValidationErrors,
} from "@valbuild/core";

/**
 * The two boundaries in this system. They are different KINDS of boundary, and
 * conflating them is how you end up with the wrong cost model.
 *
 * ## 1. The host seam — a BUNDLE boundary, not a thread boundary
 *
 * {@link HostBridge}. The host app imports its own `val.modules` and passes the
 * `ValModules` into the SPA as a React prop
 * (`ValProvider`), so the host's `Schema` instances and the SPA live in the SAME
 * realm but come from DIFFERENT bundles, each with its own copy of
 * `@valbuild/core`.
 *
 * Consequences, both load-bearing:
 * - Nothing may use `instanceof Schema` across it — the class identities differ.
 *   `extractValModules` already documents this; bracket access to
 *   `executeSerialize` / `executeRender` is the contract instead.
 * - No clone is involved, because no thread is crossed. It is async anyway, so
 *   an expensive `executeRender` can be deferred or yielded rather than blocking
 *   whoever asked.
 *
 * The host can never move into a worker: it holds the user's `select` and
 * custom `validate` closures, and closures cannot be structured-cloned. That is
 * precisely why patched source now lives in the host realm too — see
 * `architecture.md`.
 *
 * ## 2. The worker seam — a real THREAD boundary
 *
 * {@link SchemaValidationBridge}, and the snapshot arguments taken by the
 * worker-realm stores. Everything across it is structured-cloned, so the design
 * rule is that only lazy, snapshot-shaped consumers go there.
 *
 * Note what is NOT offered here: shared memory. `SharedArrayBuffer` shares
 * bytes, not object graphs, so a reader would have to `JSON.parse` per read —
 * more expensive than the clone it replaces. It also demands cross-origin
 * isolation (COOP/COEP) of the whole embedding page, which a CMS overlay
 * running inside arbitrary customer apps cannot require.
 */

export type HostRenderResult =
  | { status: "rendered"; render: ReifiedRender }
  /** The host has no instance for this module (not loaded, or not a val module). */
  | { status: "unknown-module" }
  | { status: "error"; message: string };

export type HostCustomValidateResult =
  | { status: "validated"; errors: ValidationErrors }
  | { status: "unknown-module" }
  | { status: "error"; message: string };

/**
 * What the render and validation stores are allowed to ask the host for.
 *
 * Deliberately narrow: exactly the two operations that cannot be done without
 * the real `Schema` instances. Everything else those stores do — caching,
 * staleness, events — stays on their side, which is what makes them routers
 * rather than pass-throughs.
 *
 * No `source` parameter: the host reads patched source directly, because the
 * source store is in the host realm. That is the whole point of putting it
 * there — a `source` argument here would be a 129 KB copy per render.
 */
export interface HostBridge {
  /**
   * @param only The paths a render is actually wanted for. Omitting it renders
   * the whole module, which is what a whole-list view wants; passing the visible
   * paths is what makes one row cost one `select` call. See `RenderScope`.
   */
  render(
    moduleFilePath: ModuleFilePath,
    only?: readonly SourcePath[],
  ): Promise<HostRenderResult>;
  customValidate(
    moduleFilePath: ModuleFilePath,
    paths: SourcePath[],
  ): Promise<HostCustomValidateResult>;
}

/**
 * Schema validation, across the worker seam.
 *
 * Takes the source and serialized schema as arguments rather than reading them,
 * because the implementation is on the far side of a thread boundary and cannot
 * read anything in this realm. The arguments ARE the structured clone, made
 * visible in the signature instead of hidden in a store reference.
 *
 * `schemaVersion` is a cache key, not a hash: the far side re-deserializes only
 * when it changes. See `SchemaStore.version`.
 */
export interface SchemaValidationBridge {
  validate(
    moduleFilePath: ModuleFilePath,
    source: Source,
    serializedSchema: SerializedSchema,
    schemaVersion: string,
  ): Promise<ValidationErrors>;
}
