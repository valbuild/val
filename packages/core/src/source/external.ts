import { Source, VAL_EXTENSION } from ".";

/**
 * The string used as the `_type` discriminator of an {@link ExternalRecordSrc}.
 */
export const EXTERNAL_VAL_EXTENSION_TAG = "external" as const;

/**
 * Type-level-only slots. Declared here rather than reusing `PhantomType`
 * (`source/index.ts`) because three separate facts have to ride along, and that
 * helper carries one.
 *
 * None of them exist at runtime: `c.external()` produces `{ _type: "external" }`
 * and nothing else.
 */
declare const ExternalItem: unique symbol;
declare const ExternalLabel: unique symbol;
declare const ExternalReadonly: unique symbol;

/**
 * The source of a record whose entries live behind an adapter — a database, an
 * HTTP API, a bucket — instead of in the module.
 *
 * This is what `c.external()` returns, and it is the counterpart of the
 * `c.json(() => import(...))` marker a `.jsonValues()` entry carries: a value
 * that says "the content is not here" without saying anything about what is.
 * The schema says *which* adapter (`.external("posts")`); this says *that* the
 * entries are elsewhere, which is what every source-walking consumer needs to
 * know without holding a schema.
 *
 * Three phantom parameters, each earning its place:
 *
 * - `T` — the item type. Without it `c.define` would return a module whose type
 *   is "a marker", the item type would be gone, and an adapter could not be
 *   typed from the schema at all.
 * - `L` — the label from `.external(label)`, so a binding can be checked against
 *   the schema that declared it.
 * - `RO` — whether the schema said `.readonly()`, which decides whether the
 *   adapter must implement writes or is forbidden from doing so.
 *
 * The defaults are the WIDEST instantiation on purpose: the bare name appears in
 * the `Source` and `SelectorSource` unions, and every narrower instantiation has
 * to be assignable to it. The `external()` factory below defaults the other way,
 * exactly as `JsonSource<T = unknown>` and `json<T = Json>()` do.
 */
export type ExternalRecordSrc<
  T = unknown,
  L extends string = string,
  RO extends boolean = boolean,
> = {
  readonly [VAL_EXTENSION]: typeof EXTERNAL_VAL_EXTENSION_TAG;
} & {
  readonly [ExternalItem]: T;
  readonly [ExternalLabel]: L;
  readonly [ExternalReadonly]: RO;
};

/**
 * The marker written as a module's source when its record is `.external()`.
 *
 * Takes no arguments: everything it carries is inferred from the schema it is
 * checked against in `c.define`. The assertion mirrors `json()` — the phantom
 * slots are symbol-keyed and have no runtime representation, so there is nothing
 * to construct for them.
 */
export function external<
  T = never,
  L extends string = string,
  RO extends boolean = false,
>(): ExternalRecordSrc<T, L, RO> {
  return {
    [VAL_EXTENSION]: EXTERNAL_VAL_EXTENSION_TAG,
  } as unknown as ExternalRecordSrc<T, L, RO>;
}

export function isExternal(obj: unknown): obj is ExternalRecordSrc {
  return (
    typeof obj === "object" &&
    obj !== null &&
    VAL_EXTENSION in obj &&
    (obj as { [VAL_EXTENSION]?: unknown })[VAL_EXTENSION] ===
      EXTERNAL_VAL_EXTENSION_TAG
  );
}

/**
 * The item type an external record holds, read back off a module.
 *
 * `GenericSelector` is not imported here — that would be a cycle through
 * `../selector` — so this is written against the phantom slot directly and the
 * selector-shaped overloads live where the selector types do.
 */
export type ExternalItemOf<S> =
  S extends ExternalRecordSrc<infer I, string, boolean> ? I : never;

/** The label an external record was declared with. */
export type ExternalLabelOf<S> =
  S extends ExternalRecordSrc<unknown, infer L, boolean> ? L : never;

/** Whether the schema behind an external record said `.readonly()`. */
export type ExternalReadonlyOf<S> =
  S extends ExternalRecordSrc<unknown, string, infer RO> ? RO : never;

/**
 * The source of an external record as it may be WRITTEN.
 *
 * Either the marker, or entries inline in the `.val.ts`. Inline entries are
 * accepted by the type on purpose, for the same reason `.jsonValues()` accepts
 * them (see `JsonValuesRecordSrc`): pasting content straight into the module is
 * the natural first thing to write, and a type error there is a dead end — the
 * author cannot see what to write instead. Validation reports the inline entries
 * as an `external:upload` fix instead, so the mistake is repaired rather than
 * blocking authoring, and they are readable at runtime meanwhile.
 */
export type ExternalRecordWritableSrc<
  Item,
  Key extends string = string,
  L extends string = string,
  RO extends boolean = boolean,
> = ExternalRecordSrc<Item, L, RO> | Record<Key, Item>;

/**
 * Is this module source an external record that still has entries written
 * inline? Used by validation to raise `external:upload`.
 */
export function hasInlineExternalEntries(
  source: Source,
): source is { [key: string]: Source } {
  return (
    typeof source === "object" &&
    source !== null &&
    !Array.isArray(source) &&
    !isExternal(source) &&
    Object.keys(source).length > 0
  );
}
