import type { Meta, StoryObj } from "@storybook/react";
import { DesignSiteMock } from "./DesignSiteMock";
import { DesignTabView } from "../DesignTabView";
import { BASE, MESSAGES, NOT_RENDERED, chat } from "./designStoryFixtures";

/**
 * The design tab (valbuild/home `docs/design-tab.md`): a proposal's code,
 * changed by the assistant and previewed, in a tab served by the SITE's
 * build, so the tab, the assistant and its tools stay up when the proposal's
 * code breaks. The frame in the middle is the proposal's own address;
 * everything around it is the site's.
 *
 * - **Working** -- the assistant added a section; it built and rendered.
 * - **Building** -- a change is building; the frame shows the last build.
 * - **Build not served** -- the build did not render, so the address kept
 *   the last one that did (step 1), and the frame still shows it. The two
 *   ways on: the assistant fixes it, or build again.
 * - **Changes** -- a file against the site's copy.
 * - **Nothing changed yet** -- a proposal that runs the site's code.
 * - **Safari** -- the bundler cannot run in a tab that frames the site, so
 *   the build waits for a builder window opened from a tap.
 * - **Picking** -- Select, then click something on the page: the assistant is
 *   told which. It needs the page in preview mode, which the bar turns on.
 */
const meta: Meta<typeof DesignTabView> = {
  title: "Design/DesignTab",
  component: DesignTabView,
  parameters: { layout: "fullscreen", backgrounds: { disable: true } },
};
export default meta;
type Story = StoryObj<typeof DesignTabView>;

export const Working: Story = { args: BASE };

export const Building: Story = {
  args: {
    ...BASE,
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
    preview: <DesignSiteMock testimonials="quote" />,
    chat: chat([
      MESSAGES[0],
      {
        id: "a1",
        role: "assistant",
        content:
          "I have written the section and its schema. Building it now, so the preview shows it.",
        status: "streaming",
        toolActivities: [
          { toolCallId: "t3", name: "write_files", status: "complete" },
          { toolCallId: "t4", name: "build_proposal", status: "pending" },
        ],
      },
    ]),
  },
};

export const BuildNotServed: Story = {
  name: "Build not served",
  args: {
    ...BASE,
    checks: [
      { label: "Types", check: { state: "passed" } },
      { label: "Build", check: { state: "failed", message: NOT_RENDERED } },
    ],
    build: {
      required: true,
      building: false,
      progress: null,
      onBuild: () => {},
    },
    problem: {
      title: "The build was not served",
      message:
        "The preview still shows the last build that worked. Ask the assistant to fix what the build says below, or build again.",
      details: NOT_RENDERED,
      onAskAssistant: () => {},
      action: { label: "Build again", onClick: () => {} },
    },
    chat: chat([
      ...MESSAGES,
      {
        id: "u2",
        role: "user",
        content:
          "Can the testimonials come from one list we reuse on every page?",
        status: "complete",
      },
      {
        id: "a2",
        role: "assistant",
        content:
          "I moved them into a module of their own, but the build was not served: the front page does not render, because the section gets no items. Should I fix it?",
        status: "complete",
        toolActivities: [
          { toolCallId: "t7", name: "write_files", status: "complete" },
          { toolCallId: "t8", name: "build_proposal", status: "error" },
        ],
      },
    ]),
  },
};

export const Changes: Story = {
  args: { ...BASE, initialView: "changes" },
};

export const NothingChangedYet: Story = {
  name: "Nothing changed yet",
  args: {
    ...BASE,
    files: [],
    checkpoints: [],
    checks: [
      { label: "Build", check: { state: "idle", detail: "the site's code" } },
    ],
    preview: <DesignSiteMock testimonials="none" />,
    chat: chat([]),
  },
};

export const Phone: Story = {
  args: { ...BASE, initialDevice: "mobile" },
};

export const SafariNoBuilderWindow: Story = {
  name: "Safari: no builder window",
  args: {
    ...BASE,
    builder: { kind: "window", blocked: true },
    onOpenBuilder: () => {},
    checks: [{ label: "Build", check: { state: "running", percent: null } }],
    build: {
      required: true,
      building: true,
      progress: { label: "Waiting for the builder tab", percent: null },
      onBuild: () => {},
    },
    preview: <DesignSiteMock testimonials="none" />,
  },
};

export const Picking: Story = {
  name: "Picking on the page",
  args: {
    ...BASE,
    picking: {
      active: true,
      onToggle: () => {},
      status: "live",
      onTurnOn: () => {},
      modifier: "⌥",
    },
  },
};

export const PickingNeedsPreview: Story = {
  name: "Picking needs preview mode",
  args: {
    ...BASE,
    picking: {
      active: false,
      onToggle: () => {},
      status: "off",
      onTurnOn: () => {},
      modifier: "⌥",
    },
  },
};
