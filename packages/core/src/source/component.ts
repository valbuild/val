/**
 * Type-level-only slot saying "this object is linked to a component"
 * (`s.object(...).component(...)`). Nothing is ever stored under it: it is how
 * the link travels from the schema, through the module, to what a reader gives
 * back, so `ValComponentEditor` can refuse a value it has no component for
 * where the code is written rather than where the page is opened.
 */
declare const ComponentLink: unique symbol;

/**
 * What `.component()` adds to an object's SOURCE type.
 *
 * Optional, and that is what keeps the source writable: the object in the
 * `.val.ts` is still a plain literal, and an optional symbol-keyed property
 * costs its author nothing to satisfy. The same shape, and the same reason, as
 * the slot on `ValViewSource`.
 */
export type ValComponentSource = {
  readonly [ComponentLink]?: true;
};

/**
 * EXPERIMENTAL. An object that is linked to a component, as consuming code
 * sees it: what `useVal` / `useValRoute` / `fetchVal` give back for an
 * `s.object(...).component(...)`. Its fields are all there; this is the part
 * that says it can be handed to `ValComponentEditor`.
 *
 * Required here where it is optional on the source, so that nothing is a
 * `ValComponent` by accident: an object of a schema with no component does
 * not have it, and neither does a union with one variant that was not linked.
 */
export type ValComponent = {
  readonly [ComponentLink]: true;
};

/** Does this source type carry the slot `.component()` adds? */
export type IsValComponentSource<T> = typeof ComponentLink extends keyof T
  ? true
  : false;

/**
 * A schema's source type, linked: every object in it gains the slot, and a
 * `null` (a nullable schema) stays one.
 */
export type LinkedToComponent<Src> = Src extends null
  ? Src
  : Src & ValComponentSource;
