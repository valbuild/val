import type { Meta, StoryObj } from "@storybook/react";
import { useRef, useState } from "react";
import { fn } from "storybook/test";
import { PublishSummaryView } from "./PublishSummaryView";
import type { AiSummaryState } from "./PublishSummaryView";
import {
  buildDefaultCommitMessage,
  shouldAutoApplyAiSummary,
} from "./publish/defaultCommitSummary";

/** What the placeholder suggests: the message nobody wrote. */
const PLACEHOLDER = `Describe your changes. For example: ${
  buildDefaultCommitMessage([
    { moduleFilePath: "/content/home.val.ts", patchPath: ["hero", "title"] },
  ]).split("\n")[0]
}`;

const AI_SUMMARY =
  "Rewrite the hero heading and add a third blog post\n\n" +
  "The landing page hero now leads with the product name instead of the tagline. " +
  "A new post about migrating content was added to the blog listing.";

const meta: Meta<typeof PublishSummaryView> = {
  title: "Components/PublishSummaryView",
  component: PublishSummaryView,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  args: {
    onChange: fn(),
    onUseAiSummary: fn(),
    onPublish: fn(),
    onClose: fn(),
    publishDisabled: false,
    isPublishing: false,
    placeholder: PLACEHOLDER,
  },
  decorators: [
    (Story) => (
      // The publish popover this lives in
      <div className="mx-auto w-[420px] rounded-md border border-border-primary bg-bg-primary p-4 shadow-lg">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof PublishSummaryView>;

/**
 * No AI configured at all. The box starts empty — the project requires a
 * message, so one that arrived filled in could be published unread — and
 * Publish waits for the reader to write one.
 */
export const NoAiConfigured: Story = {
  args: {
    value: "",
    ai: { status: "off" },
    onSetUpAi: fn(),
  },
};

/**
 * AI is writing in the background, and none of it is in the way: the box is
 * editable, and the AI's message will fill it if nobody has typed by then.
 */
export const AiWriting: Story = {
  args: {
    value: "",
    placeholder: "Writing a commit message with AI…",
    ai: { status: "loading" },
  },
};

/**
 * The user started typing while the AI was still working. Their words win.
 */
export const AiWritingWhileUserTypes: Story = {
  args: {
    value: "Fix typo in hero",
    ai: { status: "loading" },
  },
};

/**
 * The AI finished and its summary was taken (the user had not typed), so there
 * is nothing to offer — only the way back into the chat that wrote it.
 */
export const AiSummaryApplied: Story = {
  args: {
    value: AI_SUMMARY,
    ai: { status: "ready", text: AI_SUMMARY, sessionId: "session-1" },
    onOpenAiSession: fn(),
  },
};

/**
 * The AI finished but the user had already written their own summary, so the
 * suggestion is offered rather than applied.
 */
export const AiSummaryOffered: Story = {
  args: {
    value: "Fix typo in hero",
    ai: { status: "ready", text: AI_SUMMARY, sessionId: "session-1" },
    onOpenAiSession: fn(),
  },
};

/** The AI failed. The box is the reader's to fill, as without AI. */
export const AiFailed: Story = {
  args: {
    value: "",
    ai: {
      status: "failed",
      message: "The Anthropic key was rejected.",
      canSetUp: true,
    },
    onSetUpAi: fn(),
  },
};

/** Mid-publish. */
export const Publishing: Story = {
  args: {
    value: AI_SUMMARY,
    ai: { status: "ready", text: AI_SUMMARY, sessionId: "session-1" },
    isPublishing: true,
    publishDisabled: true,
    onOpenAiSession: fn(),
  },
};

/**
 * The whole flow, driven for real: the box starts empty, the AI lands after
 * three seconds, and typing at any point cancels the takeover so your text
 * survives — the same `shouldAutoApplyAiSummary` rule the app uses.
 */
export const InteractiveFlow: Story = {
  render: function InteractiveFlowStory() {
    const [value, setValue] = useState("");
    // A ref, not state: the timeout below closes over its scheduling-time
    // value, and nothing renders off it.
    const hasEditedRef = useRef(false);
    const [ai, setAi] = useState<AiSummaryState>({ status: "idle" });

    return (
      <div className="flex flex-col gap-3">
        <button
          type="button"
          className="self-start text-xs underline cursor-pointer"
          onClick={() => {
            setAi({ status: "loading" });
            setTimeout(() => {
              setAi({
                status: "ready",
                text: AI_SUMMARY,
                sessionId: "session-1",
              });
              // Typing cancels the takeover: same rule the app runs on.
              setValue((current) =>
                shouldAutoApplyAiSummary({
                  hasEdited: hasEditedRef.current,
                  currentValue: current,
                  defaultSummary: "",
                })
                  ? AI_SUMMARY
                  : current,
              );
            }, 3000);
          }}
        >
          Simulate hitting Publish (AI starts, lands after 3s)
        </button>
        <PublishSummaryView
          value={value}
          onChange={(next) => {
            setValue(next);
            hasEditedRef.current = true;
          }}
          ai={ai}
          onUseAiSummary={() => {
            if (ai.status === "ready") {
              setValue(ai.text);
            }
          }}
          onOpenAiSession={ai.status === "ready" ? fn() : undefined}
          onSetUpAi={fn()}
          onPublish={fn()}
          onClose={fn()}
          publishDisabled={false}
          isPublishing={false}
          placeholder={PLACEHOLDER}
        />
      </div>
    );
  },
};
