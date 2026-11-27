import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { ToolActivities, type ToolActivity } from "./AIChatToolActivities";
import type { GuideRequest } from "./shell/assistantGuide";

/**
 * The assistant offering to show how something is done (`show_guide`), in
 * the chat.
 *
 * An offer, never a tour that starts by itself. While the tour runs the card
 * says where it has got to and is the way to stop it; afterwards it folds to
 * a line saying how it went. The whole flow, in the Studio, is
 * `Shell/AssistantGuide`.
 */
const meta: Meta = {
  title: "Components/AIChat/GuideRequest",
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div className="mx-auto w-full max-w-[420px] bg-bg-primary p-4">
        <Story />
      </div>
    ),
  ],
};
export default meta;

const BASE: Omit<GuideRequest, "state"> = {
  title: "Add a blog post",
  why: "It's three taps, and you can do each one yourself.",
  stepCount: 3,
};

function activities(state: GuideRequest["state"]): ToolActivity[] {
  return [
    { toolCallId: "t1", name: "get_current_context", status: "complete" },
    {
      toolCallId: "t2",
      name: "show_guide",
      status:
        state.kind === "offered" || state.kind === "showing"
          ? "pending"
          : "complete",
      guideRequest: { ...BASE, state },
    },
  ];
}

/** Pressable: Show me how walks through the steps; Stop ends it. */
function Interactive() {
  const [state, setState] = useState<GuideRequest["state"]>({
    kind: "offered",
  });
  return (
    <div className="flex flex-col gap-3">
      <ToolActivities
        activities={activities(state)}
        onSubmitAnswers={() => {}}
        onCancel={() => {}}
        guideActions={{
          start: () => setState({ kind: "showing", step: 0 }),
          decline: () => setState({ kind: "declined" }),
          stop: () =>
            setState({
              kind: "ended",
              outcome: { finished: false, reached: 1, steps: [] },
            }),
        }}
      />
      {state.kind !== "offered" && (
        <button
          type="button"
          onClick={() => setState({ kind: "offered" })}
          className="self-start text-xs text-fg-secondary underline"
        >
          Offer again
        </button>
      )}
    </div>
  );
}

export const Offered: StoryObj = { render: () => <Interactive /> };

const still = (state: GuideRequest["state"]): StoryObj => ({
  render: () => (
    <ToolActivities
      activities={activities(state)}
      onSubmitAnswers={() => {}}
      onCancel={() => {}}
    />
  ),
});

/** While the tour runs: where it has got to, and Stop. */
export const Showing = still({ kind: "showing", step: 1 });
/** No thanks. */
export const Declined = still({ kind: "declined" });
/** Done, two steps by the person and one by "Do it for me". */
export const Finished = still({
  kind: "ended",
  outcome: {
    finished: true,
    reached: 3,
    steps: ["did-it", "did-it", "done-for-them"],
  },
});
/** Stopped part way. */
export const Stopped = still({
  kind: "ended",
  outcome: { finished: false, reached: 2, steps: ["did-it"] },
});
