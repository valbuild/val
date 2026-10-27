import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import type { PickedElement } from "@valbuild/shared/internal";
import { DesignSiteMock } from "./DesignSiteMock";
import { PickerLayer } from "../PickerLayer";
import { DesignTabView, type DesignTabViewProps } from "../DesignTabView";
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
 * - **Picking** -- live: hold ⌥ (Alt) and click ANYTHING on the page, or
 *   press Select first. What is under the pointer is outlined and named; what
 *   is picked is outlined, shown above the assistant, and sent with the next
 *   message. The same picker the proposal's page runs (`startElementPicking`).
 * - **Picking, no answer** -- the page never answered the canvas, so nothing
 *   on it can be picked; the hint offers to turn preview mode on.
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

function LivePicking({
  initialPicked = null,
  initialSelect = false,
  ...props
}: DesignTabViewProps & {
  initialPicked?: PickedElement | null;
  initialSelect?: boolean;
}) {
  const [active, setActive] = useState(initialSelect);
  const [picked, setPicked] = useState<PickedElement | null>(initialPicked);
  return (
    <DesignTabView
      {...props}
      picking={{
        active,
        onToggle: () => setActive((on) => !on),
        status: "live",
        onTurnOn: () => {},
        modifier: "⌥",
      }}
      picked={picked}
      onClearPicked={() => setPicked(null)}
      preview={
        <PickerLayer
          modifier="alt"
          active={active}
          keepPicked={picked !== null}
          onStop={() => setActive(false)}
          onPick={(element) => {
            setActive(false);
            setPicked(element);
          }}
        >
          <DesignSiteMock testimonials="cards" />
        </PickerLayer>
      }
    />
  );
}

export const Picking: Story = {
  name: "Picking: hold ⌥ and click anything",
  render: (args) => <LivePicking {...args} />,
  args: BASE,
};

export const Picked: Story = {
  name: "Picking: a heading picked",
  render: (args) => (
    <LivePicking
      {...args}
      initialPicked={{
        tag: "h2",
        text: "Worn for years, not weeks",
        classes: ["mb-6", "text-2xl", "font-bold", "tracking-tight"],
        selector: "div > section:nth-of-type(2) > h2",
      }}
    />
  ),
  args: BASE,
};

export const PickingWithSelect: Story = {
  name: "Picking: Select on, no key needed",
  render: (args) => <LivePicking {...args} initialSelect />,
  args: BASE,
};

export const PickingNoAnswer: Story = {
  name: "Picking: the page did not answer",
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
