import type { BuildTargetResponse } from "../internal";
import type { StudioDeployResult } from "./runStudioDeploy";

/*
 * Building a proposal's staged files and serving the build at its address:
 * valbuild/home `docs/hosted-publishing.md`, step 7. The Studio builds one
 * from its proposals bar, and home's upgrade page builds an upgrade's; each
 * reaches content its own way, so the client is the caller's.
 */

/** A proposal as content answers it, as far as a build reads it. */
export type BuiltProposal = {
  staged?: { inputs: string | null; buildRequired: boolean } | null;
  built?: { hash: string; inputs?: string | null } | null;
};

/** The calls a build of a proposal makes. An error carries content's `status`. */
export type ProposalBuildClient<P extends BuiltProposal> = {
  /** Its files, and what is staged. */
  files(name: string): Promise<{
    files: Record<string, string | null>;
    staged: { inputs: string | null; buildRequired: boolean };
  }>;
  /** What it builds on: its own layer, or the site's. */
  buildTarget(
    name: string,
  ): Promise<{ target: BuildTargetResponse; layer: "site" | "own" }>;
  serveBuild(
    name: string,
    build: { publishId: string; inputs: string },
  ): Promise<P>;
  get(name: string): Promise<P>;
};

/** The HTTP status an error carries, if it is an answer at all. */
function statusOf(error: unknown): number | null {
  return typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
    ? error.status
    : null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** What a build of the proposal came to. */
export type ProposalBuildOutcome<P> =
  | { status: "built"; hash: string | null; proposal: P }
  | { status: "nothing-staged" }
  | { status: "already-built"; hash: string | null }
  | {
      status: "failed";
      message: string;
      /**
       * Stopped by whoever started it (`signal`), not by anything wrong with
       * the build: nothing to fix, and nothing to show as an error.
       */
      cancelled?: true;
    };

/** What a cancelled build answers. */
export const BUILD_CANCELLED_MESSAGE = "The build was cancelled.";

/**
 * Why a build stopped early, as its outcome: `signal.reason` when it was
 * stopped with an `Error` of its own -- a watchdog saying where it stalled --
 * and otherwise a cancel.
 */
function abortedOutcome(signal: AbortSignal | undefined): {
  status: "failed";
  message: string;
  cancelled?: true;
} {
  const reason: unknown = signal?.reason;
  return reason instanceof Error && reason.name !== "AbortError"
    ? { status: "failed", message: reason.message }
    : { status: "failed", message: BUILD_CANCELLED_MESSAGE, cancelled: true };
}

const ABORTED = Symbol("aborted");

/**
 * `work`, or `ABORTED` as soon as `signal` is: a request that never answers
 * is not waited for once the build is stopped. The work itself is not
 * stopped by this -- the caller's `signal` does that where it can -- only no
 * longer waited for.
 */
function orAborted<T>(
  work: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T | typeof ABORTED> {
  if (signal === undefined) return work;
  if (signal.aborted) return Promise.resolve(ABORTED);
  return new Promise((resolve, reject) => {
    const onAbort = () => resolve(ABORTED);
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/**
 * Where a build of the proposal is, around the deploy: the deploy's own steps
 * are the Studio's deploy state (`useStudioDeployState`), and these are the
 * parts before and after it.
 *
 * - `reading`: the proposal's files and the target to build them on.
 * - `deploying`: the deploy is running; its state says which step.
 * - `serving`: content is putting the build up at the proposal's address.
 * - `waiting`: that request did not come back -- a gateway gave up on it --
 *   and content is asked until it says the proposal is built.
 */
export type ProposalBuildStep =
  | { kind: "reading" }
  | { kind: "deploying" }
  | { kind: "serving"; since: number }
  | { kind: "waiting"; since: number };

/**
 * Files that never go into a build: lockfiles, at any depth. The same list as
 * content's `NEVER_SHIPPED` (valbuild/home `content/src/val/dependencyFiles.ts`).
 *
 * A merge builds from the site's source with the proposal's files over it,
 * without these (`shippedFiles` there). The proposal's own build has to be
 * made of the same files, or the two are named differently: a merge then
 * never finds the proposal's build held, and builds the whole site again --
 * which is every upgrade, since an upgrade stages a `pnpm-lock.yaml`.
 */
const NEVER_SHIPPED = new Set([
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
]);

export function withoutLockfiles<T>(
  files: Record<string, T>,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(files).filter(
      ([path]) => !NEVER_SHIPPED.has(path.slice(path.lastIndexOf("/") + 1)),
    ),
  );
}

/**
 * Whether serving got no answer from content rather than a refusal: the
 * connection failed, or a gateway stopped waiting -- Cloudflare's 52x (524 is
 * "no answer in 100 seconds"), and the 502-504 of anything else in between.
 * Content goes on with the request either way, so the build may well be
 * served.
 */
function gatewayGaveUp(error: unknown): boolean {
  // No answer at all: `fetch` rejects with a TypeError when the connection
  // fails or is cut. Anything else is a failure with words of its own.
  if (error instanceof TypeError) return true;
  const status = statusOf(error);
  if (status === null) return false;
  return (
    status === 502 ||
    status === 503 ||
    status === 504 ||
    (status >= 520 && status <= 527)
  );
}

/** How long, and how often, content is asked whether it served the build. */
export const SERVE_WAIT_MS = 4 * 60_000;
export const SERVE_POLL_MS = 5_000;

/**
 * Build the proposal's staged files and serve the build at its address.
 *
 * The files and what they are for (`inputs`) come in one answer, so the build
 * names exactly what it was made of; content refuses it if they were staged
 * again meanwhile. The tab builds as for a publish and stops once the build is
 * uploaded -- nothing goes live -- and content hands it to the platform.
 *
 * Serving can take longer than a gateway waits for an answer, and content
 * finishes it all the same. So a gateway that gives up is not a failure: the
 * proposal is read until it says it is built from these inputs, and served
 * once more only if it never does.
 */
export async function buildProposal<P extends BuiltProposal>(deps: {
  name: string;
  client: ProposalBuildClient<P>;
  /**
   * `target`: the proposal's own, when it changed the dependencies and builds
   * on the layer content had built for it; `undefined` builds on the site's,
   * as every build of a proposal did before.
   */
  deploy: (
    files: Record<string, string | null>,
    target: BuildTargetResponse | undefined,
    signal: AbortSignal | undefined,
  ) => Promise<StudioDeployResult>;
  /**
   * Whether this document can build at all (`canBuildHere`): Safari cannot,
   * and a proposal's build has no builder tab to hand off to yet.
   */
  canBuildHere: () => boolean;
  onStep?: (step: ProposalBuildStep) => void;
  /**
   * Stops the build: Cancel, or a watchdog that saw it stall. Answered at
   * once, whatever the build was waiting on, and nothing after it is done --
   * a build stopped while it uploads is never served. Aborted with an `Error`
   * of its own, the build fails with that error's message; otherwise it is
   * `cancelled`.
   */
  signal?: AbortSignal;
  /** For tests: the clock, and waiting on it. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<ProposalBuildOutcome<P>> {
  const now = deps.now ?? Date.now;
  const sleep =
    deps.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const step = deps.onStep ?? (() => {});
  if (!deps.canBuildHere()) {
    return {
      status: "failed",
      message:
        "This browser cannot build in this tab. Open the proposal in Chrome, Edge or Firefox and build it there",
    };
  }
  const signal = deps.signal;
  step({ kind: "reading" });
  let read;
  try {
    read = await orAborted(deps.client.files(deps.name), signal);
  } catch (error) {
    return { status: "failed", message: messageOf(error) };
  }
  if (read === ABORTED || signal?.aborted) return abortedOutcome(signal);
  const { files, staged } = read;
  if (staged.inputs === null) return { status: "nothing-staged" };
  if (!staged.buildRequired) return { status: "already-built", hash: null };
  const inputs = staged.inputs;
  let target: BuildTargetResponse | undefined;
  try {
    const asked = await orAborted(deps.client.buildTarget(deps.name), signal);
    if (asked === ABORTED) return abortedOutcome(signal);
    target = asked.layer === "own" ? asked.target : undefined;
  } catch (error) {
    // A content service from before proposals had targets of their own:
    // every proposal builds on the site's layer there, as it always did.
    if (statusOf(error) !== 404) {
      // Content's words: the dependencies are being built, or why they
      // could not be.
      return { status: "failed", message: messageOf(error) };
    }
  }
  if (signal?.aborted) return abortedOutcome(signal);
  step({ kind: "deploying" });
  const built = await orAborted(
    deps.deploy(withoutLockfiles(files), target, signal),
    signal,
  );
  // Never served once stopped, whatever the deploy got as far as.
  if (built === ABORTED || signal?.aborted) return abortedOutcome(signal);
  if (built.status !== "uploaded") {
    return {
      status: "failed",
      message:
        built.status === "failed"
          ? built.message
          : "The build went live instead of stopping once uploaded.",
    };
  }
  const serve = async () => {
    step({ kind: "serving", since: now() });
    return deps.client.serveBuild(deps.name, {
      publishId: built.publishId,
      inputs,
    });
  };
  const servedNow = async (): Promise<P | null> => {
    try {
      const proposal = await deps.client.get(deps.name);
      return proposal.staged?.inputs === inputs &&
        proposal.staged.buildRequired === false &&
        proposal.built?.hash
        ? proposal
        : null;
    } catch {
      return null;
    }
  };
  const builtOf = (proposal: P): ProposalBuildOutcome<P> => ({
    status: "built",
    hash: proposal.built?.hash ?? null,
    proposal,
  });
  try {
    const served = await orAborted(serve(), signal);
    if (served === ABORTED) return abortedOutcome(signal);
    return builtOf(served);
  } catch (error) {
    if (!gatewayGaveUp(error)) {
      return { status: "failed", message: messageOf(error) };
    }
    const since = now();
    step({ kind: "waiting", since });
    while (now() - since < SERVE_WAIT_MS) {
      if ((await orAborted(sleep(SERVE_POLL_MS), signal)) === ABORTED) {
        return abortedOutcome(signal);
      }
      const served = await orAborted(servedNow(), signal);
      if (served === ABORTED) return abortedOutcome(signal);
      if (served !== null) return builtOf(served);
    }
    // Content never said: ask once more, and take its answer.
    try {
      const again = await orAborted(serve(), signal);
      if (again === ABORTED) return abortedOutcome(signal);
      return builtOf(again);
    } catch (again) {
      return { status: "failed", message: messageOf(again) };
    }
  }
}
