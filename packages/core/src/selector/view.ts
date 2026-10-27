/**
 * Type-level-only slot naming the source type of the module a {@link ValView}
 * points at. Required, not optional: nothing else should ever be a `ValView` by
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
 * `T` is the target's source type. It is what lets `useVal(page.header)` be
 * typed as the header's content — the overload that resolves a handle
 * constrains `T` to `Source` there rather than here, because `ValViewSource` is a
 * member of the `Source` union and a constraint here is a circular reference.
 */
export type ValView<T> = {
  readonly [ViewTarget]: T;
};
