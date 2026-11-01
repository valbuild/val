import type { Meta } from "@storybook/react";
import { useEffect, useRef } from "react";
import { AIChat, type AIChatHandle, type ChatMessage } from "../../AIChat";
import type { ToolActivity } from "../../AIChatToolActivities";
import type { CodeModeRequest } from "../../CodeModeRequestCard";
import { MESSAGES } from "../../design/stories/designStoryFixtures";
import { mockSelectionIds } from "../../shell/mockShellData";
import type { CodeModeStatusVariant } from "../CodeModeStatus";
import {
  inProposal,
  inUpgrade,
  shell,
  type CodeModeControl,
} from "./proposalsShellHarness";

/**
 * Code mode: the `</>` right of the proposal switcher, in a hosted Studio.
 *
 * - **On the site** the `</>` opens a menu of the open proposals. Choosing one
 *   goes to its address with code mode on (a query parameter, `?code`), the
 *   way the switcher goes to one -- "Opening … in code mode…", then there.
 * - **In a proposal** it is a toggle, and the ONLY switch: on, the workspace
 *   is the proposal's preview rather than the content editor, with the code's
 *   changes one tab away and the assistant docked beside it.
 * - **The preview's status** is in the reload button, and nothing else moves
 *   when it changes. Four ways to show it are in `Status options`; the
 *   screens use `reload`, and the `Status: …` stories show the others in the
 *   whole Studio. Press **Save** in any of them to watch it update.
 * - **No jargon.** Nobody editing a site needs "build" or "typecheck": the
 *   status, Save and the assistant's tool row talk about the preview and the
 *   code changing.
 * - **The assistant** has the code tools everywhere in a hosted Studio, as
 *   well as the content tools it always had. With code mode off they refuse,
 *   and it asks for code mode with a button that turns it on (see
 *   `Components/AIChat/CodeModeRequest`).
 *
 * Presentational: where the data comes from is being worked out separately.
 */
const meta: Meta = {
  title: "Proposals/Code mode",
  parameters: { layout: "fullscreen", backgrounds: { disable: true } },
};
export default meta;

/** On the site, in a hosted Studio: the `</>` sits right of the switcher. */
export const OnTheSite = shell({
  location: { kind: "site" },
  selectionId: mockSelectionIds.home,
  codeMode: {},
  saveBuilds: true,
});

/**
 * The `</>` pressed on the site: code is changed in a proposal, so it offers
 * the open ones. Choose one -- it opens in code mode.
 */
export const OnTheSiteMenuOpen = shell({
  location: { kind: "site" },
  selectionId: mockSelectionIds.home,
  codeMode: { menuOpen: true },
  saveBuilds: true,
});

/** No proposal open yet: the menu says so, and offers a new one. */
export const OnTheSiteNoProposals = shell({
  location: { kind: "site" },
  list: [],
  selectionId: mockSelectionIds.home,
  codeMode: { menuOpen: true },
  saveBuilds: true,
});

/** On the way there: the switcher says where it is going, and how. */
export const OpeningInCodeMode = shell({
  location: { kind: "site" },
  selectionId: mockSelectionIds.home,
  leaving: "Opening “Spring campaign” in code mode…",
  codeMode: {},
  saveBuilds: true,
});

/**
 * In a proposal with code mode off: the `</>` is an outlined toggle in the
 * proposal's colour. Press it to turn code mode on.
 */
export const InAProposal = shell({
  location: inProposal({ unsaved: 0 }),
  selectionId: mockSelectionIds.home,
  codeMode: {},
  saveBuilds: true,
});

const codeChat = (messages: ChatMessage[]) => () => (
  <AIChat
    className="h-full"
    initialMessages={messages}
    isConnected
    authError={false}
    mode="http"
    onSendMessage={() => true}
  />
);

/**
 * Code mode on: the `</>` is pressed, the workspace is the proposal's
 * preview, and the assistant is docked beside it. Press the `</>` again to
 * edit content.
 */
export const CodeModeOn = shell({
  location: inProposal({ unsaved: 0 }),
  codeMode: { on: true },
  saveBuilds: true,
  renderChat: codeChat(MESSAGES),
});

export const CodeModeOnLight = shell({
  location: inProposal({ unsaved: 0 }),
  theme: "light",
  codeMode: { on: true },
  saveBuilds: true,
  renderChat: codeChat(MESSAGES),
});

/** Changes: the proposal's code against the site's. */
export const CodeModeChanges = shell({
  location: inProposal({ unsaved: 0 }),
  codeMode: { on: true, view: "changes" },
  saveBuilds: true,
  renderChat: codeChat(MESSAGES),
});

