import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useRef, useState } from "react";
import { AIChat, type AIChatHandle, type ChatMessage } from "../../AIChat";
import { Shell } from "../../shell/Shell";
import { mockSelectionIds, mockShellData } from "../../shell/mockShellData";
import {
  Sketchpad,
  type SketchpadAssistantStatus,
  type SketchpadPerson,
} from "../Sketchpad";
import type { SketchpadSummary } from "../SketchpadList";
import { SketchpadWorkspace } from "../SketchpadWorkspace";
import { PreviewMock, SKETCH } from "./sketchpadFixtures";

/**
 * Sketchpad in the Studio: the Preview, the Sketchpad and the chat it
 * belongs to, side by side as far as the screen allows.
 *
 * - Wide (1440px and up): all three.
 * - Narrower: the Sketchpad and one of the others, picked above them.
 * - A phone: one at a time.
 *
 * Resize the preview to see each. The chat has three sketchpads, one per
 * page: the title switches between them, the archive button puts one away
 * (with an undo), and an archived one is reopened from the same list -- or
 * from the strip that takes the Sketchpad's place when none is open.
 * The Sketchpad belongs to the AI session:
 * the assistant can read it whenever it wants, and **Send to AI** asks
 * it to now. Here the reply is simulated: it reads, answers and makes
 * one change of its own, which lands in the Sketchpad as it is written.
 */
const meta: Meta<typeof SketchpadInStudio> = {
  title: "Components/Sketchpad/In the Studio",
  component: SketchpadInStudio,
  parameters: { layout: "fullscreen", backgrounds: { disable: true } },
};
export default meta;
type Story = StoryObj<typeof SketchpadInStudio>;

const PEOPLE: SketchpadPerson[] = [
  { name: "Fredrik Ekholdt", you: true },
  { name: "Kari Nordmann" },
];

const OPENING: ChatMessage[] = [
  {
    id: "m1",
    role: "user",
    content:
      "Rework the home page: keep the hero, add why our coats last, and put customer quotes on it.",
    status: "complete",
  },
  {
    id: "m2",
    role: "assistant",
    content:
      "I've sketched it in the Sketchpad: the hero as it is, three reasons it lasts, and two customer quotes before the newsletter. Change anything there, put photos in the boxes, and send it to me when you're done.",
    status: "complete",
  },
];

const STORES = `# Our stores
row
  col
    ## Bergen
    Strandkaien 2, open every day.
    [map: Bergen shop]
  col
    ## Oslo
    Markveien 41, closed on Mondays.
    [map: Oslo shop]

icon map M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z M12 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z
`;

const JOURNAL = `# Journal
[list: Latest stories, newest first]
`;

type Pad = SketchpadSummary & {
  value: string;
  /** The text as the assistant last read it. */
  readValue: string;
};

const PADS: Pad[] = [
  {
    id: "home",
    title: "/",
    detail: "Sketched by the assistant · 5 min ago",
    archived: false,
    value: SKETCH,
    readValue: SKETCH,
  },
  {
    id: "stores",
    title: "/stores",
    detail: "Changed by you · yesterday",
    archived: false,
    value: STORES,
    readValue: STORES,
  },
  {
    id: "journal",
    title: "/journal",
    detail: "Archived by you · Monday",
    archived: true,
    value: JOURNAL,
    readValue: JOURNAL,
  },
];

const ADDED_QUOTE = "  [testimonial: Mari, wears the coat her mother bought]";

type Props = {
  /** In a proposal, with someone else working on it too (Flow H). */
  inProposal: boolean;
  theme: "dark" | "light";
};

