import type { PatchId } from "@valbuild/core";

/**
 * What the editor is told when a discard did not finish, and what they can do
 * from there.
 *
 * A discard can fail part of the way: one change refused (a running publish
 * holds it) does not stop the others going. So the notice says how many went,
 * and its action works on what is LEFT -- Try again on a change that is already
 * gone would only fail again.
 */
export type DiscardFailureNotice = {
  title: string;
  description: string;
  /** The changes that were not discarded: what the action acts on. */
  remaining: PatchId[];
  /**
   * `cancel-publish`: a running publish holds a change, so trying again before
   * it ends is refused again -- stopping the publish is the way on.
   * `retry`: anything else, which a second attempt may get past.
   */
  action: "cancel-publish" | "retry";
};

export function discardFailureNotice(
  asked: readonly PatchId[],
  result: { message: string; publishJobId?: string; discarded: PatchId[] },
): DiscardFailureNotice {
  const gone = new Set(result.discarded);
  const remaining = asked.filter((patchId) => !gone.has(patchId));
  const went = asked.length - remaining.length;
  const changes = (n: number) => (n === 1 ? "change" : "changes");
  if (result.publishJobId !== undefined) {
    return {
      title: "Being published right now",
      description:
        went === 0
          ? result.message
          : `${went} of ${asked.length} ${changes(asked.length)} ${went === 1 ? "was" : "were"} discarded. ${
              remaining.length === 1
                ? "The other one is"
                : `The other ${remaining.length} are`
            } part of a publish that is running. ${result.message}`,
      remaining,
      action: "cancel-publish",
    };
  }
  return {
    title:
      went === 0
        ? "Not discarded"
        : `Only ${went} of ${asked.length} ${changes(asked.length)} ${went === 1 ? "was" : "were"} discarded`,
    description: result.message,
    remaining,
    action: "retry",
  };
}
