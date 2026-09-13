import { createContext, useContext, type ReactNode } from "react";
import type { Profile } from "../components/ValProvider";

/**
 * What every row needs in order to draw an avatar, without being handed it.
 *
 * A context rather than props, because attribution appears on rows nested three
 * deep — a field inside a changed list entry inside a group — and threading
 * profiles, the portal container and the clock through all of that would put
 * five parameters on every component between here and there, none of which they
 * are otherwise about.
 *
 * `now` is in here for the same reason `FieldPatchAuthorsPure` takes it: it
 * renders relative dates ("2h ago"), and a component that reads the clock itself
 * cannot be screenshotted or tested deterministically.
 */
export type CompareAuthorsContextValue = {
  profiles: Record<string, Profile>;
  /** Where popovers portal to. `useValPortal()` in the app; null in a story. */
  portalContainer: HTMLElement | null;
  mode: "fs" | "http" | "unknown";
  now: Date;
  /**
   * Which person the dialog is filtered to, or null for everyone.
   *
   * Here rather than passed down for the same reason as the rest — but note
   * that rows do the FILTERING themselves rather than being given a filtered
   * list. A row that knows it is excluded can be dropped, and one that is kept
   * still needs the unfiltered authorship to draw its avatars: filtering the
   * map first would silently rewrite history to say one person made a change
   * that two people made.
   */
  authorFilter: string | null;
  /**
   * Undo mode, when it is on.
   *
   * In the same context as attribution for the same reason: the checkbox
   * belongs on rows nested three deep, and threading mode, selection and a
   * toggle callback through every component in between would put three
   * parameters on each of them that they are otherwise not about.
   *
   * `null` is the normal, read-only dialog — which is most of the time, and is
   * why every consumer treats it as the default rather than as a special case.
   */
  undo: {
    kind: "discard" | "revert";
    /** Everything that will go, picks and their forced dependents. */
    selected: ReadonlySet<string>;
    /** Only what the closure added, drawn differently. */
    pulledIn: ReadonlySet<string>;
    onToggle: (rowId: string) => void;
  } | null;
};

const CompareAuthorsContext = createContext<CompareAuthorsContextValue | null>(
  null,
);

export function CompareAuthorsProvider({
  value,
  children,
}: {
  value: CompareAuthorsContextValue;
  children: ReactNode;
}) {
  return (
    <CompareAuthorsContext.Provider value={value}>
      {children}
    </CompareAuthorsContext.Provider>
  );
}

/**
 * Null outside a provider, deliberately.
 *
 * Attribution is an enhancement, not a requirement: a story or a preview that
 * renders a pane without one should show the diff and no avatars, rather than
 * throw. This is the opposite of `useValPortal`, which throws — but that one
 * guards a feature that silently misrenders when absent, and this one does not.
 */
export function useCompareAuthors(): CompareAuthorsContextValue | null {
  return useContext(CompareAuthorsContext);
}

/**
 * Whether a row survives the current author filter.
 *
 * A row with no authorship at all is KEPT. Structure — a group heading, an
 * unchanged row revealed by "show all fields" — has no author and is not
 * somebody else's work, so hiding it would punch holes in the pane rather than
 * narrow it.
 */
export function passesAuthorFilter(
  authors: Record<string, unknown> | undefined,
  authorFilter: string | null,
): boolean {
  if (authorFilter === null) return true;
  if (authors === undefined) return true;
  return Object.keys(authors).includes(authorFilter);
}
