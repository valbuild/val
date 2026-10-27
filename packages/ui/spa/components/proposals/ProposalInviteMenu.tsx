import { AlertTriangle, Check, Link, Mail, Search } from "lucide-react";
import { useId } from "react";
import { Avatar } from "../Avatar";
import { Button } from "../designSystem/button";
import { cn } from "../designSystem/cn";
import { Spinner } from "../designSystem/spinner";
import type { ProposalParticipant, ProposalParticipantReason } from "./types";

/**
 * Someone the person inviting could bring in, as the search found them.
 *
 * Which of the three decides what bringing them in takes: someone on the
 * project only joins the proposal, someone in the organization joins the
 * project too (a seat), and an email address is an invitation to the
 * organization (a seat as well).
 */
export type InviteCandidate =
  | { kind: "project"; person: ProposalParticipant }
  | { kind: "org"; person: ProposalParticipant }
  | { kind: "email"; email: string };

/** What happened to a row after its button was pressed. */
export type InviteRowState =
  | { state: "working" }
  | { state: "added" }
  | { state: "invited" }
  /** `when` as it should read: "just now", "2 h ago". */
  | { state: "asked"; when: string }
  | { state: "failed"; error: string };

/**
 * Who may add whom. Owners and developers choose a project's members and
 * invite new people to the organization from a proposal (Flow H made the
 * second theirs too: before it, only owners invited). Editors ask the owners,
 * from the same row.
 */
export type InviteRole = "owner" | "developer" | "editor";

export type InviteAction = "add" | "invite" | "ask";

export function inviteActionFor(
  candidate: InviteCandidate,
  role: InviteRole,
): InviteAction {
  switch (candidate.kind) {
    case "project":
      return "add";
    case "org":
      return role === "editor" ? "ask" : "add";
    case "email":
      return role === "editor" ? "ask" : "invite";
  }
}

export function inviteCandidateKey(candidate: InviteCandidate): string {
  return candidate.kind === "email"
    ? `email:${candidate.email.toLowerCase()}`
    : candidate.person.id;
}

/** Loose on purpose: the server decides what an address is. */
export function looksLikeEmail(query: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(query.trim());
}

/**
 * Invite people to a proposal. valbuild/home `docs/proposals.md`, Flow H.
 *
 * Presentational: the search, the adding and the asking are the caller's. The
 * one thing decided here is what each row offers, from `inviteActionFor`, so
 * that nobody meets a dead end: a row that the viewer cannot act on asks the
 * owners instead, and says who they are.
 *
 * A row that adds someone to the PROJECT says what the seat costs, right on
 * the row: bringing in a colleague is what we want people to do, and a bill
 * that grew without anyone saying so is the fastest way to make them stop.
 */
