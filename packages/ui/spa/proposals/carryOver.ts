import type { ProposalJson } from "./proposalsClient";

/**
 * Where a merged proposal's later changes went: what was written on it while
 * its merge ran is moved into a new proposal when the merge lands, by a job in
 * content (`proposalCarryOver.ts` in valbuild/home). Followed until that job
 * has run.
 *
 * `unknown` when it has not run in time, or the content service does not say:
 * the merge is no less done, so the Studio says merged and nothing more.
 */
export type CarryOver =
  | { kind: "finished" }
  | { kind: "continued"; proposal: ProposalJson }
  | { kind: "unknown" };

export async function followCarryOver(deps: {
  get: (name: string) => Promise<ProposalJson>;
  name: string;
  pollMs?: number;
  timeoutMs?: number;
  wait?: (ms: number) => Promise<void>;
}): Promise<CarryOver> {
  const wait =
    deps.wait ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const until = Date.now() + (deps.timeoutMs ?? 30_000);
  for (;;) {
    const merged = await deps.get(deps.name);
    if (merged.carriedOver === undefined) return { kind: "unknown" };
    if (merged.carriedOver) {
      return merged.continuedIn
        ? { kind: "continued", proposal: await deps.get(merged.continuedIn) }
        : { kind: "finished" };
    }
    if (Date.now() > until) return { kind: "unknown" };
    await wait(deps.pollMs ?? 1000);
  }
}
