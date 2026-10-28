import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AIChat, type AIChatHandle, type ChatMessage } from "../../AIChat";
import { Button } from "../../designSystem/button";
import type { AISession } from "../../../hooks/useAIWebSocket";
import {
  ProposalInviteMenu,
  inviteCandidateKey,
  type InviteCandidate,
  type InviteRole,
  type InviteRowState,
} from "../ProposalInviteMenu";
import { ProposalPeopleButton } from "../ProposalPeopleButton";
import { applyWatchedEvent } from "../../../hooks/sharedChat";
import type { AIWatchedMessage } from "../../../hooks/useAIWebSocket";
import { WorkTogetherButton, WorkTogetherOffer } from "../WorkTogether";
import type { ProposalParticipant, ProposalParticipantReason } from "../types";

/**
 * Working together in a proposal: valbuild/home `docs/proposals.md`, Flow H.
 *
 * A proposal has people, and its AI chats belong to it: everyone on the
 * project can read and continue them, one question at a time. Chats on the
 * site stay personal, and "Work together" there takes the chat into a
 * proposal. Inviting says what a new seat costs, and anyone who cannot add
 * someone asks the owners and the project's developers from the same row.
 *
 * Presentational only: nothing here is wired to the content server yet.
 */
const meta: Meta = {
  title: "Proposals/Work together",
  parameters: { layout: "centered" },
};
export default meta;
type Story = StoryObj;

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

const FREDRIK: ProposalParticipant = {
  id: "p-fredrik",
  name: "Fredrik Ekholdt",
};
const KARI: ProposalParticipant = { id: "p-kari", name: "Kari Andersen" };
const OLA: ProposalParticipant = { id: "p-ola", name: "Ola Nordmann" };
const KARL: ProposalParticipant = { id: "p-karl", name: "Karl Berg" };
const INGRID: ProposalParticipant = { id: "p-ingrid", name: "Ingrid Lie" };

const VIEWER = FREDRIK.id;
const PROPOSAL = "Spring campaign";
const ORG = "blank";
/** The organization's owners and this project's developers: who an editor asks. */
const APPROVERS = [
  "Theodor Carlsen",
  "Mari Holm",
  "Ola Nordmann",
  "Sara Lunde",
];
const PRO_SEAT = { plan: "Pro", cost: "$9 a month" };

/** Everyone the search can find, and where they are. */
const DIRECTORY: InviteCandidate[] = [
  { kind: "project", person: KARI },
  { kind: "project", person: OLA },
  { kind: "org", person: KARL },
  { kind: "org", person: INGRID },
];

const WORKING_ON_IT: {
  person: ProposalParticipant;
  reason: ProposalParticipantReason;
}[] = [
  { person: FREDRIK, reason: { kind: "owner" } },
  { person: OLA, reason: { kind: "invited", by: "Fredrik Ekholdt" } },
  { person: KARI, reason: { kind: "worked" } },
];

function search(query: string): InviteCandidate[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [];
  return DIRECTORY.filter(
    (c) => c.kind !== "email" && c.person.name.toLowerCase().includes(q),
  );
}

// ---------------------------------------------------------------------------
// The invite menu
// ---------------------------------------------------------------------------

/**
 * The menu with its search and its buttons working: Add and Invite succeed
 * after a moment, asking to add someone is recorded, and `failFirst` makes one
 * row fail the first time, so its Try again can be pressed.
 */
