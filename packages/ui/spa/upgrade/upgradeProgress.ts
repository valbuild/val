import type { ProposalCodeState } from "../components/proposals/types";
import type {
  ProposalJson,
  ProposalTypeError,
  ProposalUpgrade,
} from "../proposals/proposalsClient";
import type { ProposalTypecheckState } from "../proposals/useProposalTypecheck";

/*
 * Where an upgrade proposal is, step by step, as its dialog shows it
 * (valbuild/home `docs/adept.md`, "How one Upgrade goes" and decision 20):
 * the upgrade computed, its dependencies built, the typecheck, the build --
 * and Publish once there are no new type errors and it is built. Worked out
 * from what content says about the proposal, the typecheck this tab runs and
 * the bar's build, so the dialog says no more than they do.
 */

export type UpgradeStepState = "waiting" | "running" | "done" | "failed";

export type UpgradeProgressView = {
  upgrade: ProposalUpgrade;
  dependencies:
    | { state: UpgradeStepState; detail: string | null }
    /** The lockfile does not match: the button computes it. */
    | { state: "lockfile"; detail: string | null };
  typecheck: {
    state: UpgradeStepState;
    /** New errors in all; `null` until it is checked. */
    newErrors: number | null;
    /** The ones content keeps, or this tab found. */
    errors: ProposalTypeError[];
    detail: string | null;
    /** Whether Typecheck again can help a failed one. */
    retryable: boolean;
  };
  build:
    | { state: UpgradeStepState; detail: string | null }
    /** Staged and not built: Build makes the preview. */
    | { state: "required"; detail: null };
  /** No new type errors, and built: Publish can be pressed. */
  canPublish: boolean;
};

function stepOfTypecheck(typecheck: ProposalTypecheckState): string | null {
  if (typecheck.status !== "running" || typecheck.step === null) return null;
  const step = typecheck.step;
  switch (step.step) {
    case "reading":
      return "Reading the proposal's files";
    case "lockfile":
      return "Computing the site's lockfile to compare against";
    case "checking":
      return `${step.which === "site" ? "The site" : "The upgrade"}: ${step.detail}`;
  }
}

export function upgradeProgressOf(input: {
  proposal: ProposalJson;
  upgrade: ProposalUpgrade;
  typecheck: ProposalTypecheckState;
  code: ProposalCodeState | null;
}): UpgradeProgressView {
  const { proposal, upgrade, typecheck, code } = input;
  const staged = upgrade.state === "staged";
  const dependencies = proposal.dependencies;
  const dependenciesView: UpgradeProgressView["dependencies"] = !staged
    ? { state: "waiting", detail: null }
    : dependencies === undefined
      ? { state: "done", detail: null }
      : dependencies.state === "lockfile"
        ? dependencies.computing
          ? { state: "running", detail: "Computing the lockfile" }
          : { state: "lockfile", detail: dependencies.error }
        : dependencies.state === "failed"
          ? { state: "failed", detail: dependencies.error }
          : dependencies.state === "pending"
            ? { state: "running", detail: null }
            : { state: "done", detail: null };

  const inputs = proposal.staged?.inputs ?? null;
  const reported =
    proposal.typecheck !== undefined &&
    proposal.typecheck !== null &&
    inputs !== null &&
    proposal.typecheck.inputs === inputs
      ? proposal.typecheck
      : null;
  const mine = "name" in typecheck && typecheck.name === proposal.name;
  // A typecheck needs a lockfile that matches, not the built dependencies.
  const checkable = staged && dependenciesView.state !== "lockfile";
  const typecheckView: UpgradeProgressView["typecheck"] =
    mine && typecheck.status === "running"
      ? {
          state: "running",
          newErrors: null,
          errors: [],
          detail: stepOfTypecheck(typecheck),
          retryable: false,
        }
      : reported !== null
        ? {
            state: "done",
            newErrors: reported.newErrors,
            errors:
              mine && typecheck.status === "done" && typecheck.inputs === inputs
                ? typecheck.errors
                : reported.errors,
            detail: null,
            retryable: true,
          }
        : mine && typecheck.status === "failed"
          ? {
              state: "failed",
              newErrors: null,
              errors: [],
              detail: typecheck.message,
              retryable: typecheck.retryable,
            }
          : {
              state: checkable ? "running" : "waiting",
              newErrors: null,
              errors: [],
              detail: null,
              retryable: false,
            };

  const buildView: UpgradeProgressView["build"] = !staged
    ? { state: "waiting", detail: null }
    : code === null
      ? { state: "done", detail: null }
      : code.state === "building"
        ? { state: "running", detail: null }
        : code.state === "failed"
          ? { state: "failed", detail: code.error }
          : code.state === "required" || code.state === "blocked"
            ? { state: "required", detail: null }
            : { state: "waiting", detail: null };

  return {
    upgrade,
    dependencies: dependenciesView,
    typecheck: typecheckView,
    build: buildView,
    canPublish:
      staged &&
      dependenciesView.state === "done" &&
      typecheckView.state === "done" &&
      typecheckView.newErrors === 0 &&
      buildView.state === "done",
  };
}