/**
 * The code changed since the preview was made: a dot on the reload button
 * (its tooltip says "Save to update"), and Save -- with nothing unsaved -- is
 * enabled, marked with the hammer. Press it and watch the reload button.
 */
export const PreviewBehind = shell({
  location: inProposal({ unsaved: 0, code: { state: "required" } }),
  codeMode: { on: true },
  saveBuilds: true,
  renderChat: codeChat(MESSAGES),
});

/** Content edited too: Save saves the 2 changes, then updates the preview. */
export const PreviewBehindWithUnsaved = shell({
  location: inProposal({ unsaved: 2, code: { state: "required" } }),
  codeMode: { on: true },
  saveBuilds: true,
  renderChat: codeChat(MESSAGES),
});

/** Updating: the reload arrow turns, with how far it is beside it. */
export const PreviewUpdating = shell({
  location: inProposal({ unsaved: 0, code: { state: "building" } }),
  codeMode: { on: true, progress: 0.42 },
  saveBuilds: true,
  renderChat: codeChat(MESSAGES),
});

/**
 * It could not be updated: a red dot on the reload button, which opens what
 * happened (the error under Details) and offers the assistant to fix it.
 * Save says "Couldn't update", and tries again.
 */
export const PreviewCouldNotUpdate = shell({
  location: inProposal({
    unsaved: 0,
    code: {
      state: "failed",
      error:
        "src/components/sections/Testimonials.tsx(5,22): error TS2304: Cannot find name 'Card'.",
    },
  }),
  codeMode: { on: true },
  saveBuilds: true,
  renderChat: codeChat(MESSAGES),
});

/** A proposal that changes no code yet: nothing under Changes. */
export const CodeModeNothingChanged = shell({
  location: inProposal({ unsaved: 0 }),
  codeMode: { on: true, changed: false, view: "changes" },
  saveBuilds: true,
  renderChat: codeChat([]),
});

/** At an upgrade's address there is no `</>`: its code is Val Build's. */
export const NotInAnUpgrade = shell({
  location: inUpgrade(),
  codeMode: {},
  saveBuilds: true,
});

/*
 * The four ways to show the preview's status, each in the whole Studio while
 * it updates. Press Save to run an update from the start.
 */
const updating = (status: CodeModeStatusVariant) =>
  shell({
    location: inProposal({ unsaved: 1, code: { state: "required" } }),
    codeMode: { on: true, status },
    saveBuilds: true,
    renderChat: codeChat(MESSAGES),
  });

/** `reload`: the arrow turns, the percentage beside it. Nothing else. */
export const StatusReload = updating("reload");
/** `label`: two or three words beside the arrow. */
export const StatusLabel = updating("label");
/** `ring`: a ring fills around the arrow; the percentage is in the tooltip. */
export const StatusRing = updating("ring");
/** `line`: a hairline fills along the foot of the toolbar. */
export const StatusLine = updating("line");

// ---------------------------------------------------------------------------
// The assistant asks for code mode
// ---------------------------------------------------------------------------

const ASK =
  "Replace the quote on the front page with three customer testimonials, as cards.";

const REASON =
  "To add a Testimonials section with its own schema (quote, name, place) and put it on the front page where the quote is. That is a new component, which content alone cannot make.";

function askingMessages(where: CodeModeRequest["where"]): ChatMessage[] {
  return [
    { id: "u1", role: "user", content: ASK, status: "complete" },
    {
      id: "a1",
      role: "assistant",
      content:
        "This needs a code change, and code mode is off, so I could not write the files. Turn it on and I will make the change.",
      status: "complete",
      toolActivities: [
        { toolCallId: "t1", name: "get_current_context", status: "complete" },
        { toolCallId: "t2", name: "search_code", status: "complete" },
        { toolCallId: "t3", name: "read_file", status: "complete" },
        // Refused: code mode is off.
        { toolCallId: "t4", name: "write_files", status: "error" },
        {
          toolCallId: "t5",
          name: "request_code_mode",
          status: "pending",
          codeModeRequest: { reason: REASON, where, state: "asking" },
        },
      ],
    },
  ];
}

/**
 * What the assistant's turn does once code mode is on: the app answers
 * `request_code_mode`, and the model goes on with the change.
 */
