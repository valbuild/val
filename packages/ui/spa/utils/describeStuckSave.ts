/**
 * What to say when a save keeps failing.
 *
 * The sync retries a failed save for as long as the fault lasts, which is right —
 * an edit must not be thrown away because the network blinked. But it meant a
 * save that could never succeed retried in silence: the status bar said
 * "Saving…", nothing read the sync's `retrying` state, and the one useful
 * sentence the client had ("Response could not be validated…") went nowhere.
 *
 * Each reason needs different words because each has a different fix, and the
 * person who can apply it differs too — an editor can retry a network blip, and
 * only a developer can align two Val versions.
 *
 * Pure and separate from the wiring so the wording is checkable without a system.
 */
export type StuckSaveReason =
  | "conflict"
  | "network-error"
  | "unparseable-response";

export type StuckSaveReport = {
  /** The headline. `StatusStore` de-duplicates by this, so it must be STABLE. */
  title: string;
  /** The occurrence: counts, the server's own words, what to do. */
  detail: string;
};

export function describeStuckSave(
  reason: StuckSaveReason,
  message: string,
  attempt: number,
  patchCount: number,
): StuckSaveReport {
  const changes = `${patchCount} ${patchCount === 1 ? "change" : "changes"}`;
  /*
   * The count goes in the detail, never the title: `StatusStore` de-duplicates by
   * message, so a title carrying the attempt number would stack a fresh error
   * every backoff instead of updating one.
   */
  const tried = `Tried ${attempt} ${attempt === 1 ? "time" : "times"} so far, and still trying.`;
  const kept = `Your ${changes} are safe in this tab and will be sent as soon as this clears — but they are not on the server yet, so do not close it.`;

  if (reason === "unparseable-response") {
    return {
      title: "Changes cannot be saved: the server's answer was not understood.",
      detail: [
        `The server replied, and the reply was not something this editor could read. That usually means the app and the editor are running different versions of Val — check that \`@valbuild/next\` and \`@valbuild/ui\` match — or that something between them is answering instead of the server.`,
        `The server said: ${message}`,
        tried,
        kept,
      ].join("\n\n"),
    };
  }

  if (reason === "conflict") {
    return {
      title:
        "Changes cannot be saved: something else keeps changing them first.",
      detail: [
        "Every save says which change it goes on top of, and the server keeps answering that the chain has already moved on. Another tab, another editor, or a script is writing at the same time.",
        `The server said: ${message}`,
        tried,
        kept,
      ].join("\n\n"),
    };
  }

  return {
    title: "Changes cannot be saved: the server could not be reached.",
    detail: [
      "Nothing is known about these changes — the request did not complete, so they may or may not have arrived. They will be sent again once the connection is back.",
      `The last error was: ${message}`,
      tried,
      kept,
    ].join("\n\n"),
  };
}
