import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useState } from "react";
import {
  PublishProposalDialog,
  type MergeCheckView,
  type PublishProposalState,
} from "../PublishProposalDialog";

/**
 * Publish, in a proposal: merging it into the site. `docs/proposals.md` in
 * valbuild/home, Flow F. The merge checks say whether it may go; Publish
 * saves anything unsaved, builds the site with the proposal, checks it renders
 * and makes it live as one change. A merged proposal is finished.
 */
const meta: Meta<typeof PublishProposalDialog> = {
  title: "Proposals/Publish",
  component: PublishProposalDialog,
  parameters: { layout: "fullscreen", backgrounds: { disable: true } },
  args: {
    open: true,
    displayName: "Spring campaign",
    onOpenChange: () => {},
    onPublish: () => {},
    onRetry: () => {},
    onCompare: () => {},
    onGoToSite: () => {},
  },
};
export default meta;
type Story = StoryObj<typeof PublishProposalDialog>;

const PASSING: MergeCheckView[] = [
  {
    id: "published-since",
    ok: true,
    message: "Nobody has published to these pages since this proposal started",
  },
  {
    id: "pending-on-site",
    ok: true,
    message: "Nobody has unpublished changes on these pages",
  },
];

const at = (state: PublishProposalState): Story => ({ args: { state } });

/** Reading the checks. */
export const Checking = at({ kind: "checking" });

/** Everything holds: Publish is offered. */
export const Ready = at({
  kind: "ready",
  checks: PASSING,
  changes: 15,
  unsaved: 0,
});

/** Three changes are not saved: Publish saves them first, and says so. */
export const ReadyWithUnsaved = at({
  kind: "ready",
  checks: PASSING,
  changes: 15,
  unsaved: 3,
});

/** Someone published to the same page since: blocked, naming who. */
export const BlockedByAPublish = at({
  kind: "ready",
  checks: [
    {
      id: "published-since",
      ok: false,
      message:
        "Kari Nordmann published changes to /products after this proposal started",
    },
    PASSING[1]!,
  ],
  changes: 15,
  unsaved: 0,
});

/** Someone has unpublished changes on the same page: blocked, naming who. */
export const BlockedByUnpublishedChanges = at({
  kind: "ready",
  checks: [
    PASSING[0]!,
    {
      id: "pending-on-site",
      ok: false,
      message: "Ola Nordmann has unpublished changes on /blog/spring-launch",
    },
  ],
  changes: 15,
  unsaved: 0,
});

/** Each step, as it runs. */
export const Saving = at({ kind: "publishing", step: "saving" });
export const Building = at({ kind: "publishing", step: "building" });
export const Publishing = at({ kind: "publishing", step: "publishing" });

/** Live on the site, and the proposal is finished. */
export const Merged = at({ kind: "merged" });

/** The merge went wrong after it was pressed: Try again. */
export const Failed = at({
  kind: "failed",
  message: "A page failed to render with these changes.",
});

/** The checks did not answer: Try again. */
export const ChecksDidNotAnswer = at({
  kind: "error",
  message: "Val Build could not be reached.",
});

/** The whole thing, pressed: checks, then each step, then merged. */
export const Interactive: Story = {
  render: (args) => {
    const [state, setState] = useState<PublishProposalState>({
      kind: "checking",
    });
    useEffect(() => {
      if (state.kind !== "checking") return;
      const timer = setTimeout(
        () =>
          setState({ kind: "ready", checks: PASSING, changes: 15, unsaved: 3 }),
        700,
      );
      return () => clearTimeout(timer);
    }, [state.kind]);
    useEffect(() => {
      if (state.kind !== "publishing") return;
      const next: PublishProposalState =
        state.step === "saving"
          ? { kind: "publishing", step: "building" }
          : state.step === "building"
            ? { kind: "publishing", step: "publishing" }
            : { kind: "merged" };
      const timer = setTimeout(() => setState(next), 900);
      return () => clearTimeout(timer);
    }, [state]);
    return (
      <PublishProposalDialog
        {...args}
        state={state}
        onPublish={() => setState({ kind: "publishing", step: "saving" })}
        onRetry={() => setState({ kind: "checking" })}
      />
    );
  },
};
