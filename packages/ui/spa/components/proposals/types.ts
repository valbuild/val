/**
 * What the Studio shows about proposals: editor-managed branches of the
 * site's content, each with its own address. valbuild/home
 * `docs/proposals.md`, flows B (managing them) and C (working in one).
 *
 * Plain data, shaped for the screens and nothing else: the components in this
 * folder are presentational, and `ValShell` turns the content service's
 * answers into these.
 */

/** A proposal's follow-up work, as the bar and the list report it. */
export type ProposalJobState =
  | { status: "pending" | "running" }
  | { status: "succeeded" }
  | { status: "failed"; error: string | null };

export type ProposalPerson = {
  name: string;
  avatarUrl?: string;
};

export type ProposalSummary = {
  /** Its name: the hash of what it was made from. The address is made of it. */
  name: string;
  /** What people call it. */
  displayName: string;
  description: string | null;
  status: "open" | "merged" | "closed";
  owner: ProposalPerson | null;
  /** Whether the person looking is its owner: lists say "You". */
  ownedByViewer: boolean;
  /** Changes in it, saved or not. */
  changes: number;
  /** ISO time of its last change. */
  updatedAt: string;
  /** Making its address. Absent on a list, where it is not read. */
  setup?: ProposalJobState | null;
  /** When it is closed: by whom, so the owner can see. */
  closedBy?: ProposalPerson | null;
};

/** Where the Studio is: on the site, or in one proposal. */
export type StudioLocation =
  | { kind: "site" }
  | {
      kind: "proposal";
      proposal: ProposalSummary;
      /** Changes made here since the last save. */
      unsaved: number;
      /** Saving now, and whether the last save failed and why. */
      save: { state: "idle" | "saving" } | { state: "failed"; error: string };
      /**
       * Bringing the address up to the last save; `null` before any save.
       * "Updating the preview…" while it runs.
       */
      overlay: ProposalJobState | null;
      /** Whether the address rendered after the last save; `null` before one. */
      renderCheck: ProposalJobState | null;
      /**
       * Why Publish (merging the proposal into the site) is not offered yet.
       * Merging arrives in a later session (`docs/proposals.md`, Flow F), so
       * for now this always says so.
       */
      publishBlockedBy: string | null;
    };
