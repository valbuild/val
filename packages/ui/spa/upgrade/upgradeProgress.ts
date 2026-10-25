import type { ProposalCodeState } from "../components/proposals/types";
import type {
  ProposalJson,
  ProposalTypeError,
  ProposalUpgrade,
} from "../proposals/proposalsClient";
import type { ProposalTypecheckState } from "../proposals/useProposalTypecheck";
import type { ProposalBuildProgress } from "../proposals/proposalBuildProgress";
import type { PublishProposalState } from "../components/proposals/PublishProposalDialog";

/*
 * Where an upgrade proposal is, step by step, as its dialog shows it
 * (valbuild/home `docs/adept.md`, "How one Upgrade goes" and decision 20):
 * the upgrade computed, its dependencies built, the typecheck, the build,
 * the build rendered on the platform -- and Publish once there are no new
 * type errors and the build renders. Worked out from what content says about
 * the proposal, the typecheck this tab runs, the bar's build and the render
 * this tab asked for, so the dialog says no more than they do.
 */

/**
 * The proposal's own build, rendered on the platform as a canary
 * (valbuild/home `docs/plans/upgrades-v2.md`, piece E): an upgrade can move
 * the framework and React the site runs on, which a typecheck cannot judge
 * and a render can. For the build `key` names (its hash and inputs).
 */
export type UpgradeRenderState =
  | { status: "idle" }
  | { status: "running"; key: string }
  | { status: "passed"; key: string }
  | { status: "failed"; key: string; message: string; retryable: boolean }
  /** A content service that cannot render one: the publish still does. */
  | { status: "unsupported"; key: string };

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
    | {
        state: UpgradeStepState;
        detail: string | null;
        /** How far a running build is, when it can say. */
        percent: number | null;
      }
    /** Staged and not built, and not building yet: it starts by itself. */
    | { state: "required"; detail: null; percent: null }
    /**
     * This page cannot build, and the browser opens the tab that does only
     * from a tap: the footer asks for it.
     */
    | { state: "tap"; detail: null; percent: null };
  render: {
    state: UpgradeStepState;
    detail: string | null;
    /** Whether Try again can help a failed one: the platform's failure. */
    retryable: boolean;
    /** Content could not render it here; the publish renders it. */
    deferred: boolean;
  };
  /** No new type errors, built, and it renders: Publish can be pressed. */
  canPublish: boolean;
};

/** The build a render is of: what it was built from, and what it is. */
export function renderKeyOf(proposal: ProposalJson): string | null {
  const built = proposal.built ?? null;
  const staged = proposal.staged ?? null;
  if (built === null || staged === null || staged.buildRequired) return null;
  if (staged.inputs === null || built.inputs !== staged.inputs) return null;
  return `${built.hash}:${built.inputs}`;
}

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
  buildProgress?: ProposalBuildProgress | null;
  render: UpgradeRenderState;
}): UpgradeProgressView {
  const { proposal, upgrade, typecheck, code } = input;
  const buildProgress = input.buildProgress ?? null;
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
    ? { state: "waiting", detail: null, percent: null }
    : code === null
      ? { state: "done", detail: null, percent: null }
      : code.state === "building"
        ? {
            state: "running",
            detail: buildProgress?.label ?? null,
            percent: buildProgress?.percent ?? null,
          }
        : code.state === "failed"
          ? { state: "failed", detail: code.error, percent: null }
          : code.state === "blocked"
            ? { state: "tap", detail: null, percent: null }
            : code.state === "required"
              ? { state: "required", detail: null, percent: null }
              : { state: "waiting", detail: null, percent: null };

  const checked =
    staged &&
    dependenciesView.state === "done" &&
    typecheckView.state === "done" &&
    typecheckView.newErrors === 0 &&
    buildView.state === "done";
  // Rendered once it is checked and built: a build that adds type errors is
  // not one to publish, so there is nothing to render it for.
  const key = renderKeyOf(proposal);
  const render: UpgradeRenderState =
    "key" in input.render && input.render.key === key
      ? input.render
      : { status: "idle" };
  const renderView: UpgradeProgressView["render"] = !checked
    ? { state: "waiting", detail: null, retryable: false, deferred: false }
    : render.status === "passed"
      ? { state: "done", detail: null, retryable: false, deferred: false }
      : render.status === "unsupported"
        ? { state: "done", detail: null, retryable: false, deferred: true }
        : render.status === "failed"
          ? {
              state: "failed",
              detail: render.message,
              retryable: render.retryable,
              deferred: false,
            }
          : // Running, or about to: it starts by itself.
            {
              state: "running",
              detail: null,
              retryable: false,
              deferred: false,
            };

  return {
    upgrade,
    dependencies: dependenciesView,
    typecheck: typecheckView,
    build: buildView,
    render: renderView,
    canPublish: checked && renderView.state === "done",
  };
}

