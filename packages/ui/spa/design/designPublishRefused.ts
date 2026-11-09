import { publishCommitRefusalOf } from "../proposals/commitProposal";
import type { PublishProposalState } from "../components/proposals/PublishProposalDialog";

/** What the design tab's Publish dialog says when a press of Publish failed. */
export type DesignPublishRefused = Extract<
  PublishProposalState,
  { kind: "failed" } | { kind: "someone-pushed-on-site" }
>;

/**
 * A press of Publish from the design tab, refused or failed, as its dialog
 * says it -- with the one action that helps, and Try again only where
 * pressing again can.
 *
 * - **Someone pushed** to the proposal's git branch (content's
 *   `someone-pushed`): Publish again would be refused the same way, and
 *   Build on their push is only pressed from the proposal's own address
 *   (`take-push`), never from the site the design tab is on. So the dialog
 *   names who pushed and when, links their commit, and offers **Open the
 *   proposal**: its Studio, where Publish offers Build on their push.
 * - **GitHub refused the commit for good** (a protected branch): where to
 *   see why, as the proposal's own Studio says it.
 * - Anything else: the message, and Try again.
 *
 * `cause` is what content answered (`ProposalPublishPress`'s `cause`, or the
 * builder tab's refusal); `proposalStudio` is the proposal's own Studio
 * (`proposalStudioUrl`), `null` while its address is not known.
 */
export function designPublishRefused(
  message: string,
  cause: unknown,
  proposalStudio: string | null,
): DesignPublishRefused {
  const refusal = publishCommitRefusalOf(cause);
  if (refusal?.status === "someone-pushed") {
    return {
      kind: "someone-pushed-on-site",
      refused: {
        branch: refusal.branch,
        branchUrl: refusal.branchUrl,
        who: refusal.who,
        ago: refusal.ago,
        commit: refusal.theirs,
        during: "publish",
      },
      proposalStudio,
    };
  }
  if (
    refusal?.status === "failed" &&
    !refusal.canRetry &&
    refusal.branchUrl !== null
  ) {
    return {
      kind: "failed",
      message: refusal.message,
      seeWhy: { label: "Open the branch", url: refusal.branchUrl },
    };
  }
  return { kind: "failed", message };
}
