import type { PublishResult } from "../stores/PublishSeam";
import type { TransientErrorAction } from "../stores/StatusStore";

type Refusal = Extract<PublishResult, { status: "refused" }>;

/**
 * What to tell the user when the publish gate says no.
 *
 * A function rather than a conditional at the call site because the reasons are
 * a growing union and the call site had an if/else: two reasons were added and
 * both reported "A publish is already in progress", which is not merely unhelpful
 * — it is false, and it sends the user looking for a publish that is not running.
 * A `switch` with a `never` fallthrough makes the next reason a type error
 * instead.
 */
export function describePublishRefusal(refusal: Refusal): {
  message: string;
  details?: string;
  /** The button beside the message, where there is something to press. */
  action?: TransientErrorAction;
} {
  switch (refusal.reason) {
    case "validation-errors":
      return {
        message: "Cannot publish: some modules have validation errors.",
        details: refusal.modules.join("\n"),
      };
    case "already-publishing":
      return { message: "A publish is already in progress." };
    case "unsaved-changes":
      if (refusal.planRefusal !== undefined) {
        // Held for the plan: trying again cannot help, and the connection is
        // fine. Val Build's sentence says what can (and names Billing).
        return {
          message:
            "Cannot publish: Val Build is not saving this project's latest changes, because of its plan.",
          details: `${refusal.planRefusal}\n\nNothing was published, and your changes are kept.`,
        };
      }
      if (refusal.saveFailure !== undefined) {
        // The content service failed to take them, and said so: its sentence
        // names what failed. Not "check the connection" -- it answered.
        return {
          message: "Cannot publish: your latest changes could not be saved.",
          details: `${refusal.saveFailure}\n\nNothing was published, so no work is lost: your changes are kept in this tab. Save them again, then publish.`,
          action: "retry-save",
        };
      }
      // Still being retried -- a request that did not complete, a conflict, an
      // answer that could not be read. Which one is in the status bar's
      // report; guessing "the connection" here blamed the network for all of
      // them.
      return {
        message: "Cannot publish: your latest changes could not be saved.",
        details:
          "Nothing was published, so no work is lost: your changes are kept in this tab. Val keeps trying to save them; publish once the status bar says they are saved.",
      };
    case "chain-moved":
      return {
        message:
          "Cannot publish: the content changed while it was being checked.",
        details: "Nothing was published. Try again.",
      };
    case "held-edits":
      return {
        message:
          refusal.patchIds.length === 1
            ? "Cannot publish: an edit does not fit the new schema."
            : `Cannot publish: ${refusal.patchIds.length} edits do not fit the new schema.`,
        details:
          "The code changed under them. Nothing was published. Copy what was written and make the change again where the field is now, or discard them, then publish.",
        action: "show-held-edits",
      };
    case "head-moved":
      return {
        message: "Cannot publish: somebody else published while you were here.",
        details:
          "Nothing was published. Open Review again to see what changed, then publish.",
      };
    default: {
      const exhaustive: never = refusal;
      void exhaustive;
      return { message: "Cannot publish." };
    }
  }
}