function SketchpadInStudio({ inProposal, theme }: Props) {
  const [pads, setPads] = useState(PADS);
  const [currentId, setCurrentId] = useState<string | null>("home");
  const [archivedId, setArchivedId] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [currentTheme, setTheme] = useState(theme);
  const chat = useRef<AIChatHandle>(null);
  const messages = useRef<ChatMessage[]>(OPENING);
  const padsRef = useRef(pads);
  padsRef.current = pads;

  const current = pads.find((pad) => pad.id === currentId && !pad.archived);
  const update = (id: string, patch: Partial<Pad>) =>
    setPads((all) =>
      all.map((pad) => (pad.id === id ? { ...pad, ...patch } : pad)),
    );

  // "Archived. Undo" for long enough to be read and acted on, then gone.
  useEffect(() => {
    if (archivedId === null) {
      return;
    }
    const timer = setTimeout(() => setArchivedId(null), 8000);
    return () => clearTimeout(timer);
  }, [archivedId]);

  const archive = (id: string) => {
    update(id, { archived: true, detail: "Archived by you · just now" });
    setCurrentId(null);
    setArchivedId(id);
  };
  const reopen = (id: string) => {
    update(id, { archived: false, detail: "Reopened by you · just now" });
    setCurrentId(id);
    setArchivedId(null);
  };

  const status: SketchpadAssistantStatus = reading
    ? "reading"
    : current && current.value === current.readValue
      ? "read"
      : "changed";

  // What the Studio would do: post the ask in the session's chat, and run the
  // assistant's `read_sketchpad` and `write_sketchpad` calls against it.
  const askAssistant = (padId: string) => {
    const handle = chat.current;
    const pad = padsRef.current.find((p) => p.id === padId);
    if (!handle || !pad) {
      return;
    }
    setReading(true);
    const turn = messages.current.length;
    messages.current = [
      ...messages.current,
      {
        id: `ask-${turn}`,
        role: "user",
        content: `I've changed the Sketchpad for ${pad.title}. Read it and tell me what you think.`,
        status: "complete",
      },
    ];
    handle.loadMessages(messages.current);
    const id = `reply-${turn}`;
    handle.startAssistantMessage(id);
    handle.addToolCall(id, `read-${turn}`, "read_sketchpad");
    setTimeout(() => {
      handle.completeToolCall(id, `read-${turn}`);
      const read =
        padsRef.current.find((p) => p.id === padId)?.value ?? pad.value;
      const canAdd =
        read.includes("[testimonial: Jonas") && !read.includes(ADDED_QUOTE);
      handle.appendAssistantChunk(
        id,
        canAdd
          ? "Read it. The changes work. Two quotes looked thin next to three reasons, so I added a third. Say \"build it\" when you're happy and I'll make the page."
          : "Read it, and it reads well. Say \"build it\" when you're happy and I'll make the page.",
      );
      if (!canAdd) {
        handle.completeAssistantMessage(id);
        update(padId, { readValue: read });
        setReading(false);
        return;
      }
      handle.addToolCall(id, `write-${turn}`, "write_sketchpad");
      setTimeout(() => {
        const written = read.replace(
          /( {2}\[testimonial: Jonas[^\n]*\n)/,
          `$1${ADDED_QUOTE}\n`,
        );
        update(padId, { value: written, readValue: written });
        handle.completeToolCall(id, `write-${turn}`);
        handle.completeAssistantMessage(id);
        setReading(false);
      }, 900);
    }, 1200);
  };

  const list = {
    sketchpads: pads,
    currentId: current?.id ?? null,
    onOpen: setCurrentId,
    onReopen: reopen,
  };
  const archivedPad = pads.find((pad) => pad.id === archivedId);

  return (
    <Shell
      key={theme}
      data={mockShellData}
      theme={currentTheme}
      onThemeChange={setTheme}
      initialSelectionId={mockSelectionIds.home}
      aiEnabled
      pendingChanges={3}
      onCompare={() => console.log("open the review view")}
      workspaceOverride={
        <SketchpadWorkspace
          preview={<PreviewMock />}
          sketchpads={list}
          notice={
            archivedPad && (
              <div
                role="status"
                className="flex shrink-0 items-center gap-3 rounded-lg border border-border-primary bg-bg-primary px-3 py-1.5 text-xs text-fg-secondary"
              >
                <span>
                  Archived the sketchpad for {archivedPad.title}. Reopen it from
                  the list of sketchpads.
                </span>
                <button
                  type="button"
                  onClick={() => reopen(archivedPad.id)}
                  className="cursor-pointer font-medium text-fg-primary underline"
                >
                  Undo
                </button>
              </div>
            )
          }
          sketchpad={
            current ? (
              <Sketchpad
                key={current.id}
                value={current.value}
                onChange={(value) => update(current.id, { value })}
                readOnly={reading}
                title={current.title}
                people={inProposal ? PEOPLE : undefined}
                status={
                  inProposal
                    ? "In ⎇ Autumn campaign, with Kari"
                    : "In your chat “Rework the home page”"
                }
                onAskAssistant={() => askAssistant(current.id)}
                assistantStatus={status}
                onArchive={() => archive(current.id)}
                sketchpads={list}
              />
            ) : null
          }
          chat={
            <AIChat
              ref={chat}
              isConnected
              authError={false}
              mode="http"
              initialMessages={OPENING}
              onSendMessage={() => true}
            />
          }
        />
      }
    />
  );
}

export const InTheStudio: Story = {
  args: { inProposal: false, theme: "light" },
  // Popovers portal outside the shell, so they take Storybook's theme.
  globals: { theme: "light" },
};

export const InAProposal: Story = {
  args: { inProposal: true, theme: "dark" },
};
