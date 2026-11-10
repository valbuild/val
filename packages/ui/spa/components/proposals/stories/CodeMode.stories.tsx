import type { Meta } from "@storybook/react";
import { useEffect, useRef } from "react";
import { AIChat, type AIChatHandle, type ChatMessage } from "../../AIChat";
import type { ToolActivity } from "../../AIChatToolActivities";
import type { CodeModeRequest } from "../../CodeModeRequestCard";
import { MESSAGES } from "./codeFixtures";
import { mockSelectionIds } from "../../shell/mockShellData";
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
 * - **The preview's status** is two or three words in the reload button --
 *   "Up to date", "Save to update", "Updating 42%", "Couldn't update" -- one
 *   width in every state, so nothing else moves when it changes. Press
 *   **Save** where it is behind to watch it update.
 * - **Save does everything a preview takes**, the site's packages included:
 *   there is no Build or Compute lockfile button any more.
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
 * The code changed since the preview was made: the reload button says "Save
 * to update", and Save -- with nothing unsaved -- is enabled, with a hammer
 * for its icon. Press it and watch the reload button.
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
 * It could not be updated, after Kari's assistant changed the code: the
 * preview's status says "Couldn't update" and opens what happened, and the
 * switcher has a dot. Save does not change -- there is nothing to save --
 * and Publish waits. Press the status: Kari's chat, or your own assistant.
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

/**
 * The site's packages changed (its `package.json`): to the person this is
 * the same as any other change -- "Save to update", and Save with the hammer for its icon.
 * Press it: one update, one percentage, though the lockfile, the packages
 * and the code each take their turn underneath.
 */
export const PackagesChanged = shell({
  location: inProposal({
    unsaved: 0,
    code: { state: "lockfile", computing: false, error: null },
  }),
  codeMode: { on: true },
  saveBuilds: true,
  renderChat: codeChat(MESSAGES),
});

/** Updating, while the packages install: still just "Updating". */
export const PackagesInstalling = shell({
  location: inProposal({
    unsaved: 0,
    code: { state: "dependencies-building" },
  }),
  codeMode: { on: true, progress: 0.24 },
  saveBuilds: true,
  renderChat: codeChat(MESSAGES),
});

/**
 * The packages could not be installed: to the person, a preview that could
 * not be updated like any other, with no "Try again", since that would only
 * fail the same way.
 */
export const PackagesCouldNotInstall = shell({
  location: inProposal({
    unsaved: 0,
    code: {
      state: "dependencies-failed",
      error:
        "ERR_PNPM_NO_MATCHING_VERSION No matching version found for react-carousel-kit@^9.0.0",
    },
  }),
  codeMode: { on: true },
  saveBuilds: true,
  renderChat: codeChat(MESSAGES),
});

/*
 * WHEN THE PREVIEW COULD NOT BE UPDATED. Not on Save: the change that broke
 * it was almost always an assistant's, often someone else's. A dot on the
 * switcher (which never moves anything), and at the top of its menu what
 * happened, whose change it followed, and the ways on.
 */

const FAILED = inProposal({
  unsaved: 0,
  code: {
    state: "failed",
    error:
      "src/components/sections/Testimonials.tsx(5,22): error TS2304: Cannot find name 'Card'.",
  },
});

/**
 * Editing content in the proposal, code mode off: the switcher has a dot.
 * Save is just Save. Press the switcher.
 */
export const PreviewProblemWhileEditing = shell({
  location: { ...FAILED, unsaved: 2 },
  selectionId: mockSelectionIds.home,
  codeMode: {},
  saveBuilds: true,
});

/**
 * The switcher, open: what happened to the preview, after whose change, and
 * the ways on -- Kari's chat (her assistant knows what it did), your own
 * assistant, or Details for whoever needs the error.
 */
export const PreviewProblemInTheSwitcher = shell({
  location: FAILED,
  selectionId: mockSelectionIds.home,
  codeMode: {},
  saveBuilds: true,
  switcherOpen: true,
});

/** Your own assistant's change: "After your assistant changed the code". */
export const PreviewProblemByYourAssistant = shell({
  location: FAILED,
  selectionId: mockSelectionIds.home,
  codeMode: {},
  saveBuilds: true,
  switcherOpen: true,
  problemBy: "viewer",
});

/** On a phone: a dot on the location chip, and the card heads its sheet. */
export const PhonePreviewProblem = shell({
  location: FAILED,
  panel: "proposals",
  codeMode: {},
  saveBuilds: true,
});

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
 * Save, with the hammer for its icon, updates the preview.
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

/**
 * Code mode on, by someone else: the `</>` is pressed for everyone in the
 * proposal, and the switcher's menu says who turned it on and when. This
 * person stays in the content editor -- the view is each person's -- and
 * their edits are saved before each of the assistant's code writes.
 */
export const OnBySomeoneElseInTheEditor = shell({
  location: inProposal({ unsaved: 2 }),
  selectionId: mockSelectionIds.home,
  codeMode: { on: true, contentView: true, turnedOnBy: "Kari Nordmann" },
  saveBuilds: true,
  switcherOpen: true,
});

/**
 * The `</>` pressed while code mode is on: who turned it on, which view this
 * person sees, and Turn off -- for everyone, discarding nothing.
 */
export const CodeModeMenu = shell({
  location: inProposal({ unsaved: 0 }),
  codeMode: { on: true, turnedOnBy: "you", menuOpen: true },
  saveBuilds: true,
  renderChat: codeChat(MESSAGES),
});

