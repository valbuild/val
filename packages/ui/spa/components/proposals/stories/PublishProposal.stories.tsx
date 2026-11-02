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

/**
 * Someone changed the same field on the site since: blocked, naming the field
 * and who (valbuild/home `docs/hosted-publishing.md`, step 8).
 */
export const BlockedByTheSameField = at({
  kind: "ready",
  checks: [
    {
      id: "published-since",
      ok: false,
      message:
        "Kari Nordmann changed hero › title on /content/home.val.ts after this proposal started, and this proposal changes it too",
    },
    PASSING[1]!,
  ],
  changes: 15,
  unsaved: 0,
});

/**
 * The site's code changed under the proposal's code: Update from the site is
 * offered beside the reason, which moves it onto the site and asks for a
 * build (step 8).
 */
export const BlockedByTheSitesCode: Story = {
  args: {
    state: {
      kind: "ready",
      checks: [
        ...PASSING,
        {
          id: "site-code",
          ok: false,
          message:
            "The site's code changed after this proposal started, so the code changed here has to be built on the site as it is now. Update from the site, then build it",
          action: "update-from-site",
        },
      ],
      changes: 4,
      unsaved: 0,
    },
    onUpdateFromSite: () => console.log("update from the site"),
  },
};

/** Updating from the site, from that check. */
export const UpdatingFromTheSite: Story = {
  args: {
    ...BlockedByTheSitesCode.args,
    updating: true,
  },
};

/**
 * A page the site published since, in a proposal that changes only content:
 * Update from the site merges it in (step 8.2).
 */
export const BlockedByAPageTheSitePublished: Story = {
  args: {
    state: {
      kind: "ready",
      checks: [
        {
          id: "published-since",
          ok: false,
          message:
            "Kari Nordmann changed hero › subtitle on /content/home.val.ts after this proposal started",
          action: "update-from-site",
        },
        PASSING[1]!,
      ],
      changes: 3,
      unsaved: 0,
    },
    onUpdateFromSite: (checkId: string) =>
      console.log("update from the site", checkId),
  },
};

/**
 * The update found what both changed: each is decided here, and the update
 * then merges with those decisions. The same value on both sides is a
 * conflict too -- an easy one.
 */
export const UpdateConflicts: Story = {
  args: {
    ...BlockedByAPageTheSitePublished.args,
    state: {
      kind: "ready",
      checks:
        BlockedByAPageTheSitePublished.args?.state?.kind === "ready"
          ? BlockedByAPageTheSitePublished.args.state.checks
          : [],
      changes: 3,
      unsaved: 0,
      conflicts: [
        {
          kind: "field",
          moduleFilePath: "/content/home.val.ts",
          path: ["hero", "title"],
          site: "Spring sale",
          proposal: "Summer sale",
        },
        {
          kind: "field",
          moduleFilePath: "/content/home.val.ts",
          path: ["hero", "image"],
          site: { path: "/public/val/beach.png", alt: "A beach" },
          proposal: { path: "/public/val/sale.png", alt: "A big sale" },
        },
        {
          kind: "field",
          moduleFilePath: "/content/home.val.ts",
          path: ["cta"],
          site: "Shop now",
          proposal: "Shop now",
        },
      ],
    },
    onResolve: (keep: ("site" | "proposal")[]) => console.log("keep", keep),
    onCancelUpdate: () => console.log("not now"),
  },
};

/**
 * The update with code: a component both changed, and a schema the site
 * changed while this proposal changed the same file's.
 */
