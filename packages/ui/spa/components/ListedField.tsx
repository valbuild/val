import { createContext, ReactNode, useContext } from "react";

/**
 * Whether a field is being shown as one of its parent's fields, rather than
 * opened on its own.
 *
 * Most fields look the same either way. A field that has more to show than a
 * row of its parent can hold — a font picked from a set, which opens on the
 * whole set — uses this to draw a compact row that navigates to itself, and
 * the full editor only once it is the thing being looked at.
 *
 * Provided by `Field`, the labelled wrapper every listed field renders
 * through. A field opened on its own (the module editor, the canvas's fields
 * column) has no `Field` above it — the same distinction `FieldErrorsOwned`
 * draws, kept separate because it answers a different question.
 */
const ListedFieldContext = createContext(false);

export function ListedField({ children }: { children: ReactNode }) {
  return (
    <ListedFieldContext.Provider value={true}>
      {children}
    </ListedFieldContext.Provider>
  );
}

/** True when this field is one row of its parent's field list. */
export function useIsListedField(): boolean {
  return useContext(ListedFieldContext);
}