/**
 * Save is the one main button; its menu holds Commit (a project connected to
 * git) and Publish. In code mode there is no "Fix N": Save saves invalid
 * content too, and Publish is refused until it is fixed.
 */
export const SaveMenuWithCommit = shell({
  location: inProposal({ unsaved: 2 }),
  codeMode: { on: true, contentView: true },
  saveBuilds: true,
  commit: {},
  validationErrors: 2,
  menuOpen: true,
});

/** Nothing saved since the last Commit: Commit says so, and waits. */
export const SaveMenuCommitted = shell({
  location: inProposal({ unsaved: 0 }),
  saveBuilds: true,
  commit: { upToDate: true },
  menuOpen: true,
});

/**
 * Commit refused: somebody else pushed to the proposal's branch. Who, when,
 * a link to their commit, and Build on their push -- no Try again, since
 * pressing again would be refused the same way. Press it: their push comes
 * in, one file keeps the proposal's version, the preview is rebuilt, and
 * Commit again goes on top of their commit.
 */
export const CommitRefusedSomeonePushed = shell({
  location: inProposal({ unsaved: 0 }),
  saveBuilds: true,
  commit: {},
  commitRefused: true,
});

/** Bringing their push into the proposal. */
export const CommitBuildingOnTheirPush = shell({
  location: inProposal({ unsaved: 0 }),
  saveBuilds: true,
  commit: {},
  commitRefused: { kind: "building" },
});

/**
 * Their push is in: two files both changed kept the proposal's version, and
 * one change a proposal cannot hold is named. The preview is still being
 * rebuilt; Commit does not wait for it.
 */
export const CommitBuiltOnTheirPush = shell({
  location: inProposal({ unsaved: 0 }),
  saveBuilds: true,
  commit: {},
  commitRefused: {
    kind: "built",
    kept: ["content/home.val.ts", "src/components/Hero.tsx"],
    notTaken: [".github/workflows/deploy.yml"],
    rewritten: false,
    rebuild: { state: "running" },
  },
});

/**
 * Their push is in, but the preview could not be rebuilt with their code:
 * Build again, and Commit still goes.
 */
export const CommitBuiltOnTheirPushPreviewFailed = shell({
  location: inProposal({ unsaved: 0 }),
  saveBuilds: true,
  commit: {},
  commitRefused: {
    kind: "built",
    kept: [],
    notTaken: [],
    rewritten: true,
    rebuild: {
      state: "failed",
      message: "src/components/Hero.tsx: Unexpected token (12:4)",
      canRetry: true,
    },
  },
});

/** GitHub could not be reached: nothing came in, and Try again does it again. */
export const CommitBuildOnTheirPushFailed = shell({
  location: inProposal({ unsaved: 0 }),
  saveBuilds: true,
  commit: {},
  commitRefused: {
    kind: "failed",
    message:
      "GitHub could not be reached, so their push was not brought in. Nothing changed in the proposal.",
    offer: { kind: "retry" },
  },
});

/**
 * Their push changes more files than one take-in holds: asking again cannot
 * help, so nothing is offered but their commit, where a developer sorts it out.
 */
export const CommitBuildOnTheirPushTooBig = shell({
  location: inProposal({ unsaved: 0 }),
  saveBuilds: true,
  commit: {},
  commitRefused: {
    kind: "failed",
    message:
      "Their push changes 1,204 files, and Val brings in at most 1,000 at a time. A developer can split it, or merge it into the proposal's branch by hand.",
    offer: null,
  },
});

/** The session ran out while bringing it in: Sign in, and come back here. */
export const CommitBuildOnTheirPushSignedOut = shell({
  location: inProposal({ unsaved: 0 }),
  saveBuilds: true,
  commit: {},
  commitRefused: {
    kind: "failed",
    message: "Your session has run out, so their push was not brought in.",
    offer: { kind: "sign-in", url: "#sign-in" },
  },
});

/**
 * Signed in, and not allowed to change the proposal (not a member of the
 * project): the owners by name and an email to them -- not Sign in, which
 * presents the same credential again.
 */
export const CommitBuildOnTheirPushNotAllowed = shell({
  location: inProposal({ unsaved: 0 }),
  saveBuilds: true,
  commit: {},
  commitRefused: {
    kind: "failed",
    message:
      "You are not allowed to change this proposal, so their push was not brought in. You are not a member of this project. Ask an owner of acme to add you.",
    offer: {
      kind: "not-allowed",
      owners: [{ name: "Grace Hopper", email: "grace@acme.example" }],
      projectUrl: "#project",
    },
  },
});

/**
 * Their code does not build, and building again cannot help (the build
 * said so): the error, and the assistant to fix it.
 */
export const CommitBuildOnTheirPushDoesNotBuild = shell({
  location: inProposal({ unsaved: 0 }),
  saveBuilds: true,
  commit: {},
  commitRefused: {
    kind: "built",
    kept: [],
    notTaken: [],
    rewritten: false,
    rebuild: {
      state: "failed",
      message: "src/components/Hero.tsx: Unexpected token (12:4)",
      canRetry: false,
    },
  },
});

/**
 * The project's plan refuses writes (a trial that ended): Billing, where it
 * is fixed -- not Sign in, which would be refused the same way.
 */
export const CommitBuildOnTheirPushPlanRefused = shell({
  location: inProposal({ unsaved: 0 }),
  saveBuilds: true,
  commit: {},
  commitRefused: {
    kind: "failed",
    message:
      "Their push was not brought in: The trial has ended. Add a card to keep changing content.",
    offer: { kind: "billing", url: "#billing" },
  },
});
