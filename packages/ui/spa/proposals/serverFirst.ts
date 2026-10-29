import type { ProposalBuildOutcome } from "./proposalCode";

/**
 * Whether Val Build said it does not build this project yet: asked once,
 * and every build after that goes to the tab without asking again. A reload
 * asks again, which is how a project it is turned on for finds out.
 */
let serverBuildsOff = false;

/**
 * A build by Val Build first (valbuild/home `docs/plans/server-builds.md`):
 * no bundler here, no builder tab, and the same on an iPhone. A project it
 * does not build yet (`off`) is built `here`, as before, and so is every
 * build after it in this page.
 */
export async function serverFirst(
  onServer: () => Promise<ProposalBuildOutcome | { status: "off" }>,
  here: () => Promise<ProposalBuildOutcome>,
): Promise<ProposalBuildOutcome> {
  if (!serverBuildsOff) {
    const outcome = await onServer();
    if (outcome.status !== "off") return outcome;
    serverBuildsOff = true;
  }
  return here();
}

/** For tests: forget what Val Build said. */
export function resetServerBuildsForTests(): void {
  serverBuildsOff = false;
}
