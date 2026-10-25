import {
  ProposalsApiError,
  type ProposalPreparation,
  type ProposalsClient,
} from "../proposals/proposalsClient";
import { waitForAddress } from "../proposals/useProposals";
import { upgradeDisplayName, type UpgradePath } from "./upgradesClient";
import { upgradeTabUrl } from "./upgradeTab";

/*
 * Create proposal, until the upgrade page can take over (valbuild/home
 * `docs/plans/upgrades-v2.md`, piece C): the proposal is made, set up on the
 * platform, the upgrade worked out by adept, and its dependencies built --
 * all while the person waits on Preparing…, told where it is. Then the same
 * tab goes to the upgrade page, which starts at the build.
 *
 * The same tab, not a new one: by then the press that allowed a new tab is
 * long gone, and on an iPhone a tab that opens takes the screen anyway.
 */

/** How often the preparation is asked after. */
export const PREPARATION_POLL_MS = 2_000;

/** Asking after it failing this many times in a row is a failure of its own. */
export const PREPARATION_MAX_MISSES = 5;

/** What Preparing… says beneath the button, from where the proposal is. */
export function preparationLine(preparation: ProposalPreparation): string {
  const adept = preparation.adept;
  const detail = (base: string) => {
    if (adept === null) return `${base}…`;
    if (adept.queued !== null) {
      return adept.queued > 0
        ? `${base} · waiting for a builder, ${adept.queued} ahead`
        : `${base} · waiting for a builder`;
    }
    const parts = [base];
    if (adept.step !== null) {
      parts.push(
        adept.phase !== null
          ? `${adept.step} (${adept.phase.index} of ${adept.phase.of})`
          : adept.step,
      );
    }
    if (adept.packages !== null) {
      parts.push(
        `${adept.packages.done} of ${adept.packages.expected} packages`,
      );
    }
    return parts.join(" · ");
  };
  switch (preparation.stage) {
    case "setup":
      return "Setting up the proposal…";
    case "upgrade":
      return detail("Working out the upgrade");
    case "dependencies":
      return detail("Building the dependencies");
    case "ready":
      return "Opening the upgrade…";
    case "nothing":
      return "There is nothing to upgrade.";
    case "failed":
      return preparation.error ?? "The upgrade could not be prepared.";
  }
}

export type PreparedUpgrade =
  /** Its dependencies are built: the upgrade page takes over at `url`. */
  | { status: "ready"; name: string; url: string }
  /** It moved nothing: the proposal was closed again. */
  | { status: "nothing" }
  /** It could not be prepared: the proposal was closed, and why. */
  | { status: "failed"; message: string };

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export async function prepareUpgrade(deps: {
  client: Pick<ProposalsClient, "create" | "get" | "close" | "preparation">;
  path: UpgradePath;
  skip: string[];
  /** The press's: pressing again after a failure that was not an answer makes the same proposal. */
  requestId: string;
  onLine: (line: string) => void;
  sleep?: (ms: number) => Promise<void>;
}): Promise<PreparedUpgrade> {
  const sleep =
    deps.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const { client } = deps;
  deps.onLine("Creating the proposal…");
  let made;
  try {
    made = await client.create({
      requestId: deps.requestId,
      displayName: upgradeDisplayName(deps.path),
      kind: "upgrade",
      upgrade: {
        path: deps.path,
        ...(deps.skip.length > 0 ? { skip: deps.skip } : {}),
      },
    });
  } catch (error) {
    return { status: "failed", message: messageOf(error) };
  }
  const name = made.name;
  // What cannot become an upgrade is not left among the proposals.
  const closeIt = async () => {
    try {
      await client.close(name);
    } catch {
      // Still listed, and closable from there: nothing here depends on it.
    }
  };
  let misses = 0;
  for (;;) {
    let preparation: ProposalPreparation;
    try {
      preparation = await client.preparation(name);
      misses = 0;
    } catch (error) {
      // A content service from before preparations: the upgrade page
      // follows the rest itself, as it did.
      if (error instanceof ProposalsApiError && error.status === 404) {
        preparation = { stage: "ready", error: null, adept: null };
      } else if (++misses >= PREPARATION_MAX_MISSES) {
        return {
          status: "failed",
          message: `Val Build stopped answering while the upgrade was being prepared: ${messageOf(error)} The proposal is still there, and continues without this page.`,
        };
      } else {
        await sleep(PREPARATION_POLL_MS);
        continue;
      }
    }
    deps.onLine(preparationLine(preparation));
    switch (preparation.stage) {
      case "ready": {
        let origin: string;
        try {
          origin = made.address ?? (await waitForAddress(client, name));
        } catch (error) {
          return { status: "failed", message: messageOf(error) };
        }
        return { status: "ready", name, url: upgradeTabUrl(origin, name) };
      }
      case "nothing":
        await closeIt();
        return { status: "nothing" };
      case "failed":
        await closeIt();
        return {
          status: "failed",
          message: preparation.error ?? "The upgrade could not be prepared.",
        };
      default:
        await sleep(PREPARATION_POLL_MS);
    }
  }
}
