/**
 * Type-level-only slot naming the source type of the module a {@link View}
 * points at. Required, not optional: nothing else should ever be a `View` by
 * accident, and reading a property off one has to be an error.
 */
declare const ViewTarget: unique symbol;

/**
 * A pointer to another module, as consuming code sees it.
 *
 * It has no properties on purpose. A view exists for the Val editor — it puts a
 * way into another module on this module's screen — and there is nothing in it
 * to render. Read the module it names directly.
 *
 * `T` is the target's source type, carried so that resolving a view (`useVal(...)`
 * on the handle) can be added later and be typed. Nothing reads it today.
 */
export type View<T> = {
  readonly [ViewTarget]: T;
};
