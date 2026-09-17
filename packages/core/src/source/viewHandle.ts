import { Schema } from "../schema";
import { ValViewSchema } from "../schema/view";
import { SelectorSource } from "../selector";
import { ValViewSource } from "./view";

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