function InviteMenuDemo({
  role = "owner",
  initialQuery = "",
  newSeat = PRO_SEAT,
  people = WORKING_ON_IT,
  failFirst,
}: {
  role?: InviteRole;
  initialQuery?: string;
  newSeat?: { plan: string; cost: string | null };
  people?: typeof WORKING_ON_IT;
  failFirst?: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [rows, setRows] = useState<Record<string, InviteRowState>>({});
  const [copied, setCopied] = useState(false);
  const failed = useRef(new Set<string>());
  const settle = (candidate: InviteCandidate, done: InviteRowState) => {
    const key = inviteCandidateKey(candidate);
    setRows((r) => ({ ...r, [key]: { state: "working" } }));
    setTimeout(() => {
      if (key === failFirst && !failed.current.has(key)) {
        failed.current.add(key);
        setRows((r) => ({
          ...r,
          [key]: {
            state: "failed",
            error: "Val Build could not be reached. Nobody was added.",
          },
        }));
        return;
      }
      setRows((r) => ({ ...r, [key]: done }));
    }, 700);
  };
  return (
    <Panel>
      <ProposalInviteMenu
        proposalName={PROPOSAL}
        org={ORG}
        role={role}
        approvers={APPROVERS}
        newSeat={newSeat}
        query={query}
        onQueryChange={setQuery}
        candidates={search(query)}
        rows={rows}
        people={people}
        viewerId={VIEWER}
        onAdd={(c) => settle(c, { state: "added" })}
        onInvite={(email) =>
          settle({ kind: "email", email }, { state: "invited" })
        }
        onAskOwners={(c) => settle(c, { state: "asked", when: "just now" })}
        onCopyLink={() => setCopied(true)}
        linkCopied={copied}
      />
    </Panel>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-border-primary bg-bg-primary text-fg-primary shadow-md">
      {children}
    </div>
  );
}

/**
 * An owner searching. Kari is on the project, so adding her costs nothing
 * and the row says nothing about it; Karl is in the organization but not on
 * this project, so adding him is a seat, and the row says what it costs.
 */
export const InviteAsOwner: Story = {
  render: () => <InviteMenuDemo initialQuery="k" />,
};

/** An address nobody in the organization has: an invitation, and a seat. */
export const InviteByEmailAsOwner: Story = {
  render: () => <InviteMenuDemo initialQuery="nina@example.com" />,
};

/**
 * An editor cannot add someone to the project, so Karl's row asks the
 * owners and the project's developers instead, names them, and still shows the price: they
 * decide on it, and the editor should know what they are asking for.
 */
export const InviteAsEditor: Story = {
  render: () => <InviteMenuDemo role="editor" initialQuery="k" />,
};

/** A developer invites an address too: an invitation, and a seat. */
export const InviteByEmailAsDeveloper: Story = {
  render: () => (
    <InviteMenuDemo role="developer" initialQuery="nina@example.com" />
  ),
};

/** On the Free plan a member costs nothing, and the row says so. */
export const InviteOnTheFreePlan: Story = {
  render: () => (
    <InviteMenuDemo initialQuery="k" newSeat={{ plan: "Free", cost: null }} />
  ),
};

/**
 * Adding Karl fails the first time (press Add), and the row offers Try
 * again, which works.
 */
export const InviteFails: Story = {
  render: () => <InviteMenuDemo initialQuery="karl" failFirst={KARL.id} />,
};

/** Alone in the proposal: the menu says what someone else is for. */
export const AloneInTheProposal: Story = {
  render: () => (
    <InviteMenuDemo people={[{ person: FREDRIK, reason: { kind: "owner" } }]} />
  ),
};

/** Nobody by that name: the way on is an address. */
export const NobodyFound: Story = {
  render: () => <InviteMenuDemo initialQuery="zelda" />,
};

/** Every row state at once: added, asked, failed, and one still working. */
export const RowStates: Story = {
  render: () => {
    const nina: InviteCandidate = { kind: "email", email: "nina@example.com" };
    return (
      <Panel>
        <ProposalInviteMenu
          proposalName={PROPOSAL}
          org={ORG}
          role="editor"
          approvers={APPROVERS}
          newSeat={PRO_SEAT}
          query="…"
          onQueryChange={() => {}}
          candidates={[
            { kind: "project", person: KARI },
            { kind: "org", person: KARL },
            { kind: "org", person: INGRID },
            nina,
          ]}
          rows={{
            [KARI.id]: { state: "added" },
            [KARL.id]: { state: "asked", when: "2 h ago" },
            [INGRID.id]: { state: "working" },
            [inviteCandidateKey(nina)]: {
              state: "failed",
              error: "Val Build could not be reached. Nobody was asked.",
            },
          }}
          people={WORKING_ON_IT}
          viewerId={VIEWER}
          onAdd={() => {}}
          onInvite={() => {}}
          onAskOwners={() => {}}
          onCopyLink={() => {}}
        />
      </Panel>
    );
  },
};

// ---------------------------------------------------------------------------
// The button
// ---------------------------------------------------------------------------

/** In the proposal bar, alone: the moment an invite helps most. */
export const PeopleButtonAlone: Story = {
  render: () => (
    <ProposalPeopleButton
      people={[FREDRIK]}
      viewerId={VIEWER}
      menu={
        <InviteMenuDemo
          people={[{ person: FREDRIK, reason: { kind: "owner" } }]}
        />
      }
    />
  ),
};

/** With people on it, open. */
export const PeopleButtonOpen: Story = {
  render: () => <OpenPeopleButton />,
};

function OpenPeopleButton() {
  const [open, setOpen] = useState(true);
  return (
    <div className="h-[480px] w-[420px] flex justify-end items-start">
      <ProposalPeopleButton
        people={[FREDRIK, OLA, KARI, KARL, INGRID]}
        viewerId={VIEWER}
        open={open}
        onOpenChange={setOpen}
        menu={<InviteMenuDemo initialQuery="k" />}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// From the site
// ---------------------------------------------------------------------------

/**
 * A chat on the site, offering to take it into a proposal. It made changes
 * on the site, and they can come along.
 */
export const WorkTogetherWithChanges: Story = {
  render: () => (
    <Panel>
      <WorkTogetherOffer
        defaultName="Spring pages"
        changes={6}
        onOpen={(o) => console.log("Open proposal", o)}
      />
    </Panel>
  ),
};

/** A chat that has only talked: there is nothing to bring along. */
export const WorkTogetherNoChanges: Story = {
  render: () => (
    <Panel>
      <WorkTogetherOffer
        defaultName="Spring pages"
        changes={0}
        onOpen={(o) => console.log("Open proposal", o)}
      />
    </Panel>
  ),
};

export const WorkTogetherOpening: Story = {
  render: () => (
    <Panel>
      <WorkTogetherOffer
        defaultName="Spring pages"
        changes={6}
        state={{ state: "opening" }}
        onOpen={() => {}}
      />
    </Panel>
  ),
};

/** Opening failed: nothing was created, the chat is still here, try again. */
export const WorkTogetherFailed: Story = {
  render: () => (
    <Panel>
      <WorkTogetherOffer
        defaultName="Spring pages"
        changes={6}
        state={{
          state: "failed",
          error:
            "Val Build could not be reached. No proposal was made, and your chat is where it was.",
        }}
        onOpen={(o) => console.log("Open proposal", o)}
      />
    </Panel>
  ),
};

// ---------------------------------------------------------------------------
// The chat
// ---------------------------------------------------------------------------

function ChatFrame({ children }: { children: ReactNode }) {
  return (
    <div className="h-[600px] w-[440px] overflow-hidden rounded-lg border border-border-primary">
      {children}
    </div>
  );
}

const SITE_CHAT: ChatMessage[] = [
  {
    id: "s1",
    role: "user",
    content: "Rewrite the spring landing page with a warmer tone",
    status: "complete",
    author: FREDRIK,
  },
  {
    id: "s2",
    role: "assistant",
    content:
      "Done: I rewrote the heading, the intro and four product blurbs on **/spring**. 6 changes are pending on the site.",
    status: "complete",
  },
];

/**
 * A chat on the site is your own, and has no names on it. "Work together"
 * takes it into a proposal.
 */
export const ChatOnTheSite: Story = {
  render: () => (
    <ChatFrame>
      <AIChat
        isConnected
        authError={false}
        mode="http"
        onNewSession={() => {}}
        onFetchSessions={() => {}}
        initialMessages={SITE_CHAT}
        together={{
          viewerId: VIEWER,
          people: [FREDRIK],
          header: (
            <WorkTogetherButton
              defaultName="Spring pages"
              changes={6}
              onOpen={(o) => console.log("Open proposal", o)}
            />
          ),
        }}
      />
    </ChatFrame>
  ),
};

const PROPOSAL_CHAT: ChatMessage[] = [
  ...SITE_CHAT.slice(0, 1),
  {
    id: "p2",
    role: "assistant",
    content:
      "Done: 6 fields on **/spring**, in the proposal. Nothing on the site has changed.",
    status: "complete",
  },
  {
    id: "p3",
    role: "user",
    content: "Make the hero shorter, it wraps on mobile",
    status: "complete",
    author: KARI,
  },
  {
    id: "p4",
    role: "assistant",
    content:
      "Shortened it to “Spring is here — and so is everything for it.” (44 characters, one line on a phone).",
    status: "complete",
    // As kept by the content server: still there after a reload.
    toolActivities: [
      { toolCallId: "s1", name: "get_source", status: "complete" },
      { toolCallId: "s2", name: "create_patch", status: "complete" },
    ],
  },
];

/** In a proposal: everyone's messages, named, and Invite in the header. */
export const ChatInAProposal: Story = {
  render: () => (
    <ChatFrame>
      <AIChat
        isConnected
        authError={false}
        mode="http"
        onNewSession={() => {}}
        onFetchSessions={() => {}}
        initialMessages={PROPOSAL_CHAT}
        together={{
          viewerId: VIEWER,
          people: [FREDRIK, KARI, OLA],
          header: (
            <ProposalPeopleButton
              people={[FREDRIK, KARI, OLA]}
              viewerId={VIEWER}
              menu={<InviteMenuDemo />}
            />
          ),
        }}
      />
    </ChatFrame>
  ),
};

const KARIS_ANSWER =
  "I'll look at every page in the proposal that shows a price. " +
  "So far: **/spring**, **/products/oat-milk** and **/products/granola** show " +
  "the old price list. I'm updating them to the spring prices now, one field " +
  "at a time, and I'll list what changed when I'm done.";

/**
 * Kari asked something, and the answer is streaming. Write a message while
 * it does: Stop is not yours to press, Send becomes "send when the answer is
 * done", and the strip says what will happen. When Kari's turn ends, yours is
 * sent and answered.
 */
export const SomeoneElseIsAsking: Story = {
  render: () => <SomeoneElseIsAskingDemo />,
};

function SomeoneElseIsAskingDemo() {
  const chatRef = useRef<AIChatHandle>(null);
  const [turnBy, setTurnBy] = useState<ProposalParticipant | null>(KARI);
  const stream = (id: string, text: string, onDone: () => void) => {
    chatRef.current?.startAssistantMessage(id);
    let idx = 0;
    const interval = setInterval(() => {
      const chunk = text.slice(idx, idx + 3);
      if (chunk) {
        chatRef.current?.appendAssistantChunk(id, chunk);
        idx += 3;
      } else {
        chatRef.current?.completeAssistantMessage(id);
        clearInterval(interval);
        onDone();
      }
    }, 60);
    return () => clearInterval(interval);
  };
  useEffect(
    () => stream("karis-turn", KARIS_ANSWER, () => setTurnBy(null)),
    // Once, on mount: Kari's turn is already running when the chat opens.
    [],
  );
  return (
    <ChatFrame>
      <AIChat
        ref={chatRef}
        isConnected
        authError={false}
        mode="http"
        onNewSession={() => {}}
        initialMessages={[
          ...PROPOSAL_CHAT,
          {
            id: "k1",
            role: "user",
            content: "Update the prices to the spring price list",
            status: "complete",
            author: KARI,
          },
        ]}
        onSendMessage={() => {
          setTurnBy(FREDRIK);
          setTimeout(
            () =>
              stream(
                `fredriks-turn-${Date.now()}`,
                "Sure. That one comes after Kari's price change, so I'll use the new prices.",
                () => setTurnBy(null),
              ),
            400,
          );
          return true;
        }}
        together={{
          viewerId: VIEWER,
          people: [FREDRIK, KARI, OLA],
          turnBy,
          header: (
            <ProposalPeopleButton
              people={[FREDRIK, KARI, OLA]}
              viewerId={VIEWER}
              menu={<InviteMenuDemo />}
            />
          ),
        }}
      />
    </ChatFrame>
  );
}

/**
 * Live: Kari asks in the chat Fredrik has open, and he sees it as it happens.
 * Fed by the content server's relay events (`ai_watched`) through
 * `applyWatchedEvent`, the code the Studio runs: her question appears as she
 * sends it, each tool her turn runs is a row, the answer streams in, and
 * "Kari is asking" clears when her turn ends. Write a message meanwhile and it
 * waits for her answer. The rows on the answer before hers are as a reload
 * shows them, from the tool calls the content server keeps.
 */
export const WatchedLive: Story = {
  render: () => <WatchedLiveDemo />,
};

function WatchedLiveDemo() {
  const chatRef = useRef<AIChatHandle>(null);
  const activeId = useRef<string | null>(null);
  const [turnBy, setTurnBy] = useState<ProposalParticipant | null>(null);
  useEffect(() => {
    const started = new Set<string>();
    const people: Record<string, ProposalParticipant> = {
      [KARI.id]: KARI,
      [OLA.id]: OLA,
    };
    const relay = (event: AIWatchedMessage["event"]) =>
      applyWatchedEvent(event, {
        chat: chatRef.current,
        activeId,
        started,
        participantOf: (id) => people[id] ?? { id, name: id },
        setTurnBy,
        turnEnded: () => {},
      });
    const id = "karis-turn";
    const events: AIWatchedMessage["event"][] = [
      {
        type: "ai_turn_started",
        id,
        sessionId: "chat-1",
        authorId: KARI.id,
        message: [
          { type: "text", text: "Update the prices to the spring price list" },
        ],
      },
      ...(["search_content", "create_patch"] as const).flatMap(
        (name, n): AIWatchedMessage["event"][] => [
          {
            type: "ai_tool_activity",
            id,
            toolCallId: `t${n}`,
            name,
            status: "pending",
          },
          {
            type: "ai_tool_activity",
            id,
            toolCallId: `t${n}`,
            name,
            status: "complete",
          },
        ],
      ),
      ...(KARIS_ANSWER.match(/[^]{1,4}/g) ?? []).map(
        (chunk): AIWatchedMessage["event"] => ({
          type: "ai_streaming",
          id,
          chunk,
        }),
      ),
      { type: "ai_response", id, sessionId: "chat-1", response: KARIS_ANSWER },
      { type: "ai_turn_ended", id, sessionId: "chat-1" },
    ];
    let i = 0;
    // Kari asks a moment after the chat opens, then the answer streams.
    const timers: ReturnType<typeof setTimeout>[] = [];
    timers.push(
      setTimeout(() => {
        const interval = setInterval(() => {
          const event = events[i++];
          if (!event) {
            clearInterval(interval);
            return;
          }
          relay(event);
        }, 70);
        timers.push(interval);
      }, 1500),
    );
    return () => timers.forEach((t) => clearInterval(t));
  }, []);
  return (
    <ChatFrame>
      <AIChat
        ref={chatRef}
        isConnected
        authError={false}
        mode="http"
        onNewSession={() => {}}
        initialMessages={PROPOSAL_CHAT}
        onSendMessage={() => true}
        together={{
          viewerId: VIEWER,
          people: [FREDRIK, KARI, OLA],
          turnBy,
          header: (
            <ProposalPeopleButton
              people={[FREDRIK, KARI, OLA]}
              viewerId={VIEWER}
              menu={<InviteMenuDemo />}
            />
          ),
        }}
      />
    </ChatFrame>
  );
}

/**
 * Kari closed her tab while her question was being answered, which stops
 * it. Anyone can ask again: the retry sends the same message in their name.
 */
export const TheAskerLeft: Story = {
  render: () => (
    <ChatFrame>
      <AIChat
        isConnected
        authError={false}
        mode="http"
        onSendMessage={() => true}
        initialMessages={[
          ...PROPOSAL_CHAT,
          {
            id: "k1",
            role: "user",
            content: "Update the prices to the spring price list",
            status: "complete",
            author: KARI,
          },
          {
            id: "k2",
            role: "assistant",
            content: "I'll look at every page that shows a price. So far:",
            status: "error",
            error:
              "Kari left before the answer was done. Ask again to continue it.",
          },
        ]}
        together={{ viewerId: VIEWER, people: [FREDRIK, KARI, OLA] }}
      />
    </ChatFrame>
  ),
};

/** A merged proposal's chats stay with it, and can be read. */
export const MergedProposalChat: Story = {
  render: () => (
    <ChatFrame>
      <AIChat
        isConnected
        authError={false}
        mode="http"
        initialMessages={PROPOSAL_CHAT}
        together={{
          viewerId: VIEWER,
          people: [FREDRIK, KARI, OLA],
          readOnly: {
            message:
              "Spring campaign was published. This chat is kept with it.",
            action: (
              <Button variant="outline" size="sm" className="h-7 text-xs">
                New chat on the site
              </Button>
            ),
          },
        }}
      />
    </ChatFrame>
  ),
};

const PROPOSAL_SESSIONS: AISession[] = [
  {
    id: "c1",
    name: "Spring pages",
    createdAt: "2026-10-27T08:00:00Z",
    updatedAt: "2026-10-27T10:10:00Z",
  },
  {
    id: "c2",
    name: "Alt texts on the gallery",
    createdAt: "2026-10-26T08:00:00Z",
    updatedAt: "2026-10-26T15:00:00Z",
  },
  {
    id: "c3",
    name: "Pricing table",
    createdAt: "2026-10-24T08:00:00Z",
    updatedAt: "2026-10-26T09:00:00Z",
  },
];

/**
 * The chat list in a proposal: its chats, everyone's, with who is in each
 * and which one has a question running. Your own chats on the site are one
 * step away.
 */
export const ProposalChats: Story = {
  render: () => (
    <ChatFrame>
      <AIChat
        isConnected
        authError={false}
        mode="http"
        initialShowSessions
        sessions={PROPOSAL_SESSIONS}
        currentSessionId="c1"
        onFetchSessions={() => {}}
        onNewSession={() => {}}
        onLoadSession={(id) => console.log("Load", id)}
        initialMessages={PROPOSAL_CHAT}
        together={{
          viewerId: VIEWER,
          people: [FREDRIK, KARI, OLA],
          sessionList: {
            title: `Chats in ${PROPOSAL}`,
            people: { c1: [FREDRIK, KARI], c2: [OLA], c3: [FREDRIK] },
            live: ["c1"],
            footer: (
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start rounded-none px-3 text-xs"
              >
                Your chats on the site →
              </Button>
            ),
          },
        }}
      />
    </ChatFrame>
  ),
};
