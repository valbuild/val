import { scheduleLint, type BackgroundLintDeps } from "./backgroundLint";
import type { ProposalsClient } from "./proposalsClient";
import { scheduleTypecheck } from "./useProposalTypecheck";

/**
 * What proposal `name` stages now, as content says: the inputs a background
 * check is of, and what decides whether its finding is still current.
 */
export async function stagedInputsOf(
  client: Pick<ProposalsClient, "get">,
  name: string,
): Promise<string | null> {
  return (await client.get(name)).staged?.inputs ?? null;
}

/**
 * After the proposal's code changed: typecheck and lint it in the
 * background, once the files stop changing. Neither holds up the tool that
 * changed them; what they find reaches the assistant on a later tool answer
 * (`toolNotices.ts`).
 */
export function scheduleBackgroundChecks(
  name: string,
  deps: BackgroundLintDeps & {
    client: Pick<ProposalsClient, "get" | "files" | "reportTypecheck">;
    /** Called once content has the typecheck: read the proposal again. */
    onTypechecked: () => void;
  },
): void {
  void stagedInputsOf(deps.client, name)
    .catch(() => null)
    .then((inputs) =>
      scheduleTypecheck(
        name,
        deps.client,
        deps.onTypechecked,
        undefined,
        inputs,
      ),
    );
  scheduleLint(name, deps);
}
