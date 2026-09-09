import { createContext, useContext } from "react";

/** One empty array, so "this project has no languages" is a stable reference. */
const EMPTY: string[] = [];

/**
 * The languages this project publishes, for everything that draws a field.
 *
 * A context rather than a read, because the read is expensive and the readers
 * are many: the languages live in the settings module, so answering from source
 * means subscribing to every schema in the project and to that module — and
 * this is asked by every locale field, every filtered row and every "add an
 * entry" button. One subscription at the top, one context value, and an edit
 * anywhere stays O(1) rather than O(fields). See `perFieldSubscriptions.test.ts`
 * for what that guard is and why it exists.
 *
 * The read and the provider are in `ProjectLocalesProvider`, deliberately in a
 * file of their own: this one is imported by fields, and the guard above reads
 * it as a promise that nothing here subscribes project-wide.
 */
export const ProjectLocalesContext = createContext<string[]>(EMPTY);

/**
 * The languages this project publishes, in the order it declared them.
 *
 * Empty where the project has no settings module, no `locales` section, or
 * nothing in it — all of which mean the same thing, and mean it in the same way
 * for every consumer: this project has not said it is translated, so nothing
 * about locales is shown. Empty is also what a tree with no provider gets:
 * the same answer, rather than a crash, which is what lets a field be rendered
 * on its own in a story or a test.
 */
export function useProjectLocales(): string[] {
  return useContext(ProjectLocalesContext);
}
