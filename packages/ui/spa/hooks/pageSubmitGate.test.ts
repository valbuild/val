import type { PageApproval } from "@valbuild/shared/internal";
import type {
  PageInteractAnswer,
  PageInteractRequest,
} from "../components/shell/canvas/CanvasFrame";
import type { AskUserQuestionItem } from "../components/AIChatToolActivities";
import {
  pageSubmitConfirmationOf,
  pageSubmitQuestions,
  runGatedInteractPage,
} from "./pageSubmitGate";

const approval: PageApproval = {
  hold: "hold-1",
  page: "/contact",
  label: "Send message",
  did: 'clicked <button> "Send message"',
  before: { url: "/contact", title: "Contact" },
  requests: [{ via: "fetch", method: "POST", url: "/api/contact" }],
};

const done: PageInteractAnswer = {
  status: "done",
  navigated: false,
  interaction: {
    did: "sent the 1 request the person allowed",
    before: { url: "/contact" },
    after: { url: "/contact/thanks", title: "Thanks" },
    settled: true,
    waitedMs: 900,
    pendingRequests: 0,
    snapshot: {
      url: "https://site.example/contact/thanks",
      title: "Thanks",
      viewport: { width: 1280, height: 800, scrollY: 0, pageHeight: 800 },
      outline: [],
    },
    log: [],
  },
};

/**
 * What the page tries to send is held for the person (`pageRequestGate.ts`):
 * the Studio asks in its own words, and the answer sends -- or refuses --
 * exactly what was held, rather than doing the action again. The web search
 * gate's mechanism (`webSearchGate.ts`), for another reason to hold a call.
 */
describe("the page submit gate", () => {
  test("asks in the Studio's words, showing what the page really tried", () => {
    const [question] = pageSubmitQuestions({
      ...approval,
      requests: [
        ...approval.requests,
        { via: "beacon", method: "POST", url: "/api/track" },
      ],
    });
    expect(question.question).toBe(
      "The assistant acted on “Send message” on /contact in the preview, and the page tried to send POST /api/contact and 1 more request to the real site, which may save, send or buy something. " +
        "Nothing has been sent yet. Send it?",
    );
    expect(question.options.map((option) => option.label)).toEqual([
      "Allow",
      "Don't allow",
    ]);
  });

  test("holds the call, then sends exactly what was held once the person says yes", async () => {
    const asked: PageInteractRequest[] = [];
    const interactPage = (request: PageInteractRequest) => {
      asked.push(request);
      return Promise.resolve<PageInteractAnswer>(
        request.action.kind === "release"
          ? done
          : { status: "needs-approval", approval },
      );
    };
    const questions: AskUserQuestionItem[][] = [];
    const held: PageApproval[] = [];
    const answers: unknown[] = [];
    const deps = {
      interactPage,
      ask: (asking: AskUserQuestionItem[], holding: PageApproval) => {
        questions.push(asking);
        held.push(holding);
      },
      answer: (answer: { result: unknown; isError: boolean }) =>
        void answers.push(answer),
    };
    const call = { action: "click", selector: "#send" };

    await runGatedInteractPage(call, deps);
    // Asked, and nothing answered to the model yet: the call is held.
    expect(questions).toEqual([pageSubmitQuestions(approval)]);
    expect(answers).toEqual([]);

    // The person said yes: the same call, run as that answer.
    expect(
      pageSubmitConfirmationOf([
        { question: "", selectedOptions: [0], customAnswer: "" },
      ]),
    ).toEqual({ allow: true });
    await runGatedInteractPage(call, {
      ...deps,
      release: { approval: held[0], allow: true },
    });
    expect(asked.map((request) => request.action)).toEqual([
      { kind: "click", selector: "#send" },
      // Not the click again: what the click made the page try.
      { kind: "release", hold: "hold-1", allow: true },
    ]);
    expect(answers).toMatchObject([
      {
        isError: false,
        result: {
          success: true,
          did: 'clicked <button> "Send message"; sent the 1 request the person allowed',
          url: "/contact/thanks",
          changed: { url: { from: "/contact", to: "/contact/thanks" } },
        },
      },
    ]);
  });

  test("tells the model the person said no, and that nothing was sent", () => {
    expect(
      pageSubmitConfirmationOf([
        {
          question: "",
          selectedOptions: [],
          customAnswer: "not on production",
        },
      ]),
    ).toEqual({
      allow: false,
      result: {
        success: false,
        error:
          "The person did not allow what the page tried to send, and said: not on production Nothing was sent. Do not send it another way; say what you would have checked, and let them ask.",
      },
    });
    expect(pageSubmitConfirmationOf(null)).toMatchObject({ allow: false });
  });

  test("refuses what the page held when there is no chat to ask in", async () => {
    const asked: PageInteractRequest[] = [];
    const answers: unknown[] = [];
    await runGatedInteractPage(
      { action: "press", key: "Enter", selector: "#email" },
      {
        interactPage: (request) => {
          asked.push(request);
          return Promise.resolve({ status: "needs-approval", approval });
        },
        ask: null,
        answer: (answer) => void answers.push(answer),
      },
    );
    expect(answers).toMatchObject([
      {
        isError: true,
        result: { error: expect.stringContaining("Nothing was sent") },
      },
    ]);
    expect(asked[1]?.action).toEqual({
      kind: "release",
      hold: "hold-1",
      allow: false,
    });
  });

  test("after Stop, neither asks nor answers, and the page drops what it held", async () => {
    const asked: PageInteractRequest[] = [];
    let stopped = false;
    const ask = jest.fn();
    const answer = jest.fn();
    await runGatedInteractPage(
      { action: "click", selector: "#send" },
      {
        interactPage: (request) => {
          asked.push(request);
          // The person pressed Stop while the page was busy.
          stopped = true;
          return Promise.resolve({ status: "needs-approval", approval });
        },
        isCurrent: () => !stopped,
        ask,
        answer,
      },
    );
    expect(ask).not.toHaveBeenCalled();
    expect(answer).not.toHaveBeenCalled();
    expect(asked[1]?.action).toEqual({
      kind: "release",
      hold: "hold-1",
      allow: false,
    });
  });
});
