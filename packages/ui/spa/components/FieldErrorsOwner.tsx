import { createContext, ReactNode, useContext } from "react";

/**
 * Whether something above already decides how a field's errors are shown.
 *
 * Every field's validation errors were being rendered twice — once by the leaf
 * above its input, once by the `Field` wrapper below it — which is what a reader
 * sees as the same message top and bottom. They are the same markup:
 * `ValidationErrors` is `FieldValidationError` with the errors looked up by path.
 *
 * One owner is not enough on its own, because there are two shapes. A field
 * inside an object is `Field` (the label) wrapping `AnyField` wrapping the leaf,
 * and `Field` is the right place — the errors belong under the labelled row. A
 * field opened on its own, which is what the module editor and the canvas's
 * fields column render, has no `Field` above it at all, so nothing would show
 * them.
 *
 * So `Field` says "I have this" and `AnyField` fills in when nobody has. A
 * context rather than a prop because the two are not adjacent: the callers that
 * put them together (`ObjectFields`, `ArrayFields`, `RecordFields`,
 * `UnionField`) would each have to remember to pass it, and the failure when one
 * forgets is the duplicate coming back.
 *
 * Set even when `Field` deliberately shows nothing — a compare view suppresses
 * errors on purpose — because the question is who decides, not what they decided.
 */
const FieldErrorsOwnedContext = createContext(false);

export function FieldErrorsOwned({ children }: { children: ReactNode }) {
  return (
    <FieldErrorsOwnedContext.Provider value={true}>
      {children}
    </FieldErrorsOwnedContext.Provider>
  );
}

/** True when an ancestor is already showing this field's errors. */
export function useFieldErrorsOwned(): boolean {
  return useContext(FieldErrorsOwnedContext);
}
