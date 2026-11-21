import {
  AUTO_FOLLOW_UPS_PER_MESSAGE,
  checksFollowUpState,
  createChecksFollowUp,
  findingsFingerprint,
  followUpDecision,
  FRESH_FOLLOW_UPS,
  isChecksMessage,
  NO_FOLLOW_UPS,
  resetChecksFollowUp,
  type CheckFinding,
} from "./checksFollowUp";
import { resetBackgroundLint, runLint } from "./backgroundLint";
import { pageCheckReported, resetPageCheck } from "./pageCheck";
import { stagedInputsOf } from "./backgroundChecks";
import { resetProposalTypecheck } from "./useProposalTypecheck";
import type { ProposalJson } from "./proposalsClient";

jest.mock("../components/ValProvider", () => ({
  useCurrentProposal: () => null,
}));

const NAME = "0123456789abcdef0123";
const FIRST = "a".repeat(64);
const SECOND = "b".repeat(64);
const THIRD = "c".repeat(64);
const MODULES = `export default modules(config, [
  { def: () => import("./src/content/home.val") },
]);`;
const WRONG_PATH = (path: string) => `import { c, s } from "../../val.config";
export default c.define("${path}", s.string(), "Hello");`;

const failing = (key: string, value: unknown): CheckFinding => ({
  key,
  value,
  failing: true,
});

describe("whether a follow-up starts", () => {
  test("only for findings that ask for a fix", () => {
    expect(
      followUpDecision(FRESH_FOLLOW_UPS, [
        { key: "page_check", value: { status: "pass" }, failing: false },
      ]),
    ).toEqual({
      action: "stop",
      reason: "nothing-failing",
      budget: FRESH_FOLLOW_UPS,
    });
  });

  test(`${AUTO_FOLLOW_UPS_PER_MESSAGE} per message from the person, then it stops`, () => {
    let budget = FRESH_FOLLOW_UPS;
    for (let attempt = 1; attempt <= AUTO_FOLLOW_UPS_PER_MESSAGE; attempt++) {
      const decision = followUpDecision(budget, [
        failing("lint_problems", { problems: [attempt] }),
      ]);
      expect(decision).toMatchObject({ action: "start", attempt });
      if (decision.action !== "start") return;
      budget = decision.budget;
    }
    expect(
      followUpDecision(budget, [failing("lint_problems", { problems: [9] })]),
    ).toMatchObject({ action: "stop", reason: "budget" });
  });

  test("without a message from the person, none: a reload, or another tab", () => {
    expect(
      followUpDecision(NO_FOLLOW_UPS, [failing("typecheck_errors", {})]),
    ).toMatchObject({ action: "stop", reason: "budget" });
  });

  test("the same findings after a fix stop it, budget or not", () => {
    const findings = [failing("typecheck_errors", { errors: ["x"] })];
    const first = followUpDecision(FRESH_FOLLOW_UPS, findings);
    if (first.action !== "start") throw new Error("expected a start");
    expect(followUpDecision(first.budget, findings)).toMatchObject({
      action: "stop",
      reason: "no-progress",
    });
  });

  test("the same findings are the same in any order, and whatever we hinted", () => {
    expect(
      findingsFingerprint([
        failing("lint_problems", { problems: [1], next: "Fix them." }),
        failing("typecheck_errors", { errors: [2] }),
      ]),
    ).toBe(
      findingsFingerprint([
        failing("typecheck_errors", { errors: [2] }),
        failing("lint_problems", { next: "Fix these.", problems: [1] }),
      ]),
    );
  });
});

