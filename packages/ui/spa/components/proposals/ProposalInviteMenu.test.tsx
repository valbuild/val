/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import {
  ProposalInviteMenu,
  inviteActionFor,
  type InviteCandidate,
  type InviteRole,
} from "./ProposalInviteMenu";

/**
 * Who may add whom: valbuild/home `docs/proposals.md`, Flow H. Owners and
 * developers add and invite, and editors ask them from the same row.
 */

const KARI = { id: "p-kari", name: "Kari Andersen" };
const KARL = { id: "p-karl", name: "Karl Berg" };

const project: InviteCandidate = { kind: "project", person: KARI };
const org: InviteCandidate = { kind: "org", person: KARL };
const email: InviteCandidate = { kind: "email", email: "nina@example.com" };

test.each<[InviteRole, string, string, string]>([
  ["owner", "add", "add", "invite"],
  ["developer", "add", "add", "invite"],
  ["editor", "add", "ask", "ask"],
])(
  "%s: on the project %s, in the org %s, an address %s",
  (role, onProject, inOrg, byEmail) => {
    expect(inviteActionFor(project, role)).toBe(onProject);
    expect(inviteActionFor(org, role)).toBe(inOrg);
    expect(inviteActionFor(email, role)).toBe(byEmail);
  },
);

function renderMenu(
  role: InviteRole,
  query: string,
  candidates: InviteCandidate[],
) {
  render(
    <ProposalInviteMenu
      proposalName="Spring campaign"
      org="blank"
      role={role}
      approvers={["Theodor Carlsen", "Mari Holm", "Ola Nordmann"]}
      newSeat={{ plan: "Pro", cost: "$9 a month" }}
      query={query}
      onQueryChange={() => {}}
      candidates={candidates}
      people={[]}
      viewerId="p-fredrik"
      onAdd={() => {}}
      onInvite={() => {}}
      onAskOwners={() => {}}
      onCopyLink={() => {}}
    />,
  );
}

test("a seat is priced on the row that adds it, and only there", () => {
  renderMenu("owner", "ka", [project, org]);
  const seatLines = screen.getAllByText(/A new seat/);
  expect(seatLines).toHaveLength(1);
  expect(seatLines[0].textContent).toBe(
    "A new seat: $9 a month on the Pro plan",
  );
});

test("an editor asking to add someone is told who decides", () => {
  renderMenu("editor", "karl", [org]);
  expect(
    screen.getByRole("button", { name: "Ask to add: Karl Berg" }),
  ).toBeTruthy();
  expect(
    screen.getByText(/Theodor Carlsen, Mari Holm and 1 other can add people/),
  ).toBeTruthy();
});

test("a typed address nobody has is offered as an invitation", () => {
  renderMenu("owner", "nina@example.com", []);
  expect(
    screen.getByRole("button", { name: "Invite: nina@example.com" }),
  ).toBeTruthy();
});
