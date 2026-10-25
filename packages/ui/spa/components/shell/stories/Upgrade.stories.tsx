import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { UpgradeDialog } from "../../../upgrade/UpgradeDialog";
import { UpgradeProgressPage } from "../../../upgrade/UpgradeProgressPage";
import type { UpgradeStart } from "../../../upgrade/UpgradeChooser";
import {
  upgradeFooterOf,
  type UpgradeProgressView,
} from "../../../upgrade/upgradeProgress";
import type { PublishProposalState } from "../../proposals/PublishProposalDialog";
import type { UpgradeCheckState } from "../../../upgrade/useUpgradeCheck";

/**
 * The Upgrade (valbuild/home `docs/adept.md`, step 7): the button's dialog,
 * which opens the upgrade in a tab of its own, and that tab's page following
 * the upgrade proposal to Go to site -- computed, its dependencies built, typechecked, built,
 * published (decision 20). Nothing here talks to content: each story is one
 * state.
 */
const meta: Meta = {
  title: "Shell/Upgrade",
  parameters: { layout: "fullscreen", backgrounds: { disable: true } },
};
export default meta;

const CHECKED: UpgradeCheckState = {
  status: "checked",
  at: 0,
  check: {
    state: "checked",
    checkedAt: "2026-10-21T10:00:00.000Z",
    available: true,
    cves: {
      vulnerable: 2,
      fixable: 3,
      severity: "high",
      packages: [
        { name: "lodash", version: "4.17.20", severity: "high" },
        { name: "cookie", version: "0.6.0", severity: "moderate" },
      ],
    },
    latest: {
      packages: [
        { name: "@valbuild/tanstack", from: "0.149.4", to: "0.150.0" },
        { name: "@valbuild/ui", from: "0.149.4", to: "0.150.0" },
        { name: "zod", from: "3.23.8", to: "3.25.76" },
        { name: "@tanstack/react-router", from: "1.120.3", to: "1.131.2" },
      ],
      val: { from: "0.149.4", to: "0.150.0" },
    },
    majors: {
      packages: [
        { name: "react", from: "18.3.1", to: "19.2.0" },
        { name: "vite", from: "6.3.5", to: "7.1.4" },
      ],
    },
  },
};

function Choose({
  check,
  start,
}: {
  check: UpgradeCheckState;
  start: UpgradeStart;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="h-screen bg-bg-primary text-fg-primary">
      <UpgradeDialog
        open={open}
        onOpenChange={setOpen}
        check={check}
        start={start}
        onStart={() => {}}
        onRecheck={() => {}}
      />
    </div>
  );
}

export const Choosing: StoryObj = {
  render: () => <Choose check={CHECKED} start={{ status: "idle" }} />,
};

export const Opening: StoryObj = {
  render: () => <Choose check={CHECKED} start={{ status: "starting" }} />,
};

export const CheckFailed: StoryObj = {
  render: () => (
    <Choose
      check={{ status: "failed", message: "Val Build answered 502." }}
      start={{ status: "idle" }}
    />
  ),
};

const READY: UpgradeProgressView = {
  upgrade: {
    path: "majors",
    state: "staged",
    changes: [
      { name: "react", from: "18.3.1", to: "19.2.0", kind: "major" },
      { name: "react-dom", from: "18.3.1", to: "19.2.0", kind: "major" },
    ],
    vulnerableBefore: null,
    vulnerableAfter: null,
    error: null,
  },
  dependencies: { state: "done", detail: null },
  typecheck: {
    state: "done",
    newErrors: 0,
    errors: [],
    detail: null,
    retryable: true,
  },
  build: { state: "done", detail: null, percent: null },
  render: { state: "done", detail: null, retryable: false, deferred: false },
  canPublish: true,
};

const CHECKS_PASS: PublishProposalState = {
  kind: "ready",
  checks: [
    { id: "site-code", ok: true, message: "The site's code is as it was." },
  ],
  changes: 2,
  unsaved: 0,
};

