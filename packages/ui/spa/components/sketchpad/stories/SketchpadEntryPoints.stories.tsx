import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useRef, useState } from "react";
import { AIChat, type ChatMessage } from "../../AIChat";
import type {
  AskUserQuestionAnswer,
  ToolActivity,
} from "../../AIChatToolActivities";
import { Shell } from "../../shell/Shell";
import { mockSelectionIds, mockShellData } from "../../shell/mockShellData";
import { Sketchpad } from "../Sketchpad";
import { SketchpadWorkspace } from "../SketchpadWorkspace";
import { PreviewMock, SKETCH, sketchingSteps } from "./sketchpadFixtures";

/**
 * The three ways into the Sketchpad. None of them asks anyone to use it:
 *
 * 1. **The assistant offers it** when a request changes a page's layout --
 *    "Sketch it first" or "Just do it", with the second a full answer, not a
 *    lesser one. It is `ask_user_question`, the tool the assistant already
 *    asks with, so there is no new kind of chat message.
 * 2. **A page's menu** in the Pages panel has "Sketch changes", for whoever
 *    wants to start there. Hover a page's row and open its ⋯ menu.
 * 3. **The top bar** has a Sketchpad button only once the chat has a
 *    Sketchpad, with a dot when it changed since you last had it open. A bar
 *    that offered it before then would be asking people to start one.
 *
 * In every case the chat comes with it: the Sketchpad belongs to the AI
 * session, so opening one puts the chat beside it (and takes it out of the
 * floating panel, rather than showing it twice).
 */
const meta: Meta<typeof EntryPoint> = {
  title: "Components/Sketchpad/Ways in",
  component: EntryPoint,
  parameters: { layout: "fullscreen", backgrounds: { disable: true } },
  globals: { theme: "light" },
};
export default meta;
type Story = StoryObj<typeof EntryPoint>;

const ASK =
  "Add customer quotes to the home page, and a part on why our coats last.";

const OFFER: ChatMessage[] = [
  { id: "u1", role: "user", content: ASK, status: "complete" },
  {
    id: "a1",
    role: "assistant",
    content:
      "That changes how the page is laid out, not only what it says. Do you want to see it first?",
    status: "complete",
    toolActivities: [
      {
        toolCallId: "offer",
        name: "ask_user_question",
        status: "pending",
        questions: [
          {
            question: "Sketch it first, or go straight on?",
            header: "Sketch first?",
            options: [
              {
                label: "Sketch it first",
                description:
                  "A rough page in the Sketchpad to move around, before anything is built",
              },
              {
                label: "Just do it",
                description:
                  "I change the page now, and you look at it in Review",
              },
            ],
          },
        ],
      },
    ],
  },
];

const SKETCHED: ChatMessage[] = [
  { id: "u1", role: "user", content: ASK, status: "complete" },
  {
    id: "a1",
    role: "assistant",
    content:
      "I've sketched the home page with your changes. Move things around, put photos in the boxes, and send it to me when it's right.",
    status: "complete",
  },
];

type Props = {
  /** Which of the three ways in the story starts at. */
  start: "assistant" | "page-menu" | "top-bar";
};