export const UpdateCodeConflicts: Story = {
  args: {
    ...UpdateConflicts.args,
    state: {
      kind: "ready",
      checks:
        BlockedByAPageTheSitePublished.args?.state?.kind === "ready"
          ? BlockedByAPageTheSitePublished.args.state.checks
          : [],
      changes: 3,
      unsaved: 0,
      conflicts: [
        {
          kind: "code",
          file: "src/components/Hero.tsx",
          base: "export function Hero() {\n  return <h1>Sale</h1>;\n}\n",
          site: 'export function Hero() {\n  return <h1 className="big">Sale</h1>;\n}\n',
          proposal:
            "export function Hero() {\n  return (\n    <h1>Summer</h1>\n  );\n}\n",
        },
        {
          kind: "code",
          file: "src/components/Banner.tsx",
          base: "export const Banner = () => null;\n",
          site: null,
          proposal: "export const Banner = () => <p>New</p>;\n",
        },
      ],
    },
  },
};

/** Each step, as it runs. */
export const Saving = at({ kind: "publishing", step: "saving" });
export const Building = at({ kind: "publishing", step: "building" });
export const Publishing = at({ kind: "publishing", step: "publishing" });

/** Live on the site, and the proposal is finished. */
export const Merged = at({ kind: "merged" });

/**
 * Live on the site, and three changes made while it merged went to a new
 * proposal: opening it is the next step, so it is the primary button.
 */
export const MergedWithChangesMoved: Story = {
  args: {
    state: {
      kind: "merged",
      continuedIn: { displayName: "Spring campaign (2)", changes: 3 },
    },
    onOpenContinuation: () => {},
  },
};

/** The merge went wrong after it was pressed: Try again. */
export const Failed = at({
  kind: "failed",
  message: "A page failed to render with these changes.",
});

/**
 * GitHub refused the commit Publish makes first, for good (a branch
 * protection rule): pressing again cannot help, so the dialog links the
 * branch instead of offering Try again.
 */
export const FailedRepositoryRefused = at({
  kind: "failed",
  message:
    "GitHub refused the push to val/p/0123456789abcdef0123: protected branch hook declined.",
  seeWhy: {
    label: "Open the branch",
    url: "https://github.com/acme/site/tree/val/p/0123456789abcdef0123",
  },
});

/** Ada pushed to the proposal's branch, as the dialog shows her push. */
const ADA_PUSHED = {
  branch: "val/p/0123456789abcdef0123",
  branchUrl: "https://github.com/acme/site/tree/val/p/0123456789abcdef0123",
  who: "Ada Lovelace",
  ago: "5 minutes ago",
  commit: {
    sha: "3c4d5e6f7a8b9c0d1a2b3c4d5e6f7a8b9c0d1a2b",
    url: "https://github.com/acme/site/commit/3c4d5e6f7a8b9c0d1a2b3c4d5e6f7a8b9c0d1a2b",
    message: "Fix the hero's spacing\n\nThe gap above the heading was 2rem.",
  },
  during: "publish" as const,
};

/**
 * The commit Publish makes first was refused: someone else pushed to the
 * proposal's branch. Who, when, their commit -- and Build on their push,
 * since Publish again would be refused the same way.
 */
export const RefusedSomeonePushed = at({
  kind: "someone-pushed",
  refused: ADA_PUSHED,
  buildOn: { kind: "idle" },
});

/** Bringing their push into the proposal. */
export const BuildingOnTheirPush = at({
  kind: "someone-pushed",
  refused: ADA_PUSHED,
  buildOn: { kind: "building" },
});

/**
 * Their push is in. They and the proposal both changed one file, and the
 * proposal's version was kept; the preview is being rebuilt; Publish again.
 */
export const BuiltOnTheirPush = at({
  kind: "someone-pushed",
  refused: ADA_PUSHED,
  buildOn: {
    kind: "built",
    kept: ["content/home.val.ts"],
    notTaken: [],
    rewritten: false,
    rebuild: { state: "running" },
  },
});

/**
 * Building on their push failed because GitHub could not be reached: Try
 * again presses it again.
 */
export const BuildOnTheirPushFailed = at({
  kind: "someone-pushed",
  refused: ADA_PUSHED,
  buildOn: {
    kind: "failed",
    message:
      "GitHub could not be reached, so their push was not brought in. Nothing changed in the proposal.",
    offer: { kind: "retry" },
  },
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
