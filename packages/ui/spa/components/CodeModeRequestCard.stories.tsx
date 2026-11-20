import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { AIChat, type ChatMessage } from "./AIChat";
import { ToolActivities, type ToolActivity } from "./AIChatToolActivities";
import type { CodeModeRequest } from "./CodeModeRequestCard";

/**
 * The assistant asking for code mode (`request_code_mode`), in the chat.
 *
 * Every hosted Studio's assistant has the code tools, but with code mode off
 * they refuse. When a request needs code, the assistant asks with this card,
 * and its button IS the switch: pressing it turns code mode on, as the `</>`
 * in the top bar does. On the site, where code is never changed, the button
 * chooses a proposal instead, which opens in code mode.
 *
 * Like a question, the card is never folded away with the other tool calls:
 * the turn waits on it. The whole flow, in the Studio, is
 * `Proposals/Code mode`'s "Assistant asks for code mode".
 */
const meta: Meta = {
  title: "Components/AIChat/CodeModeRequest",
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

const REASON =
  "To add a Testimonials section with its own schema (quote, name, place) and put it on the front page where the quote is. That is a new component, which content alone cannot make.";

const IN_PROPOSAL: CodeModeRequest["where"] = {
  kind: "proposal",
  displayName: "Spring campaign",
};

function activities(request: CodeModeRequest): ToolActivity[] {
  return [
    { toolCallId: "t1", name: "search_code", status: "complete" },
    { toolCallId: "t2", name: "read_file", status: "complete" },
    { toolCallId: "t3", name: "write_files", status: "error" },
    {
      toolCallId: "t4",
      name: "request_code_mode",
      status: request.state === "asking" ? "pending" : "complete",
      codeModeRequest: request,
    },
  ];
}

/** Pressable: Turn on code mode, or Not now. */
function Interactive({ where }: { where: CodeModeRequest["where"] }) {
  const [state, setState] = useState<CodeModeRequest["state"]>("asking");
  return (
    <div className="flex flex-col gap-3">
      <ToolActivities
        activities={activities({ reason: REASON, where, state })}
        onSubmitAnswers={() => {}}
        onCancel={() => {}}
        onEnableCodeMode={() => {
          setState("turning-on");
          setTimeout(() => setState("on"), 900);
        }}
        onDeclineCodeMode={() => setState("declined")}
      />
      {state !== "asking" && state !== "turning-on" && (
        <button
          type="button"
          onClick={() => setState("asking")}
          className="self-start text-xs text-fg-secondary underline"
        >
          Ask again
        </button>
      )}
    </div>
  );
}

/** In a proposal: the card, waiting. The refused `write_files` is above it. */
export const InAProposal: StoryObj = {
  render: () => <Interactive where={IN_PROPOSAL} />,
};

/**
 * On the site, where the project turned code mode on the site off: the
 * button chooses a proposal.
 */
export const OnTheSite: StoryObj = {
  render: () => <Interactive where={{ kind: "site" }} />,
};

/**
 * On the site, where the project lets `</>` change the site's code (the
 * default): the button turns on the site's own code mode.
 */
export const OnTheSiteWithSiteCode: StoryObj = {
  render: () => <Interactive where={{ kind: "site", siteCode: true }} />,
};

const still = (state: CodeModeRequest["state"]): StoryObj => ({
  render: () => (
    <ToolActivities
      activities={activities({ reason: REASON, where: IN_PROPOSAL, state })}
      onSubmitAnswers={() => {}}
      onCancel={() => {}}
    />
  ),
});

/** Pressed: turning it on. */
export const TurningOn = still("turning-on");
/** Turned on: the card folds to a line, and the turn goes on. */
export const TurnedOn = still("on");
/** Not now: folded to a line too. */
export const Declined = still("declined");

const TRANSCRIPT: ChatMessage[] = [
  {
    id: "u1",
    role: "user",
    content:
      "Replace the quote on the front page with three customer testimonials, as cards.",
    status: "complete",
  },
  {
    id: "a1",
    role: "assistant",
    content:
      "This needs a code change, and code mode is off, so I could not write the files. Turn it on and I will make the change.",
    status: "complete",
    toolActivities: [
      { toolCallId: "t0", name: "get_current_context", status: "complete" },
      ...activities({ reason: REASON, where: IN_PROPOSAL, state: "asking" }),
    ],
  },
];

/** In the chat, as the assistant panel shows it. */
export const InTheChat: StoryObj = {
  decorators: [
    (Story) => (
      <div className="h-[640px]">
        <Story />
      </div>
    ),
  ],
  render: () => (
    <AIChat
      className="h-full"
      initialMessages={TRANSCRIPT}
      isConnected
      authError={false}
      mode="http"
      onSendMessage={() => true}
      onEnableCodeMode={() => {}}
      onDeclineCodeMode={() => {}}
    />
  ),
};

/** The code tools by name, now that the chat has them: expanded. */
export const CodeToolLabels: StoryObj = {
  render: () => (
    <ToolActivities
      defaultExpanded
      activities={[
        "list_files",
        "read_file",
        "search_code",
        "write_files",
        "format_files",
        "lint",
        "typecheck",
        "build_proposal",
        "wait",
      ].map((name, index) => ({
        toolCallId: `c${index}`,
        name,
        status: "complete",
      }))}
      onSubmitAnswers={() => {}}
      onCancel={() => {}}
    />
  ),
};
