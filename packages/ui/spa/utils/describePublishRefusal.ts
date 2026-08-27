import type { PublishResult } from "../stores/PublishSeam";

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
      return {
        message: "Cannot publish: your latest changes could not be saved.",
        details:
          "Nothing was published, so no work is lost. Check the connection and try again.",
      };
    case "chain-moved":
      return {
        message:
          "Cannot publish: the content changed while it was being checked.",
        details: "Nothing was published. Try again.",
      };
    default: {
      const exhaustive: never = refusal;
      void exhaustive;
      return { message: "Cannot publish." };
    }
  }
}
