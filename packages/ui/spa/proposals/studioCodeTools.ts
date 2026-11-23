import type { HostStore } from "../stores/HostStore";
import type { CodeClients } from "./codeClients";
import { codeModeHeldFor, readCodeMode } from "./codeMode";
import type { CodeToolDeps } from "./proposalCode";
import { runStagedCode, stagedCodeReach } from "./stagedCode";
import { studioStagedCodeDeps } from "./studioStagedCode";

/**
 * What the code tools are handed to read, write and evaluate the project
 * with, as the Studio's assistant hands it (`useAI`): everything of
 * `CodeToolDeps` but the build, the typecheck and the offer of a proposal,
 * which are the shell's. One function, so a test counts the requests of the
 * wiring the Studio runs (`codeToolRequests.test.ts`).
 */
export function studioCodeToolDeps(
  clients: CodeClients,
  input: {
    /** The proposal this Studio is open in; `null` on the site. */
    proposal: { name: string } | null;
    /** A person's name by profile id. */
    nameOf: (profileId: string) => string | null;
    /** The Studio's system now, of which the host takes the code; `null` before there is one. */
    system: () => { host: Pick<HostStore, "reloadCode"> } | null;
  },
): Pick<
  CodeToolDeps,
  | "proposal"
  | "client"
  | "siteSource"
  | "snapshot"
  | "codeMode"
  | "codeModeHere"
  | "nameOf"
  | "evaluateStaged"
  | "stagedCodeReach"
> {
  const shared = {
    proposal: input.proposal,
    client: clients.proposals,
    siteSource: clients.siteSource,
    snapshot: clients.snapshot,
  };
  if (input.proposal === null) return shared;
  const name = input.proposal.name;
  return {
    ...shared,
    codeMode: () => readCodeMode(clients.proposals, name, input.nameOf),
    // While this tab holds code mode as on, a write does not ask first: the
    // server refuses it if it is off by then
    codeModeHere: () => codeModeHeldFor(name),
    nameOf: input.nameOf,
    // After a staging, this tab evaluates `val.modules` and swaps the schema
    // in, so a field just added can be edited before a build
    ...(input.system() !== null
      ? {
          evaluateStaged: async () => {
            const system = input.system();
            if (system === null) return { status: "not-here" };
            return runStagedCode(
              name,
              studioStagedCodeDeps(name, clients.snapshot, system),
            );
          },
          // A write that cannot change the Val modules does not wait for
          // them to be evaluated
          stagedCodeReach: (paths) => stagedCodeReach(name, paths),
        }
      : {}),
  };
}
