import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Shell } from "../Shell";
import { mockSelectionIds, mockShellData } from "../mockShellData";
import { mockCanvasPage } from "../canvas/mockCanvasPage";
import { AIChat, type AIChatHandle, type ChatMessage } from "../../AIChat";
import {
  createGuideCall,
  guideTourSteps,
  type GuideRequest,
  type ShowGuideArgs,
} from "../assistantGuide";
import { useShellTour } from "../shellTour";

/**
 * The assistant showing someone how to add a blog post (`show_guide`), in
 * the Studio.
 *
 * The chat offers; "Show me how" starts the guided tour with the steps the
 * assistant wrote, in the ring look, so the Studio stays usable and each step
 * moves on when the person does it. On a phone the conversation fills the
 * screen, so the guide starts on the page and offers "Back to chat".
 *
 * The chat is the real `AIChat` and the tour the shell's own; only the
 * assistant's turn is canned.
 */
const meta: Meta<typeof GuidedStudio> = {
  title: "Shell/AssistantGuide",
  component: GuidedStudio,
  parameters: { layout: "fullscreen" },
};
export default meta;

const GUIDE: ShowGuideArgs = {
  title: "Add a blog post",
  why: "It's three steps, and you can do each one yourself.",
  steps: [
    {
      point_at: { control: "pages" },
      title: "Open Pages",
      text: "Every page of your site is listed under Pages.",
      done_when: { panel_open: "pages" },
    },
    {
      point_at: { page_row: "/blog/[slug]" },
      title: "Blog posts are here",
      text: "Each post is a page under blog. Open it to see the ones you have.",
    },
    {
      point_at: { control: "new-page" },
      title: "Add the post",
      text: "New page asks for the post's address, like /blog/my-first-post. You write the text after that.",
    },
  ],
};

const TRANSCRIPT = (state: GuideRequest["state"]): ChatMessage[] => [
  {
    id: "u1",
    role: "user",
    content: "How do I add a new blog post?",
    status: "complete",
  },
  {
    id: "a1",
    role: "assistant",
    content:
      "Blog posts are pages under /blog: open Pages, then New page. I can show you where.",
    status: "complete",
    toolActivities: [
      { toolCallId: "t0", name: "get_current_context", status: "complete" },
      {
        toolCallId: "g1",
        name: "show_guide",
        status: "pending",
        guideRequest: {
          title: GUIDE.title,
          why: GUIDE.why,
          stepCount: GUIDE.steps.length,
          state,
        },
      },
    ],
  },
];

/** The chat, with the guide offered as `useAI` offers it. */
function GuideChat({ start }: { start: boolean }) {
  const tour = useShellTour();
  const chatRef = useRef<AIChatHandle | null>(null);
  const [answer, setAnswer] = useState<GuideRequest | null>(null);
  const call = useMemo(() => {
    const built = guideTourSteps(GUIDE);
    if ("error" in built) throw new Error(built.error);
    return createGuideCall({
      title: GUIDE.title,
      why: GUIDE.why,
      steps: built.steps,
      onChange: (request) =>
        chatRef.current?.setGuideRequest("a1", "g1", request),
      onAnswer: setAnswer,
    });
  }, []);
  useEffect(() => {
    if (start && tour !== null) call.start(tour);
  }, [start, tour, call]);
  return (
    <div className="flex h-full flex-col">
      <AIChat
        ref={chatRef}
        className="min-h-0 flex-1"
        initialMessages={TRANSCRIPT({ kind: "offered" })}
        isConnected
        authError={false}
        mode="http"
        onSendMessage={() => true}
        guideActions={{
          start: () => {
            if (tour !== null) call.start(tour);
          },
          decline: () => call.decline(),
          stop: () => {
            if (tour !== null) call.stop(tour);
          },
        }}
      />
      {answer !== null && (
        // What the assistant would be told, for whoever is trying this.
        <pre className="m-2 max-h-28 overflow-auto rounded bg-bg-secondary p-2 text-[10px] text-fg-secondary">
          {JSON.stringify(answer.state, null, 1)}
        </pre>
      )}
    </div>
  );
}

function GuidedStudio({ startShowing }: { startShowing: boolean }) {
  return (
    <Shell
      data={mockShellData}
      theme="dark"
      onThemeChange={() => undefined}
      initialSelectionId={mockSelectionIds.home}
      initialPanel="ai"
      aiEnabled
      aiSlot={<GuideChat start={startShowing} />}
      canvasPage={mockCanvasPage}
      onNewPage={() => undefined}
      pendingChanges={3}
      onCompare={() => undefined}
      mode="http"
    />
  );
}

/** The offer, in the chat. Press "Show me how". */
export const Offered: StoryObj<typeof GuidedStudio> = {
  args: { startShowing: false },
};

/** The guide running: the first step, around Pages. */
export const Showing: StoryObj<typeof GuidedStudio> = {
  args: { startShowing: true },
};
