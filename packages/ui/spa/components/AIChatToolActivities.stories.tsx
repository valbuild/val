import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useState } from "react";
import {
  ToolActivities,
  type ToolActivity,
  type ToolActivityStatus,
} from "./AIChatToolActivities";

/**
 * The tool-call row of an assistant turn on its own, so the collapsed/expanded
 * and running/done states can be looked at without driving a whole chat.
 */
const meta: Meta<typeof ToolActivities> = {
  title: "Components/AIChat/ToolActivities",
  component: ToolActivities,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="w-full max-w-2xl mx-auto p-4 bg-bg-primary">
        <Story />
      </div>
    ),
  ],
  args: {
    onSubmitAnswers: (toolCallId, answers) => {
      console.log("Answers:", toolCallId, answers);
    },
    onCancel: (toolCallId) => {
      console.log("Cancelled:", toolCallId);
    },
  },
};

export default meta;
type Story = StoryObj<typeof ToolActivities>;

function activity(
  name: string,
  status: ToolActivityStatus,
  index: number,
): ToolActivity {
  return { toolCallId: `tc-${index}`, name, status };
}

const RUN: [string, ToolActivityStatus][] = [
  ["get_current_context", "complete"],
  ["get_all_schema", "complete"],
  ["search_content", "complete"],
  ["get_source", "complete"],
  ["create_patch", "pending"],
];

const finished = RUN.map(([name], i) => activity(name, "complete", i));
const running = RUN.map(([name, status], i) => activity(name, status, i));

// ---------------------------------------------------------------------------
// 1. Running — the row names the tool in flight, shimmering
// ---------------------------------------------------------------------------

export const Running: Story = {
  args: { activities: running },
};

/** A single tool, still going. Nothing to expand, so no count is shown. */
export const RunningSingle: Story = {
  args: { activities: [activity("search_content", "pending", 0)] },
};

// ---------------------------------------------------------------------------
// 2. Done — collapsed to a count, openable
// ---------------------------------------------------------------------------

export const Collapsed: Story = {
  args: { activities: finished },
};

export const Expanded: Story = {
  args: { activities: finished, defaultExpanded: true },
};

export const ExpandedWhileRunning: Story = {
  args: { activities: running, defaultExpanded: true },
};

export const SingleToolDone: Story = {
  args: { activities: [activity("get_source", "complete", 0)] },
};

// ---------------------------------------------------------------------------
// 3. Errors
// ---------------------------------------------------------------------------

export const WithError: Story = {
  args: {
    activities: [
      activity("get_source", "complete", 0),
      activity("create_patch", "error", 1),
      activity("validate_content", "complete", 2),
    ],
  },
};

export const WithErrorExpanded: Story = {
  args: {
    activities: [
      activity("get_source", "complete", 0),
      activity("create_patch", "error", 1),
      activity("validate_content", "complete", 2),
    ],
    defaultExpanded: true,
  },
};

/** A tool the client does not know a label for falls back to its raw name. */
export const UnknownTool: Story = {
  args: {
    activities: [
      activity("get_source", "complete", 0),
      activity("some_new_server_tool", "pending", 1),
    ],
  },
};

// ---------------------------------------------------------------------------
// 4. Questions stay outside the collapsible
// ---------------------------------------------------------------------------

export const PendingQuestionBesideTools: Story = {
  args: {
    activities: [
      activity("get_all_schema", "complete", 0),
      activity("search_content", "complete", 1),
      {
        toolCallId: "tc-q",
        name: "ask_user_question",
        status: "pending",
        questions: [
          {
            question: "Which page should I update?",
            header: "Which page?",
            options: [
              { label: "Home", description: "/" },
              { label: "About", description: "/about" },
            ],
          },
        ],
      },
    ],
  },
};

export const AnsweredQuestionBesideTools: Story = {
  args: {
    activities: [
      activity("get_all_schema", "complete", 0),
      {
        toolCallId: "tc-q",
        name: "ask_user_question",
        status: "complete",
        questions: [
          {
            question: "Which page should I update?",
            options: [{ label: "Home" }, { label: "About" }],
          },
        ],
        answers: [
          {
            question: "Which page should I update?",
            selectedOptions: [1],
            customAnswer: null,
          },
        ],
      },
      activity("create_patch", "complete", 2),
    ],
  },
};

// ---------------------------------------------------------------------------
// 5. Live — the row as it actually behaves over a turn
// ---------------------------------------------------------------------------

const SEQUENCE: string[] = [
  "get_current_context",
  "get_all_schema",
  "search_content",
  "get_source",
  "create_patch",
  "validate_content",
];

function LiveDemo() {
  const [activities, setActivities] = useState<ToolActivity[]>([]);

  useEffect(() => {
    setActivities([]);
    // Every phase is one interval tick, the two trailing ones included. A
    // `setTimeout` for the reset raced the interval instead: at 1500ms against
    // a 1400ms tick the next cycle had already added its first tool before the
    // clear landed, so every replay after the first began at the SECOND tool.
    const completeAll = (prev: ToolActivity[]): ToolActivity[] =>
      prev.map((a) => ({ ...a, status: "complete" }));
    let step = 0;
    const timer = setInterval(() => {
      if (step === SEQUENCE.length) {
        setActivities(completeAll);
        step += 1;
        return;
      }
      if (step > SEQUENCE.length) {
        setActivities([]);
        step = 0;
        return;
      }
      const name = SEQUENCE[step];
      const index = step;
      step += 1;
      setActivities((prev): ToolActivity[] => [
        ...completeAll(prev),
        { toolCallId: `live-${index}`, name, status: "pending" },
      ]);
    }, 1400);
    return () => clearInterval(timer);
  }, []);

  if (activities.length === 0) {
    return <div className="text-xs text-fg-tertiary">Starting a turn…</div>;
  }
  return (
    <ToolActivities
      activities={activities}
      onSubmitAnswers={() => {}}
      onCancel={() => {}}
    />
  );
}

/** Tools arriving one after another, the way a real turn drives the row. */
export const Live: Story = {
  render: () => <LiveDemo />,
};