export function ProposalInviteMenu({
  proposalName,
  org,
  role,
  owners,
  newSeat,
  query,
  onQueryChange,
  candidates,
  rows = {},
  people,
  viewerId,
  onAdd,
  onInvite,
  onAskOwners,
  onCopyLink,
  linkCopied = false,
  className,
}: {
  /** What people call the proposal. */
  proposalName: string;
  /** The organization's name, for "not in {org} yet". */
  org: string;
  role: InviteRole;
  /** The organization's owners, by name: who an "ask" goes to. */
  owners: string[];
  /**
   * What adding someone to the project costs on its plan. `cost: null` is a
   * plan where members are free.
   */
  newSeat: { plan: string; cost: string | null };
  query: string;
  onQueryChange: (query: string) => void;
  /** What the search found for `query`. An address is offered on its own. */
  candidates: InviteCandidate[];
  /** By `inviteCandidateKey`. */
  rows?: Record<string, InviteRowState>;
  /** Who is working on it already: `val_proposal_people`. */
  people: { person: ProposalParticipant; reason: ProposalParticipantReason }[];
  viewerId: string;
  onAdd: (candidate: InviteCandidate) => void;
  onInvite: (email: string) => void;
  onAskOwners: (candidate: InviteCandidate) => void;
  onCopyLink: () => void;
  linkCopied?: boolean;
  className?: string;
}) {
  const inputId = useId();
  const offered = withTypedAddress(candidates, query);
  const run = (candidate: InviteCandidate) => {
    const action = inviteActionFor(candidate, role);
    if (action === "ask") onAskOwners(candidate);
    else if (action === "invite" && candidate.kind === "email")
      onInvite(candidate.email);
    else onAdd(candidate);
  };
  return (
    <div
      className={cn("flex w-[22rem] max-w-full flex-col text-sm", className)}
    >
      <div className="border-b border-border-primary p-3">
        <label
          htmlFor={inputId}
          className="mb-1.5 block text-xs font-medium text-fg-primary"
        >
          Invite to {proposalName}
        </label>
        <div className="flex items-center gap-2 rounded-md border border-border-primary px-2 focus-within:ring-2 focus-within:ring-border-focus">
          <Search className="h-3.5 w-3.5 shrink-0 text-fg-secondary" />
          <input
            id={inputId}
            autoFocus
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Name or email"
            className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-fg-secondary-alt"
          />
        </div>
      </div>

      {query.trim() !== "" && (
        <div className="max-h-64 overflow-y-auto border-b border-border-primary py-1">
          {offered.length === 0 ? (
            <p className="px-3 py-3 text-xs text-fg-secondary">
              Nobody in {org} is called that. Type their email address to invite
              them.
            </p>
          ) : (
            offered.map((candidate) => {
              const key = inviteCandidateKey(candidate);
              return (
                <CandidateRow
                  key={key}
                  candidate={candidate}
                  action={inviteActionFor(candidate, role)}
                  state={rows[key]}
                  org={org}
                  owners={owners}
                  newSeat={newSeat}
                  onRun={() => run(candidate)}
                />
              );
            })
          )}
        </div>
      )}

      <div className="px-3 pb-1 pt-3">
        <p className="mb-1 text-xs font-medium text-fg-secondary">
          Working on this
        </p>
        <ul className="flex flex-col">
          {people.map(({ person, reason }) => (
            <li key={person.id} className="flex items-center gap-2 py-1">
              <Avatar
                name={person.name}
                imageUrl={person.avatarUrl}
                size="xs"
              />
              <span className="min-w-0 flex-1 truncate">
                {person.name}
                {person.id === viewerId && (
                  <span className="text-fg-secondary"> (you)</span>
                )}
              </span>
              <span className="shrink-0 text-xs text-fg-secondary">
                {reasonText(reason)}
              </span>
            </li>
          ))}
        </ul>
        {people.length === 1 && (
          <p className="mt-1 text-xs text-fg-secondary">
            Only you so far. Someone else can check the changes before they are
            published.
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-border-primary px-3 py-2">
        <span className="min-w-0 flex-1 text-xs text-fg-secondary">
          Anyone on the project can open it.
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={onCopyLink}
          className="h-7 gap-1 px-2 text-xs"
        >
          {linkCopied ? (
            <Check className="h-3 w-3" />
          ) : (
            <Link className="h-3 w-3" />
          )}
          {linkCopied ? "Copied" : "Copy link"}
        </Button>
      </div>
    </div>
  );
}

/**
 * The search's answers, and the typed address when it is one nobody has: a
 * person already found by that email is not offered a second time.
 */
function withTypedAddress(
  candidates: InviteCandidate[],
  query: string,
): InviteCandidate[] {
  if (!looksLikeEmail(query)) return candidates;
  const email = query.trim();
  const key = inviteCandidateKey({ kind: "email", email });
  if (candidates.some((c) => inviteCandidateKey(c) === key)) return candidates;
  return [...candidates, { kind: "email", email }];
}

function reasonText(reason: ProposalParticipantReason): string {
  switch (reason.kind) {
    case "owner":
      return "started it";
    case "invited":
      return `invited by ${reason.by}`;
    case "worked":
      return "worked on it";
  }
}

function CandidateRow({
  candidate,
  action,
  state,
  org,
  owners,
  newSeat,
  onRun,
}: {
  candidate: InviteCandidate;
  action: InviteAction;
  state: InviteRowState | undefined;
  org: string;
  owners: string[];
  newSeat: { plan: string; cost: string | null };
  onRun: () => void;
}) {
  const name =
    candidate.kind === "email" ? candidate.email : candidate.person.name;
  const where =
    candidate.kind === "project"
      ? "On this project"
      : candidate.kind === "org"
        ? `In ${org}, not on this project`
        : `Not in ${org} yet`;
  // Joining the proposal alone costs nothing; joining the project is a seat.
  const seat =
    candidate.kind === "project"
      ? null
      : newSeat.cost === null
        ? `Free on the ${newSeat.plan} plan`
        : `A new seat: ${newSeat.cost} on the ${newSeat.plan} plan`;
  return (
    <div className="flex items-start gap-2 px-3 py-2">
      {candidate.kind === "email" ? (
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-bg-secondary text-fg-secondary">
          <Mail className="h-3 w-3" />
        </span>
      ) : (
        <Avatar
          name={candidate.person.name}
          imageUrl={candidate.person.avatarUrl}
          size="xs"
        />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{name}</p>
        <p className="text-xs text-fg-secondary">{where}</p>
        {seat && <p className="text-xs text-fg-secondary">{seat}</p>}
        {action === "ask" && state?.state !== "asked" && (
          <p className="text-xs text-fg-secondary">
            {listNames(owners)} can add people to this project. We email them
            your request.
          </p>
        )}
        {state?.state === "asked" && (
          <p className="text-xs text-fg-secondary">
            Asked {listNames(owners)} · {state.when}
          </p>
        )}
        {state?.state === "failed" && (
          <p className="mt-0.5 flex items-start gap-1 text-xs text-fg-error-primary">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            {state.error}
          </p>
        )}
      </div>
      <RowButton action={action} state={state} name={name} onRun={onRun} />
    </div>
  );
}

function RowButton({
  action,
  state,
  name,
  onRun,
}: {
  action: InviteAction;
  state: InviteRowState | undefined;
  name: string;
  onRun: () => void;
}) {
  if (state?.state === "added" || state?.state === "invited") {
    return (
      <span className="flex shrink-0 items-center gap-1 pt-0.5 text-xs text-fg-secondary">
        <Check className="h-3 w-3" />
        {state.state === "added" ? "Added" : "Email sent"}
      </span>
    );
  }
  // One open request per person asked about: there is nothing to press again.
  if (state?.state === "asked") return null;
  const label =
    state?.state === "failed"
      ? "Try again"
      : action === "ask"
        ? "Ask the owners"
        : action === "invite"
          ? "Invite"
          : "Add";
  const working = state?.state === "working";
  return (
    <Button
      variant={action === "ask" ? "secondary" : "default"}
      size="sm"
      disabled={working}
      onClick={onRun}
      aria-label={`${label}: ${name}`}
      className="h-7 shrink-0 gap-1 px-2 text-xs"
    >
      {working && <Spinner size={12} />}
      {label}
    </Button>
  );
}

function listNames(names: string[]): string {
  if (names.length === 0) return "The organization's owners";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
