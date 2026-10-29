import type { QuickPreviewOutcome } from "@valbuild/shared/publish";
import { ProposalsApiError, type ProposalsClient } from "./proposalsClient";
import type { ServerOff } from "./serverFirst";

/**
 * A quick preview made by Val Build (valbuild/home
 * `docs/plans/server-builds.md`, "Quick preview on Val Build"): the
 * proposal's staged files built there exactly as its Build builds them, and
 * the browser half of that build handed back for the page's worker. Nothing
 * is bundled here, so the page needs no cross-origin isolation and opens no
 * builder tab, and a Build of the same files afterwards is the same build.
 *
 * `off` for a project Val Build does not build yet, which content says with
 * `server-builds-off`, and which content from before quick previews were
 * made there says with a 404.
 */
export async function quickPreviewOnServer(
  name: string,
  client: {
    /** The proposal: what is staged in it is what is previewed. */
    get(name: string): Promise<{ staged?: { inputs: string | null } }>;
    quickPreview: ProposalsClient["quickPreview"];
  },
  onStep: (label: string) => void,
): Promise<QuickPreviewOutcome | ServerOff> {
  onStep("Reading the proposal");
  let inputs: string | null;
  try {
    inputs = (await client.get(name)).staged?.inputs ?? null;
  } catch (error) {
    return { status: "failed", message: messageOf(error) };
  }
  if (inputs === null) {
    return {
      status: "failed",
      message:
        "Nothing is staged in this proposal, so there is nothing to preview.",
    };
  }
  onStep("Building on Val Build");
  try {
    const answer = await client.quickPreview(name, inputs);
    return { status: "built", files: answer.files, inputs: answer.inputs };
  } catch (error) {
    if (quickPreviewOff(error)) return { status: "off" };
    return { status: "failed", message: messageOf(error) };
  }
}

function quickPreviewOff(error: unknown): boolean {
  if (!(error instanceof ProposalsApiError)) return false;
  // A route content does not have answers express's page, not JSON; a
  // proposal it does not have answers JSON, and is not this
  if (error.status === 404) {
    return typeof error.body !== "object" || error.body === null;
  }
  if (error.status !== 409) return false;
  const body: unknown = error.body;
  const details: unknown =
    typeof body === "object" && body !== null && "details" in body
      ? body.details
      : null;
  return (
    typeof details === "object" &&
    details !== null &&
    "code" in details &&
    details.code === "server-builds-off"
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
