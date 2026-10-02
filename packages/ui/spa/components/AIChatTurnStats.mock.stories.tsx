import type { Meta, StoryObj } from "@storybook/react";
import { AIChat, ChatMessage } from "./AIChat";

const meta: Meta<typeof AIChat> = {
  title: "Mockups/AIChat turn stats",
  component: AIChat,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div className="h-[520px] w-[420px] border border-border-primary overflow-hidden">
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof AIChat>;

const base = {
  isConnected: true,
  authError: false,
  mode: "http" as const,
  onSendMessage: () => true,
};

const user = (id: string, content: string): ChatMessage => ({
  id,
  role: "user",
  content,
  status: "complete",
});

const earlierTurn: ChatMessage[] = [
  user("u0", "What does the front page say right now?"),
  {
    id: "a0",
    role: "assistant",
    content:
      "The hero title is **“Building the web, together”** and the intro has two paragraphs about the studio.",
    status: "complete",
    toolActivities: [
      { toolCallId: "t0a", name: "get_current_context", status: "complete" },
      { toolCallId: "t0b", name: "get_source", status: "complete" },
    ],
    turnStats: { phase: { type: "done" }, elapsedMs: 8_000, outputTokens: 214 },
  },
];

const thinking = (placement: "message" | "composer"): Story => ({
  args: {
    ...base,
    statusPlacement: placement,
    initialMessages: [
      ...earlierTurn,
      user("u1", "Make the hero title shorter and punchier"),
      {
        id: "a1",
        role: "assistant",
        content: "",
        status: "streaming",
        turnStats: { phase: { type: "thinking" }, elapsedMs: 4_000 },
      },
    ],
  },
});

const toolRunning = (placement: "message" | "composer"): Story => ({
  args: {
    ...base,
    statusPlacement: placement,
    initialMessages: [
      ...earlierTurn,
      user("u1", "Fix the validation errors on all blog posts"),
      {
        id: "a1",
        role: "assistant",
        content:
          "I found 14 posts missing an `author`. Filling them in from the editor list now",
        status: "streaming",
        toolActivities: [
          { toolCallId: "t1", name: "search_content", status: "complete" },
          { toolCallId: "t2", name: "get_source", status: "complete" },
          { toolCallId: "t3", name: "create_patch", status: "pending" },
        ],
        turnStats: {
          phase: { type: "tool", name: "create_patch" },
          elapsedMs: 65_000,
          outputTokens: 2_140,
        },
      },
    ],
  },
});

export const A1_Thinking_UnderReply = thinking("message");

export const A2_Writing_UnderReply: Story = {
  args: {
    ...base,
    initialMessages: [
      ...earlierTurn,
      user("u1", "Make the hero title shorter and punchier"),
      {
        id: "a1",
        role: "assistant",
        content:
          "Here are three options, all under six words:\n\n1. **Build the web together**\n2. **We build",
        status: "streaming",
        turnStats: {
          phase: { type: "writing" },
          elapsedMs: 12_000,
          outputTokens: 340,
        },
      },
    ],
  },
};

export const A3_LongToolRun_UnderReply = toolRunning("message");

export const A4_WaitingForAnswer_UnderReply: Story = {
  args: {
    ...base,
    initialMessages: [
      user("u1", "Update the title"),
      {
        id: "a1",
        role: "assistant",
        content: "",
        status: "streaming",
        toolActivities: [
          {
            toolCallId: "q1",
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
        turnStats: {
          phase: { type: "waiting" },
          elapsedMs: 9_000,
          outputTokens: 96,
        },
      },
    ],
  },
};

export const A5_Done: Story = {
  args: {
    ...base,
    initialMessages: [
      ...earlierTurn,
      user("u1", "Fix the validation errors on all blog posts"),
      {
        id: "a1",
        role: "assistant",
        content:
          "Done. I filled in `author` on 14 posts — 12 from the byline in the text, 2 defaulted to the editorial team. They are in your unpublished changes for review.",
        status: "complete",
        toolActivities: [
          { toolCallId: "t1", name: "search_content", status: "complete" },
          { toolCallId: "t2", name: "get_source", status: "complete" },
          { toolCallId: "t3", name: "create_patch", status: "complete" },
        ],
        turnStats: {
          phase: { type: "done" },
          elapsedMs: 94_000,
          outputTokens: 3_412,
        },
      },
    ],
  },
};

export const A6_StoppedAndFailed: Story = {
  args: {
    ...base,
    initialMessages: [
      user("u1", "Translate every page to Norwegian"),
      {
        id: "a1",
        role: "assistant",
        content: "Starting with the front page. Forsiden heter",
        status: "complete",
        turnStats: {
          phase: { type: "stopped" },
          elapsedMs: 18_000,
          outputTokens: 812,
        },
      },
      user("u2", "Just do the about page"),
      {
        id: "a2",
        role: "assistant",
        content: "",
        status: "error",
        error: "The model provider did not respond.",
        turnStats: {
          phase: { type: "error" },
          elapsedMs: 31_000,
          outputTokens: 0,
        },
      },
    ],
  },
};

export const B1_Thinking_AboveComposer = thinking("composer");
export const B3_LongToolRun_AboveComposer = toolRunning("composer");