/**
 * What the dialog's footer says, and its one button: the step that needs a
 * press, in the place Publish is. Everything else runs by itself.
 *
 * - `retry`: a step failed and pressing again can help; which one it runs.
 * - `build`: this page cannot build, and only a tap opens the tab that does.
 * - `lockfile`: the dependencies changed without a lockfile to match.
 * - `publish`: Publish, pressable or not.
 * - `review`: a check this dialog cannot clear (the site changed under the
 *   proposal): the proposal's own Publish dialog, which can.
 * - `site`: published -- Go to site.
 * - `close`: nothing more can happen here.
 */
export type UpgradeFooter = {
  note: string;
  action:
    | {
        kind: "retry";
        step: "typecheck" | "build" | "render" | "publish";
      }
    | { kind: "build" }
    | { kind: "lockfile" }
    | { kind: "publish"; enabled: boolean; busy: boolean }
    | { kind: "review" }
    | { kind: "site" }
    | { kind: "close" };
};

/** "It was not published: …" reads as a sentence whatever content wrote. */
function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

export function upgradeFooterOf(
  view: UpgradeProgressView | null,
  publish: PublishProposalState,
): UpgradeFooter {
  const waitPublish = (note: string): UpgradeFooter => ({
    note,
    action: { kind: "publish", enabled: false, busy: false },
  });
  if (view === null) return waitPublish("Loading the upgrade…");
  // Publishing, once started, says how it went whatever the steps above say.
  switch (publish.kind) {
    case "merged":
      return {
        note: "Published. The site runs the upgrade.",
        action: { kind: "site" },
      };
    case "publishing":
      return {
        note:
          publish.step === "building"
            ? "Building the site with the upgrade…"
            : publish.step === "saving"
              ? "Saving the proposal…"
              : "Publishing…",
        action: { kind: "publish", enabled: false, busy: true },
      };
    case "failed":
      return {
        note: `It was not published: ${sentence(publish.message)} Nothing on the site has changed.`,
        action: { kind: "retry", step: "publish" },
      };
  }
  const { upgrade, dependencies, typecheck, build, render } = view;
  if (upgrade.state === "computing") {
    return waitPublish("Publish waits for the upgrade to be computed.");
  }
  if (upgrade.state === "nothing") {
    return {
      note: "There is nothing to publish: close this proposal.",
      action: { kind: "close" },
    };
  }
  if (upgrade.state === "failed") {
    return {
      note: "The upgrade could not be computed. Nothing on the site has changed.",
      action: { kind: "close" },
    };
  }
  if (dependencies.state === "lockfile") {
    return {
      note: "The dependencies need a lockfile before they can be built.",
      action: { kind: "lockfile" },
    };
  }
  if (dependencies.state === "failed") {
    return {
      note: "The dependencies could not be built. Nothing on the site has changed.",
      action: { kind: "close" },
    };
  }
  if (typecheck.state === "failed" && typecheck.retryable) {
    return {
      note: "The typecheck did not finish. Nothing on the site has changed.",
      action: { kind: "retry", step: "typecheck" },
    };
  }
  if (typecheck.state === "done" && (typecheck.newErrors ?? 0) > 0) {
    return waitPublish(
      "It stays open until the new type errors are fixed in this proposal.",
    );
  }
  if (build.state === "failed") {
    return {
      note: "The build failed. Nothing on the site has changed.",
      action: { kind: "retry", step: "build" },
    };
  }
  if (build.state === "tap") {
    return {
      note: "On this device the build runs in a new tab.",
      action: { kind: "build" },
    };
  }
  if (render.state === "failed") {
    return render.retryable
      ? {
          note: "The new build could not be rendered on the platform. Nothing on the site has changed.",
          action: { kind: "retry", step: "render" },
        }
      : {
          note: "The new build does not render, so it cannot be published. Nothing on the site has changed.",
          action: { kind: "close" },
        };
  }
  if (render.state === "running") {
    return waitPublish("Publish waits for the new build to render.");
  }
  if (!view.canPublish) {
    return waitPublish(
      build.state === "running" || build.state === "required"
        ? "Publish waits for the build."
        : "Publish waits for the typecheck and the build.",
    );
  }
  if (publish.kind === "checking") {
    return waitPublish("Checking it can be published…");
  }
  if (publish.kind === "error") {
    return {
      note: `Could not check whether it can be published: ${sentence(publish.message)}`,
      action: { kind: "retry", step: "publish" },
    };
  }
  const failing = publish.checks.find((check) => !check.ok);
  if (failing !== undefined) {
    return {
      note: sentence(failing.message),
      action:
        failing.action === "update-from-site"
          ? { kind: "review" }
          : { kind: "publish", enabled: false, busy: false },
    };
  }
  return {
    note: render.deferred
      ? "Built, and no new type errors."
      : "Built, no new type errors, and it renders.",
    action: { kind: "publish", enabled: true, busy: false },
  };
}
