import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { DesignSiteMock } from "./DesignSiteMock";
import { PickerLayer } from "../PickerLayer";
import {
  DesignTabView,
  type DesignPicked,
  type DesignTabOptions,
  type DesignTabViewProps,
} from "../DesignTabView";
import { BASE, MESSAGES, NOT_RENDERED, chat } from "./designStoryFixtures";

/**
 * The design tab, three ways, to choose from. Each is live: hold ⌥ (Alt) and
 * click ANYTHING on the page, or press Select first -- the hovered element is
 * outlined and named, and what is picked goes above the assistant.
 *
 * In all three the left column no longer lists the changed files: that is
 * the Changes view, which has the list beside the diff.
 *
 * - **A · Status** -- the checks are one quiet word and a dot beside the
 *   proposal's name ("Ready", "Build · 62%", "Build failed"); a click lists
 *   them. History is a button in the top bar, and the preview takes the
 *   whole width.
 * - **B · History rail** -- a narrow history column on the left, like
 *   Lovable's versions; the checks are small marks at the end of the preview
 *   toolbar, red only when one fails.
 * - **C · Checks on Publish** -- the checks are what Publish waits on, so
 *   they are a dot on the Publish button, with the list behind it. Nothing
 *   else in the bar.
 *
 * Each has a "failing" story: the build did not render, which is when the
 * checks have to be seen.
 */
const meta: Meta<typeof Interactive> = {
  title: "Design/Options",
  component: Interactive,
  parameters: { layout: "fullscreen", backgrounds: { disable: true } },
};
export default meta;
type Story = StoryObj<typeof Interactive>;

const FAILING: Partial<DesignTabViewProps> = {
  checks: [
    { label: "Types", check: { state: "passed" } },
    { label: "Build", check: { state: "failed", message: NOT_RENDERED } },
  ],
  build: { required: true, building: false, progress: null, onBuild: () => {} },
  problem: {
    title: "The build was not served",
    message:
      "The preview still shows the last build that worked. Ask the assistant to fix it, or build again.",
    details: NOT_RENDERED,
    onAskAssistant: () => {},
    action: { label: "Build again", onClick: () => {} },
  },
};

const BUILDING: Partial<DesignTabViewProps> = {
  checks: [
    { label: "Types", check: { state: "passed" } },
    { label: "Build", check: { state: "running", percent: 62 } },
  ],
  build: {
    required: true,
    building: true,
    progress: { label: "Building the project", percent: 62 },
    onBuild: () => {},
  },
};

function Interactive({
  options,
  overrides,
  initialPicked = null,
  initialSelect = false,
}: {
  options: DesignTabOptions;
  overrides?: Partial<DesignTabViewProps>;
  initialPicked?: DesignPicked | null;
  initialSelect?: boolean;
}) {
  const [active, setActive] = useState(initialSelect);
  const [picked, setPicked] = useState<DesignPicked | null>(initialPicked);
  return (
    <DesignTabView
      {...BASE}
      {...overrides}
      options={options}
      picking={{
        active,
        onToggle: () => setActive((on) => !on),
        status: "live",
        onTurnOn: () => {},
        modifier: "⌥",
      }}
      picked={picked}
      onClearPicked={() => setPicked(null)}
      chat={chat(MESSAGES)}
      preview={
        <PickerLayer
          modifier="alt"
          active={active}
          onStop={() => setActive(false)}
          onPick={(element) => {
            setPicked(element);
            setActive(false);
          }}
        >
          <DesignSiteMock testimonials="cards" />
        </PickerLayer>
      }
    />
  );
}

const A: DesignTabOptions = { checks: "status", history: "menu" };
const B: DesignTabOptions = { checks: "toolbar", history: "rail" };
const C: DesignTabOptions = { checks: "publish", history: "menu" };

export const AStatus: Story = { name: "A · Status", args: { options: A } };
export const AStatusBuilding: Story = {
  name: "A · Status, building",
  args: { options: A, overrides: BUILDING },
};
export const AStatusFailing: Story = {
  name: "A · Status, failing",
  args: { options: A, overrides: FAILING },
};

export const BHistoryRail: Story = {
  name: "B · History rail",
  args: { options: B },
};
export const BHistoryRailFailing: Story = {
  name: "B · History rail, failing",
  args: { options: B, overrides: FAILING },
};

export const CChecksOnPublish: Story = {
  name: "C · Checks on Publish",
  args: { options: C },
};
export const CChecksOnPublishFailing: Story = {
  name: "C · Checks on Publish, failing",
  args: { options: C, overrides: FAILING },
};

export const Picked: Story = {
  name: "Picked: the heading of a section",
  args: {
    options: A,
    initialPicked: {
      tag: "h2",
      text: "Worn for years, not weeks",
      selector: "div > section:nth-of-type(2) > h2",
    },
  },
};

export const SelectOn: Story = {
  name: "Select on (no modifier needed)",
  args: { options: A, initialSelect: true },
};

export const ChangesWithFileList: Story = {
  name: "Changes: the files beside the diff",
  args: { options: A, overrides: { initialView: "changes" } },
};
