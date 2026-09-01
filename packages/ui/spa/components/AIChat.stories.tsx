import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useRef } from "react";
import {
  AIChat,
  AIChatHandle,
  AskUserQuestionAnswer,
  AskUserQuestionItem,
  ChatMessage,
} from "./AIChat";

const meta: Meta<typeof AIChat> = {
  title: "Components/AIChat",
  component: AIChat,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="h-[600px] w-full max-w-2xl mx-auto border border-border-primary rounded-lg overflow-hidden">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof AIChat>;

// ---------------------------------------------------------------------------
// 1. Empty — shows greeting + suggestion chips
// ---------------------------------------------------------------------------

export const Empty: Story = {
  args: {
    onSendMessage: (content) => {
      console.log("Send:", content);
      return true;
    },
  },
};

export const CustomSuggestions: Story = {
  args: {
    suggestions: [
      "Update the blog title",
      "Translate to Norwegian",
      "Fix validation errors",
      "Generate a summary",
    ],
    onSendMessage: (content) => {
      console.log("Send:", content);
      return true;
    },
  },
};

// ---------------------------------------------------------------------------
// 2. With conversation — pre-populated via initialMessages
// ---------------------------------------------------------------------------

const conversationMessages: ChatMessage[] = [
  {
    id: "msg-1",
    role: "user",
    content: "Can you summarize the recent changes?",
    status: "complete",
  },
  {
    id: "msg-2",
    role: "assistant",
    content:
      "Here's a summary of the recent changes:\n\n" +
      "1. **Schema updates** — The `blog` schema was extended with a new `author` field\n" +
      "2. **Content fixes** — Three validation errors in `/content/posts` were resolved\n" +
      "3. **New module** — Added `events.val.ts` with a rich-text description field\n\n" +
      "Would you like me to go into more detail on any of these?",
    status: "complete",
  },
  {
    id: "msg-3",
    role: "user",
    content: "Tell me more about the schema updates",
    status: "complete",
  },
  {
    id: "msg-4",
    role: "assistant",
    content:
      "The `blog` schema in `content/posts.val.ts` was updated with:\n\n" +
      "```typescript\ns.object({\n  title: s.string(),\n  author: s.object({\n    name: s.string(),\n    avatar: s.image(),\n  }),\n  body: s.richtext(),\n})\n```\n\n" +
      "The new `author` field is an object containing a `name` (string) and an `avatar` (image). " +
      "All existing content has been migrated — no manual changes needed.",
    status: "complete",
  },
];

export const WithConversation: Story = {
  args: {
    initialMessages: conversationMessages,
    onSendMessage: (content) => {
      console.log("Send:", content);
      return true;
    },
  },
};

// ---------------------------------------------------------------------------
// 3. Streaming — simulates token-append arriving over time
// ---------------------------------------------------------------------------

const STREAMING_TEXT =
  "Let me analyze that for you.\n\n" +
  "The content module at `/content/authors.val.ts` defines the following schema:\n\n" +
  "```typescript\nexport const authors = val.content(\n" +
  '  "/content/authors",\n' +
  "  s.array(\n" +
  "    s.object({\n" +
  "      name: s.string(),\n" +
  "      role: s.string(),\n" +
  "      bio: s.richtext(),\n" +
  "    })\n" +
  "  )\n" +
  ");\n```\n\n" +
  "This schema supports:\n" +
  "- **name** — plain text string for the author's display name\n" +
  "- **role** — their role or title\n" +
  "- **bio** — rich text content with full formatting support\n\n" +
  "The array wrapper means you can have multiple authors. Each author entry will be validated against this shape.";

export const Streaming: Story = {
  render: () => <AutoStartStreamingDemo />,
};

function AutoStartStreamingDemo() {
  const chatRef = useRef<AIChatHandle>(null);

  useEffect(() => {
    if (!chatRef.current) return;

    const assistantId = "auto-stream-1";
    chatRef.current.startAssistantMessage(assistantId);

    let idx = 0;
    const interval = setInterval(() => {
      if (!chatRef.current) return;
      const chunkSize = 2 + Math.floor(Math.random() * 3);
      const chunk = STREAMING_TEXT.slice(idx, idx + chunkSize);
      if (chunk) {
        chatRef.current.appendAssistantChunk(assistantId, chunk);
        idx += chunkSize;
      } else {
        chatRef.current.completeAssistantMessage(assistantId);
        clearInterval(interval);
      }
    }, 30);

    return () => clearInterval(interval);
  }, []);

  return (
    <AIChat
      ref={chatRef}
      isConnected={true}
      authError={false}
      mode="http"
      initialMessages={[
        {
          id: "auto-stream-user-1",
          role: "user",
          content: "Explain the authors schema",
          status: "complete",
        },
      ]}
    />
  );
}

/**
 * Streaming with a stop control. The send button becomes a stop button for as
 * long as the assistant is talking — the two are never both available, and one
 * of them is always the thing you want.
 */
export const StreamingCancellable: Story = {
  render: () => <CancellableStreamingDemo />,
};

function CancellableStreamingDemo() {
  const chatRef = useRef<AIChatHandle>(null);
  // A ref, not state: making this a dependency re-ran the effect on stop, which
  // started a second assistant message and left an empty bubble streaming
  // forever — the opposite of what the story is meant to show.
  const stoppedRef = useRef(false);

  useEffect(() => {
    if (!chatRef.current) return;
    const assistantId = "cancellable-1";
    chatRef.current.startAssistantMessage(assistantId);
    let idx = 0;
    const interval = setInterval(() => {
      if (!chatRef.current || stoppedRef.current) return;
      const chunk = STREAMING_TEXT.slice(idx, idx + 3);
      if (chunk) {
        chatRef.current.appendAssistantChunk(assistantId, chunk);
        idx += 3;
      } else {
        chatRef.current.completeAssistantMessage(assistantId);
        clearInterval(interval);
      }
    }, 60);
    return () => clearInterval(interval);
  }, []);

  return (
    <AIChat
      ref={chatRef}
      isConnected={true}
      authError={false}
      mode="http"
      onCancel={() => {
        stoppedRef.current = true;
        // What arriving `ai_cancelled` does: settle as complete, keeping the
        // partial text — a stop is not a failure.
        chatRef.current?.completeAssistantMessage("cancellable-1");
      }}
      initialMessages={[
        {
          id: "cancellable-user-1",
          role: "user",
          content: "Rewrite every page in a friendlier tone",
          status: "complete",
        },
      ]}
    />
  );
}

/**
 * An error the user can act on. The link comes from the server, which is the
 * only side that knows the admin URL for this org and project — so a new reason
 * to send someone to admin needs no Studio release.
 */
export const ErrorWithAction: Story = {
  args: {
    isConnected: true,
    authError: false,
    mode: "http",
    initialMessages: [
      {
        id: "action-user-1",
        role: "user",
        content: "Rewrite the hero heading",
        status: "complete",
      },
      {
        id: "action-assistant-1",
        role: "assistant",
        content: "",
        status: "error",
        error:
          "Claude Opus 5 is not available: no Anthropic key is set up. Add one in admin to use it — AI runs on your own key.",
        errorCode: "provider_not_configured",
        errorAction: {
          label: "Set up your own API key",
          url: "https://admin.val.build/~/acme/marketing-site?tab=settings#ai-keys",
        },
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// 4. Error — assistant message failed, with retry button
// ---------------------------------------------------------------------------

export const Error: Story = {
  args: {
    initialMessages: [
      {
        id: "err-user-1",
        role: "user",
        content: "Generate a commit message for my changes",
        status: "complete",
      },
      {
        id: "err-assistant-1",
        role: "assistant",
        content: "",
        status: "error",
        error: "Connection lost — the server closed the WebSocket unexpectedly",
      },
    ],
    onSendMessage: (content) => {
      console.log("Retry send:", content);
      return true;
    },
  },
};

export const ErrorAfterPartialResponse: Story = {
  args: {
    initialMessages: [
      {
        id: "errp-user-1",
        role: "user",
        content: "Summarize the content changes",
        status: "complete",
      },
      {
        id: "errp-assistant-1",
        role: "assistant",
        content:
          "Here are the recent content changes:\n\n1. **Blog post updated** — The title was changed from",
        status: "error",
        error: "Stream interrupted — request timed out after 30s",
      },
    ],
    onSendMessage: (content) => {
      console.log("Retry send:", content);
      return true;
    },
  },
};

// ---------------------------------------------------------------------------
// 5. Long markdown — exercises prose rendering
// ---------------------------------------------------------------------------

const LONG_MARKDOWN =
  "# Content Migration Guide\n\n" +
  "## Overview\n\n" +
  "This guide walks through the steps to migrate your content from the legacy format to the new Val schema system.\n\n" +
  "## Prerequisites\n\n" +
  "- Node.js 18 or later\n" +
  "- Access to the Val dashboard\n" +
  "- Your project's `val.config.ts` file\n\n" +
  "## Steps\n\n" +
  "### 1. Install the CLI\n\n" +
  "```bash\nnpx @valbuild/cli init\n```\n\n" +
  "### 2. Define your schema\n\n" +
  "Create a `.val.ts` file for each content module:\n\n" +
  "```typescript\nimport { s, val } from '@valbuild/core';\n\n" +
  "export const blogPosts = val.content(\n" +
  '  "/content/blog",\n' +
  "  s.array(\n" +
  "    s.object({\n" +
  "      title: s.string().min(1).max(200),\n" +
  "      slug: s.string(),\n" +
  "      publishedAt: s.string(),\n" +
  "      excerpt: s.string().optional(),\n" +
  "      body: s.richtext(),\n" +
  "      tags: s.array(s.string()),\n" +
  "      coverImage: s.image().optional(),\n" +
  "    })\n" +
  "  )\n" +
  ");\n```\n\n" +
  "### 3. Run the migration\n\n" +
  "```bash\nnpx @valbuild/cli migrate --dry-run\n```\n\n" +
  "> **Note:** Always use `--dry-run` first to preview changes before applying them.\n\n" +
  "### 4. Verify\n\n" +
  "Check that all content validates against the new schema:\n\n" +
  "| Status | Count | Description |\n" +
  "|--------|-------|-------------|\n" +
  "| ✅ Valid | 42 | Content matches schema |\n" +
  "| ⚠️ Warning | 3 | Optional fields missing |\n" +
  "| ❌ Error | 0 | No errors found |\n\n" +
  "## Troubleshooting\n\n" +
  "If you encounter `SchemaError: unexpected field`, make sure your content files don't contain extra properties " +
  "not defined in the schema. You can use `s.record(s.unknown())` as a temporary escape hatch while migrating.\n\n" +
  "---\n\n" +
  "*Last updated: March 2026*";

export const LongMarkdown: Story = {
  args: {
    initialMessages: [
      {
        id: "md-user-1",
        role: "user",
        content: "Write a content migration guide",
        status: "complete",
      },
      {
        id: "md-assistant-1",
        role: "assistant",
        content: LONG_MARKDOWN,
        status: "complete",
      },
    ],
    onSendMessage: (content) => {
      console.log("Send:", content);
      return true;
    },
  },
};

// ---------------------------------------------------------------------------
// 6. Interactive — full send → stream → complete cycle
// ---------------------------------------------------------------------------

function InteractiveDemo() {
  const chatRef = useRef<AIChatHandle>(null);

  const handleSend = (): boolean => {
    if (!chatRef.current) return false;

    const assistantId = `interactive-${Date.now()}`;
    chatRef.current.startAssistantMessage(assistantId);

    const response =
      "Thanks for your message! I've processed your request.\n\n" +
      "Here's what I found:\n" +
      "- Your content is **up to date**\n" +
      "- No validation errors detected\n" +
      "- All patches have been applied successfully\n\n" +
      "Is there anything else I can help with?";

    let idx = 0;
    const interval = setInterval(() => {
      if (!chatRef.current) return;
      const chunkSize = 2 + Math.floor(Math.random() * 3);
      const chunk = response.slice(idx, idx + chunkSize);
      if (chunk) {
        chatRef.current.appendAssistantChunk(assistantId, chunk);
        idx += chunkSize;
      } else {
        chatRef.current.completeAssistantMessage(assistantId);
        clearInterval(interval);
      }
    }, 30);
    return true;
  };

  return (
    <AIChat
      ref={chatRef}
      onSendMessage={handleSend}
      isConnected={true}
      authError={false}
      mode="http"
    />
  );
}

export const Interactive: Story = {
  render: () => <InteractiveDemo />,
};

// ---------------------------------------------------------------------------
// 7. ask_user_question — interactive question card
// ---------------------------------------------------------------------------

type AskQuestionDemoProps = {
  userPrompt: string;
  questions: AskUserQuestionItem[];
};

function AskQuestionDemo({ userPrompt, questions }: AskQuestionDemoProps) {
  const chatRef = useRef<AIChatHandle>(null);
  const messageIdRef = useRef<string | null>(null);
  const toolCallIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!chatRef.current) return;
    const messageId = `ask-msg-${Date.now()}`;
    const toolCallId = `ask-tc-${Date.now()}`;
    messageIdRef.current = messageId;
    toolCallIdRef.current = toolCallId;
    chatRef.current.startAssistantMessage(messageId);
    chatRef.current.addToolCall(
      messageId,
      toolCallId,
      "ask_user_question",
      questions,
    );
  }, [questions]);

  const handleAnswer = (
    _toolCallId: string,
    answers: AskUserQuestionAnswer[],
  ) => {
    const messageId = messageIdRef.current;
    if (!messageId || !chatRef.current) return;
    const summary = answers
      .map((a, qi) => {
        const labels = a.selectedOptions
          .map((idx) => questions[qi]?.options[idx]?.label)
          .filter((l): l is string => Boolean(l));
        const parts = [...labels];
        if (a.customAnswer) parts.push(`"${a.customAnswer}"`);
        return `- ${a.question} → ${parts.join(", ") || "(no answer)"}`;
      })
      .join("\n");
    chatRef.current.appendAssistantChunk(
      messageId,
      `\nThanks! Here's what I'll do based on your answers:\n${summary}\n`,
    );
    chatRef.current.completeAssistantMessage(messageId);
  };

  const handleCancel = () => {
    const messageId = messageIdRef.current;
    if (!messageId || !chatRef.current) return;
    chatRef.current.appendAssistantChunk(
      messageId,
      `\nNo problem — let me know if you change your mind.\n`,
    );
    chatRef.current.completeAssistantMessage(messageId);
  };

  return (
    <AIChat
      ref={chatRef}
      isConnected={true}
      authError={false}
      mode="http"
      initialMessages={[
        {
          id: "ask-user-1",
          role: "user",
          content: userPrompt,
          status: "complete",
        },
      ]}
      onAnswerToolQuestions={handleAnswer}
      onCancelToolQuestion={handleCancel}
    />
  );
}

export const AskQuestionSingleSelect: Story = {
  render: () => (
    <AskQuestionDemo
      userPrompt="Update the title"
      questions={[
        {
          question: "Which page should I update?",
          header: "Which page?",
          options: [
            { label: "Home", description: "/" },
            { label: "About", description: "/about" },
            { label: "Contact", description: "/contact" },
          ],
        },
      ]}
    />
  ),
};

export const AskQuestionMultiSelect: Story = {
  render: () => (
    <AskQuestionDemo
      userPrompt="Update which sections of the homepage?"
      questions={[
        {
          question: "Which sections should I update?",
          header: "Sections",
          multiSelect: true,
          options: [
            { label: "Hero", description: "The top banner" },
            { label: "Features", description: "Three-column features grid" },
            { label: "Testimonials", description: "Customer quotes" },
            { label: "Footer" },
          ],
        },
      ]}
    />
  ),
};

export const AskQuestionMultipleQuestions: Story = {
  render: () => (
    <AskQuestionDemo
      userPrompt="Update the title and the publish date on the latest blog post"
      questions={[
        {
          question: "Which blog post?",
          header: "Post",
          options: [
            { label: "Welcome to our blog" },
            { label: "Shipping notes #42" },
            { label: "Q1 retrospective" },
          ],
        },
        {
          question: "What should the new title be?",
          header: "New title",
          options: [
            { label: "Keep current title" },
            { label: "Auto-generate from body" },
          ],
        },
        {
          question: "When should it be published?",
          header: "Publish date",
          options: [
            { label: "Today" },
            { label: "Tomorrow" },
            { label: "Next Monday" },
          ],
        },
      ]}
    />
  ),
};

export const AskQuestionWithDefaults: Story = {
  render: () => (
    <AskQuestionDemo
      userPrompt="Should I publish the draft?"
      questions={[
        {
          question: "Publish to which environment?",
          header: "Environment",
          options: [
            { label: "Preview", description: "Visible only to editors" },
            { label: "Production", description: "Visible to all visitors" },
          ],
          defaults: [0],
        },
      ]}
    />
  ),
};

export const AskQuestionAnswered: Story = {
  args: {
    initialMessages: [
      {
        id: "answered-user-1",
        role: "user",
        content: "Update the title",
        status: "complete",
      },
      {
        id: "answered-assistant-1",
        role: "assistant",
        content: "Got it — updating the About page title.",
        status: "complete",
        toolActivities: [
          {
            toolCallId: "answered-tc-1",
            name: "ask_user_question",
            status: "complete",
            questions: [
              {
                question: "Which page should I update?",
                header: "Which page?",
                options: [
                  { label: "Home" },
                  { label: "About" },
                  { label: "Contact" },
                ],
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
        ],
      },
    ],
  },
};

export const AskQuestionCancelled: Story = {
  args: {
    initialMessages: [
      {
        id: "cancelled-user-1",
        role: "user",
        content: "Update the title",
        status: "complete",
      },
      {
        id: "cancelled-assistant-1",
        role: "assistant",
        content:
          "No problem — let me know which page you want to update and I'll get to it.",
        status: "complete",
        toolActivities: [
          {
            toolCallId: "cancelled-tc-1",
            name: "ask_user_question",
            status: "error",
            cancelled: true,
            questions: [
              {
                question: "Which page should I update?",
                header: "Which page?",
                options: [
                  { label: "Home" },
                  { label: "About" },
                  { label: "Contact" },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// 8. Tool calls — a row of their own, above the answer
// ---------------------------------------------------------------------------

const TOOL_RUN: ChatMessage["toolActivities"] = [
  {
    toolCallId: "tools-tc-1",
    name: "get_current_context",
    status: "complete",
  },
  { toolCallId: "tools-tc-2", name: "get_all_schema", status: "complete" },
  { toolCallId: "tools-tc-3", name: "search_content", status: "complete" },
  { toolCallId: "tools-tc-4", name: "get_source", status: "complete" },
  { toolCallId: "tools-tc-5", name: "create_patch", status: "complete" },
];

/** The turn is over: the row collapses to a count, openable if you care. */
export const ToolsCollapsed: Story = {
  args: {
    initialMessages: [
      {
        id: "tools-user-1",
        role: "user",
        content: "Change the hero title on the front page to something shorter",
        status: "complete",
      },
      {
        id: "tools-assistant-1",
        role: "assistant",
        content:
          "Done — the hero title on `/content/frontpage.val.ts` is now " +
          "**Build faster**, down from *Build your content faster than ever " +
          "before*.\n\nThe change is a draft; publish it when you are happy " +
          "with it.",
        status: "complete",
        toolActivities: TOOL_RUN,
      },
    ],
  },
};

/** Mid-turn: the row names the tool in flight and shimmers while it runs. */
export const ToolsRunning: Story = {
  args: {
    initialMessages: [
      {
        id: "running-user-1",
        role: "user",
        content: "Change the hero title on the front page to something shorter",
        status: "complete",
      },
      {
        id: "running-assistant-1",
        role: "assistant",
        content: "",
        status: "streaming",
        toolActivities: [
          ...(TOOL_RUN ?? []).slice(0, 3),
          {
            toolCallId: "running-tc-4",
            name: "get_source",
            status: "pending",
          },
        ],
      },
    ],
  },
};

/** Text has started arriving while a later tool call is still running. */
export const ToolsRunningWithText: Story = {
  args: {
    initialMessages: [
      {
        id: "running-text-user-1",
        role: "user",
        content: "Fix the validation errors on the blog posts",
        status: "complete",
      },
      {
        id: "running-text-assistant-1",
        role: "assistant",
        content:
          "I found three posts missing an `author`. Filling them in from the " +
          "editor list now",
        status: "streaming",
        toolActivities: [
          { toolCallId: "rt-tc-1", name: "search_content", status: "complete" },
          { toolCallId: "rt-tc-2", name: "get_source", status: "complete" },
          { toolCallId: "rt-tc-3", name: "create_patch", status: "pending" },
        ],
      },
    ],
  },
};

/** One call failed: the row says so without being opened. */
export const ToolsWithError: Story = {
  args: {
    initialMessages: [
      {
        id: "tool-error-user-1",
        role: "user",
        content: "Add an author to every blog post",
        status: "complete",
      },
      {
        id: "tool-error-assistant-1",
        role: "assistant",
        content:
          "I could not write the change: `/content/posts.val.ts` has no " +
          "`author` field in its schema yet. Add one and I will fill it in.",
        status: "complete",
        toolActivities: [
          { toolCallId: "te-tc-1", name: "get_all_schema", status: "complete" },
          { toolCallId: "te-tc-2", name: "get_source", status: "complete" },
          { toolCallId: "te-tc-3", name: "create_patch", status: "error" },
        ],
      },
    ],
  },
};

/** Several turns, each with its own tool row, as a session looks scrolled back. */
export const ToolsAcrossTurns: Story = {
  args: {
    initialMessages: [
      {
        id: "across-1",
        role: "user",
        content: "What is on the front page right now?",
        status: "complete",
      },
      {
        id: "across-2",
        role: "assistant",
        content:
          "The front page has a hero, a three-column feature grid and a " +
          "newsletter sign-up.",
        status: "complete",
        toolActivities: [
          { toolCallId: "a-tc-1", name: "get_all_schema", status: "complete" },
          { toolCallId: "a-tc-2", name: "get_source", status: "complete" },
        ],
      },
      {
        id: "across-3",
        role: "user",
        content: "Shorten the hero title",
        status: "complete",
      },
      {
        id: "across-4",
        role: "assistant",
        content: "Done — it now reads **Build faster**.",
        status: "complete",
        toolActivities: TOOL_RUN,
      },
    ],
  },
};

/**
 * A turn driven the way the real session drives it: tool calls arrive one at a
 * time, then the answer streams in under them.
 */
function ToolStreamDemo() {
  const chatRef = useRef<AIChatHandle>(null);

  useEffect(() => {
    const chat = chatRef.current;
    if (!chat) return;
    const messageId = "tool-stream-msg";
    const timers: ReturnType<typeof setTimeout>[] = [];
    const calls = [
      "get_current_context",
      "get_all_schema",
      "search_content",
      "get_source",
      "create_patch",
    ];
    chat.startAssistantMessage(messageId);
    calls.forEach((name, i) => {
      const toolCallId = `stream-tc-${i}`;
      timers.push(
        setTimeout(() => {
          chat.addToolCall(messageId, toolCallId, name);
        }, i * 1200),
      );
      timers.push(
        setTimeout(
          () => {
            chat.completeToolCall(messageId, toolCallId);
          },
          i * 1200 + 1100,
        ),
      );
    });
    const answer = [
      "Done — the hero title is now ",
      "**Build faster**",
      ", down from the previous six-word version.",
    ];
    const afterTools = calls.length * 1200;
    answer.forEach((chunk, i) => {
      timers.push(
        setTimeout(
          () => {
            chat.appendAssistantChunk(messageId, chunk);
          },
          afterTools + i * 500,
        ),
      );
    });
    timers.push(
      setTimeout(
        () => {
          chat.completeAssistantMessage(messageId);
        },
        afterTools + answer.length * 500,
      ),
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <AIChat
      ref={chatRef}
      isConnected={true}
      authError={false}
      mode="http"
      initialMessages={[
        {
          id: "tool-stream-user",
          role: "user",
          content:
            "Change the hero title on the front page to something shorter",
          status: "complete",
        },
      ]}
    />
  );
}

export const ToolsStreaming: Story = {
  render: () => <ToolStreamDemo />,
};