describe("the follow-ups, with the checks' own findings", () => {
  let staged = FIRST;
  let idle = true;
  let accepts = true;
  const sent: string[] = [];
  const proposal = (): ProposalJson => ({
    name: NAME,
    branch: `val/p/${NAME}`,
    displayName: "Spring",
    status: "open",
    updatedAt: "2026-11-21T10:00:00.000Z",
    built: null,
    staged: { files: [], inputs: staged, buildRequired: false },
  });
  const client = { get: async () => proposal() };
  const followUps = () =>
    createChecksFollowUp({
      proposalName: () => NAME,
      idle: () => idle,
      stagedInputs: (name) => stagedInputsOf(client, name),
      send: (text) => {
        if (!accepts) return false;
        sent.push(text);
        return true;
      },
    });
  /** Val's lint rules over a module whose path is not its own, as staged as `inputs`. */
  const lintFinds = async (inputs: string, path: string) => {
    staged = inputs;
    await runLint(NAME, {
      siteSource: async () => ({}),
      client: {
        files: async () => ({
          files: {
            "val.modules.ts": MODULES,
            "src/content/home.val.ts": WRONG_PATH(path),
          },
          staged: {
            files: ["val.modules.ts", "src/content/home.val.ts"],
            inputs,
            buildRequired: false,
          },
        }),
      },
    });
  };

  beforeEach(() => {
    resetBackgroundLint();
    resetPageCheck();
    resetProposalTypecheck();
    resetChecksFollowUp();
    staged = FIRST;
    idle = true;
    accepts = true;
    sent.length = 0;
  });

  test("a problem found while the assistant is idle goes to it in a turn of its own, as the Studio's message", async () => {
    const followUp = followUps();
    followUp.personWrote();
    await lintFinds(FIRST, "/src/content/start.val.ts");
    await followUp.consider();
    expect(sent).toHaveLength(1);
    expect(isChecksMessage(sent[0] ?? "")).toBe(true);
    expect(sent[0]).toContain("no-illegal-module-paths");
    expect(checksFollowUpState()).toEqual({
      status: "fixing",
      attempt: 1,
      of: AUTO_FOLLOW_UPS_PER_MESSAGE,
    });
    // Told: considered again, nothing more is sent.
    await followUp.consider();
    expect(sent).toHaveLength(1);
  });

  test("while a turn runs, nothing is started: the assistant hears on a tool answer", async () => {
    const followUp = followUps();
    followUp.personWrote();
    idle = false;
    await lintFinds(FIRST, "/src/content/start.val.ts");
    await followUp.consider();
    expect(sent).toEqual([]);
  });

  test("a fix that changes nothing the checks find stops the follow-ups, and leaves the findings for the person", async () => {
    const followUp = followUps();
    followUp.personWrote();
    await lintFinds(FIRST, "/src/content/start.val.ts");
    await followUp.consider();
    // The assistant staged again, and the rules find the same.
    await lintFinds(SECOND, "/src/content/start.val.ts");
    await followUp.consider();
    expect(sent).toHaveLength(1);
    expect(checksFollowUpState()).toMatchObject({
      status: "stopped",
      reason: "no-progress",
      attempts: 1,
      findings: [{ key: "lint_problems", failing: true }],
    });
  });

  test(`after ${AUTO_FOLLOW_UPS_PER_MESSAGE} follow-ups, only the person writing starts another`, async () => {
    const followUp = followUps();
    followUp.personWrote();
    await lintFinds(FIRST, "/src/content/one.val.ts");
    await followUp.consider();
    await lintFinds(SECOND, "/src/content/two.val.ts");
    await followUp.consider();
    await lintFinds(THIRD, "/src/content/three.val.ts");
    await followUp.consider();
    expect(sent).toHaveLength(AUTO_FOLLOW_UPS_PER_MESSAGE);
    expect(checksFollowUpState()).toMatchObject({
      status: "stopped",
      reason: "budget",
      attempts: AUTO_FOLLOW_UPS_PER_MESSAGE,
    });

    // "Fix it": the person writes, and what is left goes with it.
    followUp.personWrote();
    const ride = followUp.rideAlong(NAME);
    expect(ride?.text).toContain("<background_checks>");
    expect(ride?.text).toContain("three.val.ts");
    ride?.sent();
    expect(followUp.rideAlong(NAME)).toBeNull();
  });

  test("with a message waiting in the queue, nothing is sent or told: the findings go with that message", async () => {
    const followUp = followUps();
    followUp.personWrote();
    accepts = false;
    await lintFinds(FIRST, "/src/content/start.val.ts");
    await followUp.consider();
    expect(sent).toEqual([]);
    expect(followUp.rideAlong(NAME)?.text).toContain("no-illegal-module-paths");
  });

  test("a page check that passed shows, and starts nothing", async () => {
    const followUp = followUps();
    followUp.personWrote();
    pageCheckReported(NAME, FIRST, {
      status: "pass",
      summary: "The heading reads Spring.",
      findings: [],
    });
    await followUp.consider();
    expect(sent).toEqual([]);
    expect(checksFollowUpState()).toEqual({ status: "idle" });
  });

  test("a failed page check is a finding like any other", async () => {
    const followUp = followUps();
    followUp.personWrote();
    pageCheckReported(NAME, FIRST, {
      status: "fail",
      summary: "The heading is the old colour.",
      findings: [{ message: "h1 is black", where: "main h1" }],
    });
    await followUp.consider();
    expect(sent[0]).toContain("The heading is the old colour.");
  });
});