function useScriptedAsk(code: CodeModeControl) {
  const chat = useRef<AIChatHandle>(null);
  const messages = useRef<ChatMessage[]>(askingMessages(code.where));
  const codeRef = useRef(code);
  codeRef.current = code;
  const continued = useRef(false);

  const setRequest = (state: CodeModeRequest["state"]) => {
    messages.current = messages.current.map((message) =>
      message.id !== "a1"
        ? message
        : {
            ...message,
            toolActivities: message.toolActivities?.map(
              (activity): ToolActivity =>
                activity.codeModeRequest === undefined
                  ? activity
                  : {
                      ...activity,
                      status: state === "asking" ? "pending" : "complete",
                      codeModeRequest: { ...activity.codeModeRequest, state },
                    },
            ),
          },
    );
    chat.current?.loadMessages(messages.current);
  };

  // Code mode came on -- from the card, the `</>`, or a proposal chosen in
  // its menu: the request is answered, and the change goes on.
  useEffect(() => {
    if (!code.on || continued.current) return;
    continued.current = true;
    setRequest("on");
    const handle = chat.current;
    if (!handle) return;
    handle.startAssistantMessage("a2");
    const steps: [string, number][] = [
      ["write_files", 900],
      ["format_files", 500],
      ["lint", 600],
      ["typecheck", 1100],
    ];
    let at = 0;
    steps.forEach(([name], index) => {
      setTimeout(() => handle.addToolCall("a2", `c${index}`, name), at);
      at += steps[index]![1];
      setTimeout(() => handle.completeToolCall("a2", `c${index}`), at);
    });
    setTimeout(() => {
      codeRef.current.stageCode();
      handle.appendAssistantChunk(
        "a2",
        "Done. I added a **Testimonials** section (`src/components/sections/Testimonials.tsx`) with its own schema, put it on the front page where the quote was, and removed the Quote section, which nothing else used.\n\nPress **Save**, and you see it in the preview. Nothing on the site changes until the proposal is published.",
      );
      handle.completeAssistantMessage("a2");
    }, at + 200);
  }, [code.on]);

  return {
    chat,
    initialMessages: messages.current,
    onEnable: () => {
      if (codeRef.current.where.kind === "site") {
        codeRef.current.chooseProposal();
        return;
      }
      setRequest("turning-on");
      setTimeout(() => codeRef.current.turnOn(), 600);
    },
    onDecline: () => {
      setRequest("declined");
      chat.current?.appendMessage({
        id: "a-declined",
        role: "assistant",
        content:
          "All right, I left the code alone. Ask again when you want the testimonials, or turn code mode on with the </> at the top.",
        status: "complete",
      });
    },
  };
}

function AskingChat({ code }: { code: CodeModeControl }) {
  const { chat, initialMessages, onEnable, onDecline } = useScriptedAsk(code);
  return (
    <AIChat
      ref={chat}
      className="h-full"
      initialMessages={initialMessages}
      isConnected
      authError={false}
      mode="http"
      onSendMessage={() => true}
      onEnableCodeMode={onEnable}
      onDeclineCodeMode={onDecline}
    />
  );
}

/**
 * In a proposal with code mode off, someone asks for something only code can
 * do. The assistant's `write_files` is refused, so it asks for code mode with
 * a card in the chat. Press **Turn on code mode**: the `</>` is pressed, the
 * workspace becomes the preview, and the assistant makes the change -- then
 * Save, marked with the hammer, updates the preview.
 */
export const AssistantAsksForCodeMode = shell({
  location: inProposal({ unsaved: 0 }),
  selectionId: mockSelectionIds.home,
  codeMode: { changed: false },
  saveBuilds: true,
  renderChat: (code) => <AskingChat code={code} />,
});

/**
 * The same ask on the site, where there is nothing to turn on: the card's
 * button opens the `</>` menu, and the proposal chosen there opens in code
 * mode with the assistant going on with the change.
 */
export const AssistantAsksOnTheSite = shell({
  location: { kind: "site" },
  selectionId: mockSelectionIds.home,
  codeMode: { changed: false },
  saveBuilds: true,
  renderChat: (code) => <AskingChat code={code} />,
});

/*
 * ON A PHONE. The shell reads the viewport, so these are at 390px: open them
 * with Storybook's mobile viewport. There is no `</>` in a phone's top bar;
 * code mode is in the sheet behind the location chip.
 */

/** In a proposal: code mode is a switch at the top of its sheet. */
export const PhoneProposalSheet = shell({
  location: inProposal({ unsaved: 0 }),
  panel: "proposals",
  codeMode: {},
  saveBuilds: true,
});

/** Switched on, in the sheet. */
export const PhoneProposalSheetCodeOn = shell({
  location: inProposal({ unsaved: 0 }),
  panel: "proposals",
  codeMode: { on: true },
  saveBuilds: true,
});

/**
 * On the site: "Code mode…" unfolds into the proposals to open in it. Press
 * it to see them.
 */
export const PhoneSiteSheet = shell({
  location: { kind: "site" },
  panel: "proposals",
  codeMode: {},
  saveBuilds: true,
});

/** Code mode on a phone: the preview, with Save at the foot. */
export const PhoneCodeModeOn = shell({
  location: inProposal({ unsaved: 0, code: { state: "required" } }),
  codeMode: { on: true },
  saveBuilds: true,
});
