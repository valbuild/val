/**
 * Type-level-only slot carrying the SOURCE TYPE of the module a view names.
 *
 * Optional, and that is what makes the marker writable: `{ view: "/foo.val.ts" }`
 * is a plain literal, and an optional symbol-keyed property costs the author
 * nothing to satisfy. It exists so the read side can say WHAT is behind the
 * pointer — `ValView<FooSrc>` rather than `ValView<unknown>` — without the
 * author having to write a type they do not have.
 */
declare const ViewTargetSource: unique symbol;

/**
 * The source of a view field: a pointer to another module, and nothing else.
 *
 * Written as a plain object, like media and for the same reason — the same
 * value has to work in a `.val.ts` and in a `*.val.json` entry, and a literal
 * survives the static extraction that a constructor call does not. See
 * `architecture/media.md`.
 *
 * `Id` is the target's module file path as a LITERAL type, inferred from the
 * module handed to `s.view(...)`. So the path autocompletes at the call site,
 * and a source naming a different module than its schema does is a type error.
 *
 * Nothing decides "this is a view" by looking at the value; the SCHEMA does
 * (`type === "view"`). {@link isValViewSource} exists for the few places that have
 * a value and no schema, and is not the normal way to ask.
 */
export type ValViewSource<Id extends string = string, T = unknown> = {
  readonly view: Id;
} & {
  readonly [ViewTargetSource]?: T;
};

/**
 * Is this value shaped like a view marker?
 *
 * A shape test, not an identity: `view` is a reserved object key
 * (`ObjectSchemaProps`), so no ordinary object source can take this shape — but
 * hand-written JSON can, which is why validation checks the value against the
 * schema rather than trusting it.
 */
export function isValViewSource(value: unknown): value is ValViewSource {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "view" in value &&
    typeof (value as { view: unknown }).view === "string"
  );
}