function EntryPoint({ start }: Props) {
  const [open, setOpen] = useState(false);
  // The Sketchpad, once there is one; the top bar story starts with one.
  const [value, setValue] = useState<string | null>(
    start === "top-bar" ? SKETCH : null,
  );
  const [seen, setSeen] = useState<string | null>(
    start === "top-bar" ? "" : null,
  );
  const [title, setTitle] = useState("/");
  const [writing, setWriting] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const messages = useRef<ChatMessage[]>(
    start === "assistant" ? OFFER : start === "top-bar" ? SKETCHED : [],
  );

  const openSketchpad = () => {
    setOpen(true);
    // The chat goes into the workspace; it is not also left floating.
    setEpoch((e) => e + 1);
  };
  const closeSketchpad = () => {
    setOpen(false);
    setSeen(value);
  };

  // The assistant writing a first sketch, a few blocks at a time.
  const sketch = (page: string) => {
    setTitle(page);
    setValue("");
    setWriting(true);
    openSketchpad();
    sketchingSteps(SKETCH).forEach((step, i, steps) =>
      setTimeout(
        () => {
          setValue(step);
          if (i === steps.length - 1) {
            setWriting(false);
          }
        },
        500 * (i + 1),
      ),
    );
  };

  const answer = (toolCallId: string, answers: AskUserQuestionAnswer[]) => {
    const choice = answers[0]?.selectedOptions[0];
    messages.current = [
      ...messages.current.map((message) => ({
        ...message,
        toolActivities: message.toolActivities?.map(
          (activity): ToolActivity =>
            activity.toolCallId === toolCallId
              ? { ...activity, status: "complete", answers }
              : activity,
        ),
      })),
      {
        id: "a2",
        role: "assistant",
        content:
          choice === 0
            ? "Here is a first sketch in the Sketchpad. Change anything, and send it to me when you want me to build it."
            : "Done: a quotes section with two customers, and three reasons the coats last, on the home page. Open Review to see the changes.",
        status: "complete",
      },
    ];
    if (choice === 0) {
      sketch("/");
    } else {
      setEpoch((e) => e + 1);
    }
  };

  useEffect(() => {
    if (open) {
      setSeen(value);
    }
  }, [open, value]);

  const chat = (
    <AIChat
      // Remounted where it moves, so it starts from the conversation so far.
      key={`${open}-${epoch}`}
      isConnected
      authError={false}
      mode="http"
      initialMessages={messages.current}
      onSendMessage={() => true}
      onAnswerToolQuestions={answer}
    />
  );

  return (
    <Shell
      data={mockShellData}
      theme="light"
      onThemeChange={() => undefined}
      initialSelectionId={mockSelectionIds.home}
      initialPanel={
        start === "assistant" ? "ai" : start === "page-menu" ? "pages" : null
      }
      restoreViewState={
        epoch === 0
          ? undefined
          : {
              epoch,
              panel: open ? null : "ai",
              canvasOpen: false,
              canvasView: "normal",
            }
      }
      aiEnabled
      aiSlot={open ? undefined : chat}
      pendingChanges={3}
      onCompare={() => console.log("open the review view")}
      onNewPage={() => undefined}
      onDuplicatePage={() => undefined}
      onRenamePage={() => undefined}
      onSketchPage={(page) => {
        messages.current = [
          ...messages.current,
          {
            id: `sketch-${page.urlPath}`,
            role: "user",
            content: `Sketch changes to ${page.urlPath}.`,
            status: "complete",
          },
        ];
        sketch(page.urlPath);
      }}
      sketchpad={
        value === null
          ? undefined
          : {
              open,
              changed: seen !== value,
              onToggle: open ? closeSketchpad : openSketchpad,
            }
      }
      workspaceOverride={
        open && value !== null ? (
          <SketchpadWorkspace
            preview={<PreviewMock />}
            sketchpads={{
              sketchpads: [{ id: "pad", title, archived: false }],
              currentId: "pad",
              onOpen: () => undefined,
              onReopen: () => undefined,
            }}
            sketchpad={
              <Sketchpad
                value={value}
                onChange={setValue}
                readOnly={writing}
                title={title}
                status={
                  writing
                    ? "The assistant is sketching the page…"
                    : "In your chat with the assistant"
                }
                onAskAssistant={() => console.log("send to the assistant")}
                assistantStatus={writing ? "reading" : "read"}
              />
            }
            chat={chat}
          />
        ) : undefined
      }
    />
  );
}

/** 1. The assistant offers the Sketchpad, as one of two answers. */
export const TheAssistantOffersIt: Story = {
  args: { start: "assistant" },
};

/** 2. "Sketch changes" in a page's ⋯ menu, in the Pages panel. */
export const FromAPagesMenu: Story = {
  args: { start: "page-menu" },
};

/**
 * 3. The top bar's Sketchpad button: there because this chat has one, with
 * a dot because it changed since it was last open. Press it to open the
 * Sketchpad, and again to go back to the page.
 */
export const FromTheTopBar: Story = {
  args: { start: "top-bar" },
};
