import { z } from "zod";
import { someonePushedOf, type CommitOutcome } from "./commitProposal";
import { parsePlanRefusal, reportPlanRefusal } from "../utils/planRefusal";
import {
  commitRefusalOf,
  ProposalsApiError,
  type ProposalJson,
  type ProposalsClient,
} from "./proposalsClient";

/**
 * Build on their push (valbuild/home's take-push contract): somebody pushed
 * to the proposal's git branch, so Commit -- and the commit Publish makes
 * first -- was refused (`someone-pushed`). This brings their push into the
 * proposal: the files it changed are staged there, the proposal's version
 * is kept where both changed one, and their commit becomes the one the next
 * Commit is made on top of. Then Commit and Publish go through.
 *
 * What the Studio's "Build on their push" does, and what a scenario presses,
 * so both go through one function. At the proposal's own address Val's
 * server saves every pending change first, so "the proposal's version" is
 * what the person sees.
 */
export type BuildOnPushOutcome =
  | {
      status: "taken";
      /** Files both changed: the proposal's version was kept. */
      kept: string[];
      /** Files their push changed that the proposal now holds. */
      taken: string[];
      /**
       * What their push changed that a proposal cannot hold: the next Commit
       * leaves these as the site has them, which undoes them on the branch.
       */
      notTaken: string[];
      /** Their push rewrote the branch's history (a force-push). */
      rewritten: boolean;
      /** The proposal now: its preview needs a build when text came in. */
      proposal: ProposalJson;
      /** Their commit, now what the next Commit is made on top of. */
      theirs: { sha: string; url: string };
    }
  /**
   * Their push moved again since the refusal named it: this is the newer
   * one, to build on instead. Nothing was taken in.
   */
  | Extract<CommitOutcome, { status: "someone-pushed" }>
  /**
   * The branch is where Val left it -- their push was taken back, or taken
   * in already -- so there is nothing to bring in: Commit (or Publish) again.
   */
  | { status: "nothing-to-take"; message: string }
  | {
      status: "failed";
      message: string;
      /**
       * What can help, and only that: press it again (the proposal or GitHub
       * was busy, or Val could not be reached), sign in again, or the
       * organization's Billing (the plan refuses writes, as it refuses a
       * save). `null`: nothing here can; the message says what can.
       */
      offer:
        | { kind: "retry" }
        | { kind: "sign-in" }
        | { kind: "billing"; url: string }
        | null;
    };

const Refusal = z.object({ details: z.object({ code: z.string() }) });

export async function buildOnTheirPush(
  client: Pick<ProposalsClient, "takePush">,
  name: string,
  /** Their commit, as the refusal named it. */
  sha: string,
): Promise<BuildOnPushOutcome> {
  try {
    const answer = await client.takePush(name, sha);
    return {
      status: "taken",
      kept: answer.keptOurs.map((file) => file.path),
      taken: answer.taken.map((file) => file.path),
      notTaken: answer.notTaken.map((file) => file.path),
      rewritten: answer.rewritten,
      proposal: answer.proposal,
      theirs: { sha: answer.theirs.sha, url: answer.theirs.url },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!(error instanceof ProposalsApiError)) {
      // No answer at all: Val's server, or content, could not be reached.
      return {
        status: "failed",
        message: `Val could not be reached, so their push was not brought in. Nothing changed in the proposal. (${message})`,
        offer: { kind: "retry" },
      };
    }
    const moved = commitRefusalOf(error);
    if (moved?.kind === "someone-pushed") {
      return someonePushedOf(moved.message, moved.pushed);
    }
    /*
     * The plan's refusal is a 403 with the body a save gets: said as the
     * shell says every refused write, and Billing offered here.
     */
    const plan = error.status === 403 ? parsePlanRefusal(error.body) : null;
    if (plan !== null) {
      reportPlanRefusal(error.body);
      return {
        status: "failed",
        message: `Their push was not brought in: ${plan.message ?? "the project's plan does not allow changes now."}`,
        offer:
          plan.billingUrl !== null
            ? { kind: "billing", url: plan.billingUrl }
            : null,
      };
    }
    if (error.status === 401 || error.status === 403) {
      return {
        status: "failed",
        message: "Your session has run out, so their push was not brought in.",
        offer: { kind: "sign-in" },
      };
    }
    const refusal = Refusal.safeParse(error.body);
    const code = refusal.success ? refusal.data.details.code : null;
    if (code === "nothing-to-take") {
      return { status: "nothing-to-take", message };
    }
    return {
      status: "failed",
      message,
      offer:
        code === "committing" ||
        code === "github-unavailable" ||
        // Content's own failure, not a refusal: asking again can help.
        (code === null && error.status >= 500)
          ? { kind: "retry" }
          : null,
    };
  }
}
