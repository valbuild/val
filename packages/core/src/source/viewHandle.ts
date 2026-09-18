import type { ValModule } from "../module";
import { Schema } from "../schema";
import { ValViewSchema } from "../schema/view";
import type { GenericSelector, SelectorSource } from "../selector";
import type { ValView } from "../selector/view";
import type { Source, SourceObject } from "./index";
import { isValViewSource, ValViewSource } from "./view";

/**
 * Where a resolved view handle keeps the module it points at.
 *
 * A symbol, so it is invisible to `JSON.stringify`, `Object.keys`, the source
 * SHAs and every walk that treats source as data — the handle still IS
 * `{ view: "/foo.val.ts" }` everywhere that matters.
 */
const ViewTargetModule = Symbol.for("val/ViewTargetModule");

/**
 * A view's source with the module it names attached.
 *
 * `useVal(page.header)` needs the target's SOURCE and its SCHEMA, and the
 * stored pointer has neither — it is a path. The app has no way to turn a path
 * back into a module either: `val.modules` holds lazy `import()` thunks, and
 * `<ValModulesClient>` is optional. So the module travels with the handle.
 *
 * Attached by the READ path (`stegaEncode`) rather than written into source,
 * and that is the whole reason it works in draft mode: with an edit pending,
 * the source comes from the overlay store as plain JSON that never went near a
 * module. The schema is the module's own either way, so the encoder always has
 * it to hand.
 */
export type ValViewHandle = ValViewSource & {
  readonly [ViewTargetModule]: unknown;
};

/** Attach the module a view names to its pointer. */
export function createViewHandle(
  source: ValViewSource,
  valModule: unknown,
): ValViewHandle {
  return {
    ...source,
    [ViewTargetModule]: valModule,
  };
}

/** Is this a view pointer that carries the module it names? */
export function isViewHandle(value: unknown): value is ValViewHandle {
  return (
    typeof value === "object" &&
    value !== null &&
    ViewTargetModule in value &&
    (value as Record<symbol, unknown>)[ViewTargetModule] !== undefined
  );
}

/** The module a handle carries, or undefined if it carries none. */
export function viewHandleModule(value: unknown): unknown {
  if (!isViewHandle(value)) {
    return undefined;
  }
  return value[ViewTargetModule];
}

/**
 * What a reader that needs a MODULE accepts, rather than a value.
 *
 * `useValKey`, `useValRoute`, `useValRouteUrl` and their `fetch*` counterparts
 * all read a path, a schema and a source off what they are handed, so — unlike
 * `useVal` — they cannot take an arbitrary selector. They CAN take a view
 * pointing at one, which is the point of a page declaring which module it
 * shows. {@link resolveViewedModule} is the runtime half, and takes exactly
 * this, so the two cannot drift.
 */
export type ResolvableModule<S extends Source = SourceObject> =
  | ValModule<GenericSelector<S>>
  | ValView<S>;

/**
 * What a reader was actually handed: the module itself, or — when it is a view
 * handle — the module that view points at.
 *
 * Every reader that needs a module rather than a value goes through this:
 * `useValKey`, `useValRoute`, `useValRouteUrl` and their `fetch*` counterparts
 * all pull the path, the schema and the source off the thing they are given,
 * and a view handle has none of those. It is `{ view: "/foo.val.ts" }` with the
 * module on a symbol, so reading `Internal.getValPath` off it gives
 * `undefined`, and every one of those readers treats `undefined` as its own
 * "no route matched" answer. Without this the call is not an error — it is a
 * silently empty one.
 *
 * A POINTER with no module on it throws rather than being passed through, for
 * the same reason `stegaEncode` throws on one: symbols do not survive
 * serialization, so a handle that crossed the server/client boundary as a prop
 * arrives looking like content and is not.
 */
export function resolveViewedModule<S extends Source>(
  selector: ResolvableModule<S>,
): ValModule<GenericSelector<S>>;
/*
 * A widened implementation signature rather than assertions in the body.
 *
 * The module rides on a symbol as `unknown` — the encoder that attaches it has
 * no type for it — and no narrowing tells the checker that what is left after
 * both guards is the module arm. Declaring the callable signature above and
 * implementing against `unknown` says that once, where the runtime fact lives,
 * instead of casting at each of the twelve readers.
 */
export function resolveViewedModule(selector: unknown): unknown {
  const resolved = viewHandleModule(selector);
  if (resolved !== undefined) {
    return resolved;
  }
  if (isValViewSource(selector)) {
    throw Error(
      `Cannot resolve the view of '${selector.view}': it has been serialized, which drops the module it points at. ` +
        `Resolve it in the same component that read the module containing it, or read '${selector.view}' directly.`,
    );
  }
  return selector;
}

/**
 * Every module a schema's views point at, keyed by path.
 *
 * Walked GENERICALLY over the schema instance's own properties rather than by
 * switching on schema type, for the same reason `viewTargetsOf` is: a schema
 * holds another schema in places an enumeration keeps forgetting. Missing a
 * site here is a view that cannot be resolved at runtime, which is a worse
 * failure than the walk being slightly broad.
 *
 * Memoised per schema INSTANCE. A module's schema is built once at import, and
 * `useVal` runs on every render — so without this the walk would be a render
 * cost rather than a load cost.
 */
const cache = new WeakMap<object, Map<string, unknown>>();

export function viewModulesOf(
  schema: Schema<SelectorSource> | undefined,
): Map<string, unknown> {
  if (schema === undefined) {
    return new Map();
  }
  const cached = cache.get(schema);
  if (cached) {
    return cached;
  }
  const modules = new Map<string, unknown>();
  const seen = new Set<unknown>();
  function walk(node: unknown): void {
    if (typeof node !== "object" || node === null || seen.has(node)) {
      return;
    }
    seen.add(node);
    if (node instanceof ValViewSchema) {
      const target = node["moduleFilePath"];
      const valModule = node["valModule"];
      if (typeof target === "string" && valModule !== undefined) {
        modules.set(target, valModule);
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        walk(item);
      }
      return;
    }
    for (const value of Object.values(node)) {
      walk(value);
    }
  }
  walk(schema);
  cache.set(schema, modules);
  return modules;
}