function Follow({
  view,
  publish = CHECKS_PASS,
}: {
  view: UpgradeProgressView | null;
  publish?: PublishProposalState;
}) {
  return (
    <div className="h-screen bg-bg-primary text-fg-primary">
      <UpgradeProgressPage
        displayName={view === null ? null : "Upgrade to new major versions"}
        view={view}
        publish={publish}
        footer={upgradeFooterOf(view, publish)}
        onComputeLockfile={() => {}}
        onTypecheck={() => {}}
        onBuild={() => {}}
        onRender={() => {}}
        onPublish={() => {}}
        onRetryPublish={() => {}}
        onCheckMerge={() => {}}
        onReview={() => {}}
        onDiscard={() => {}}
        onGoToSite={() => {}}
        onCloseTab={() => {}}
      />
    </div>
  );
}

/** The page has just opened at the proposal's address. */
export const Loading: StoryObj = {
  render: () => <Follow view={null} publish={{ kind: "checking" }} />,
};

export const Computing: StoryObj = {
  render: () => (
    <Follow
      view={{
        ...READY,
        upgrade: { ...READY.upgrade, state: "computing", changes: [] },
        dependencies: { state: "waiting", detail: null },
        typecheck: { ...READY.typecheck, state: "waiting", newErrors: null },
        build: { state: "waiting", detail: null, percent: null },
        canPublish: false,
      }}
    />
  ),
};

export const Typechecking: StoryObj = {
  render: () => (
    <Follow
      view={{
        ...READY,
        typecheck: {
          state: "running",
          newErrors: null,
          errors: [],
          detail: "The upgrade: Loading types (214)",
          retryable: false,
        },
        build: { state: "required", detail: null, percent: null },
        canPublish: false,
      }}
    />
  ),
};

/** Started by itself once the dependencies were built. */
export const Building: StoryObj = {
  render: () => (
    <Follow
      view={{
        ...READY,
        build: {
          state: "running",
          detail: "Uploading 41 of 112",
          percent: 46,
        },
        canPublish: false,
      }}
    />
  ),
};

export const BuildFailed: StoryObj = {
  render: () => (
    <Follow
      view={{
        ...READY,
        build: {
          state: "failed",
          detail: "The proposals API answered 502.",
          percent: null,
        },
        canPublish: false,
      }}
    />
  ),
};

/** An iPhone: the builder tab opens only from a tap. */
export const BuildNeedsATap: StoryObj = {
  render: () => (
    <Follow
      view={{
        ...READY,
        build: { state: "tap", detail: null, percent: null },
        canPublish: false,
      }}
    />
  ),
};

export const NewTypeErrors: StoryObj = {
  render: () => (
    <Follow
      view={{
        ...READY,
        typecheck: {
          state: "done",
          newErrors: 3,
          errors: [
            {
              file: "src/components/Hero.tsx",
              line: 12,
              column: 7,
              code: 2322,
              message:
                "Type 'Element | undefined' is not assignable to type 'ReactNode'.",
            },
            {
              file: "src/components/Hero.tsx",
              line: 30,
              column: 3,
              code: 2786,
              message: "'Slot' cannot be used as a JSX component.",
            },
            {
              file: "src/routes/index.tsx",
              line: 4,
              column: 10,
              code: 2305,
              message: "Module '\"react\"' has no exported member 'FC'.",
            },
          ],
          detail: null,
          retryable: true,
        },
        canPublish: false,
      }}
    />
  ),
};

export const ReadyToPublish: StoryObj = {
  render: () => <Follow view={READY} />,
};

export const Publishing: StoryObj = {
  render: () => (
    <Follow view={READY} publish={{ kind: "publishing", step: "publishing" }} />
  ),
};

export const PublishFailed: StoryObj = {
  render: () => (
    <Follow
      view={READY}
      publish={{
        kind: "failed",
        message: "The site moved on while it was being published",
      }}
    />
  ),
};

export const Published: StoryObj = {
  render: () => <Follow view={READY} publish={{ kind: "merged" }} />,
};
