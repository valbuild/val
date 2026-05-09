import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useRef } from "react";
import { AIChat, AIChatHandle, ChatMessage } from "./AIChat";

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
    onSendMessage: (text: string) => {
      console.log("Send:", text);
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
    onSendMessage: (text: string) => {
      console.log("Send:", text);
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
    onSendMessage: (text: string) => {
      console.log("Send:", text);
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
    onSendMessage: (text: string) => {
      console.log("Retry send:", text);
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
    onSendMessage: (text: string) => {
      console.log("Retry send:", text);
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
    onSendMessage: (text: string) => {
      console.log("Send:", text);
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
