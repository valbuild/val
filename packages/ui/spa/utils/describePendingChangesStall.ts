/**
 * What to say when unpublished changes never finish loading.
 *
 * The wait is unbounded by nature: a `GET /patches` that never answers leaves
 * the chain unsettled for as long as the tab is open, and a spinner labelled
 * "Loading unpublished changes…" is then a lie told forever. Past the deadline
 * the note has to become a report — and a report is only useful if it names
 * which half failed, because the fetch and the apply are different faults in
 * different places.
 *
 * Pure, and separate from the component, so the wording is checkable without a
 * browser and so each case is written down once.
 */
export type ChainProgress = {
  total: number;
  settled: number;
  unfetched: readonly string[];
  unapplied: readonly string[];
  failed: readonly string[];
  statSeen: boolean;
};

/** How many ids to name before saying "and N more". */
const MAX_LISTED = 5;

export type PendingChangesStall = {
  /** One line, for the note itself. */
  summary: string;
  /** The detail, for the box a developer opens. */
  detail: string;
};

function listIds(ids: readonly string[]): string {
  if (ids.length <= MAX_LISTED) return ids.join(", ");
  return `${ids.slice(0, MAX_LISTED).join(", ")} and ${ids.length - MAX_LISTED} more`;
}

export function describePendingChangesStall(
  progress: ChainProgress,
  fetchError: string | null,
): PendingChangesStall {
  const { total, settled, unfetched, unapplied, statSeen } = progress;

  if (!statSeen) {
    return {
      summary: "Could not reach the server to see if there are any changes.",
      detail: [
        "The studio never received a first answer from `GET /stat`, so it does not yet know which unpublished changes exist.",
        fetchError === null ? null : `The last error was: ${fetchError}`,
        "Check that the Val API route is mounted and reachable, then reload.",
      ]
        .filter((line): line is string => line !== null)
        .join("\n\n"),
    };
  }

  if (unfetched.length > 0) {
    return {
      summary: `${settled} of ${total} unpublished ${total === 1 ? "change" : "changes"} loaded. ${unfetched.length} never arrived.`,
      detail: [
        `The server announced ${total} unpublished ${total === 1 ? "change" : "changes"} and sent the contents of ${settled}. These were announced but never delivered:`,
        listIds(unfetched),
        fetchError === null
          ? "No fetch error was reported, so the request is most likely still outstanding rather than refused."
          : `The last fetch error was: ${fetchError}`,
        "The fields are editable again. Anything you change now is written on top of what did load, so the changes above may be lost — reload before editing if you can.",
      ].join("\n\n"),
    };
  }

  if (unapplied.length > 0) {
    return {
      summary:
        unapplied.length === 1
          ? `1 of ${total} unpublished changes loaded but was not applied.`
          : `${unapplied.length} of ${total} unpublished changes loaded but were not applied.`,
      detail: [
        "Their contents arrived and the source store did not take them, which points at the patches themselves rather than at the network:",
        listIds(unapplied),
        "A patch whose module no longer has the path it edits cannot be applied. The compare view lists what each one touches.",
      ].join("\n\n"),
    };
  }

  /*
   * Nothing outstanding, and still not settled.
   *
   * Reachable because the deadline and the readiness check are read at different
   * moments: the last patch can land between the timer firing and this running.
   * Saying "everything loaded" is then both true and the least confusing thing
   * to show.
   */
  return {
    summary: "Unpublished changes took longer than expected to load.",
    detail: [
      `All ${total} of them are loaded now. The wait passed the one-minute mark before the last one arrived.`,
      "Nothing is outstanding, so this is safe to dismiss.",
    ].join("\n\n"),
  };
}
