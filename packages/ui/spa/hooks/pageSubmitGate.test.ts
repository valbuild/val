import type {
  ActionApproval,
  RequestsApproval,
} from "@valbuild/shared/internal";
import type {
  PageInteractAnswer,
  PageInteractRequest,
} from "../components/shell/canvas/CanvasFrame";
import type { AskUserQuestionItem } from "../components/AIChatToolActivities";
import {
  pageSubmitConfirmationOf,
  pageSubmitQuestions,
  runGatedInteractPage,
  type GatedInteractDeps,
} from "./pageSubmitGate";

const click: ActionApproval = {
  kind: "action",
  fingerprint: "fp-1",
  action: "click",
  page: "/contact",
  label: "Send message",
  role: "button",
  tag: "button",
  before: { url: "/contact", title: "Contact" },
};

const held: RequestsApproval = {
  kind: "requests",
  hold: "hold-1",
  page: "/contact",
  label: "email",
  did: 'typed 3 characters into <input name="email">',
  before: { url: "/contact", title: "Contact" },
  requests: [
    {
      via: "fetch",
      method: "POST",
      url: "/api/draft",
      body: '{"email":"ada"}',
    },
  ],
};

const done: PageInteractAnswer = {
  status: "done",
  navigated: false,
  interaction: {
    did: 'clicked <button> "Send message"',
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
 * Every click and Enter/Space in the preview is asked about before it
 * reaches the page, and what the other actions make the page send is held
 * for the person. The web search gate's mechanism (`webSearchGate.ts`): the
 * call is held, the Studio asks in its own words, and the answer runs the
 * call again AS that answer -- which only the Studio can give.
 */
describe("the page gate", () => {
  /** A chat around `runGatedInteractPage`, recording what it is asked. */
  function chat(
    interactPage: (request: PageInteractRequest) => Promise<PageInteractAnswer>,
  ) {
    const asked: PageInteractRequest[] = [];
    const questions: AskUserQuestionItem[][] = [];
    const answers: Array<{ result: unknown; isError: boolean }> = [];
    const deps: GatedInteractDeps = {
      interactPage: (request) => {
        asked.push(request);
        return interactPage(request);
      },
      ask: (asking) => void questions.push(asking),
      answer: (answer) => void answers.push(answer),
    };
    return { asked, questions, answers, deps };
  }

  test("asks before a click, in the Studio's words, quoting the page's", () => {
    const [question] = pageSubmitQuestions(click);
    expect(question.question).toBe(
      "The assistant wants to click the button “Send message” on /contact in the preview. " +
        "This is the real site: a click can save, send, buy or delete something. Let it?",
    );
    expect(question.options.map((option) => option.label)).toEqual([
      "Allow",
      "Don't allow",
    ]);
    expect(
      pageSubmitQuestions({ ...click, action: "press", key: "Enter" })[0]
        .question,
    ).toContain("wants to press Enter on the button");
  });

  test("says when Enter submits the form, and that only the element is checked", () => {
    const enter: ActionApproval = {
      ...click,
      action: "press",
      key: "Enter",
      role: "text field",
      label: "Email",
      submits: "Subscribe",
    };
    const [question] = pageSubmitQuestions(enter);
    expect(question.question).toBe(
      "The assistant wants to press Enter in the text field \u201cEmail\u201d, which submits its form (\u201cSubscribe\u201d) on /contact in the preview. " +
        "This is the real site: a click can save, send, buy or delete something. Let it?",
    );
    expect(question.options[0].description).toBe(
      "Exactly this, once, on this element. If the element changed meanwhile, you are asked again.",
    );
  });

  test("shows every held request, with what it sends", () => {
    expect(pageSubmitQuestions(held)[0].question).toBe(
      "While the assistant acted on “email” on /contact in the preview, the page tried to send this request to the real site, which may save, send or buy something: " +
        'POST /api/draft “{"email":"ada"}”. Nothing has been sent yet. Send it?',
    );
  });

  test("after Allow, runs the click on the element the person was shown, and nowhere else", async () => {
    const { asked, questions, answers, deps } = chat((request) =>
      Promise.resolve(
        request.approved === "fp-1"
          ? done
          : { status: "needs-approval", approval: click },
      ),
    );
    const call = { action: "click", selector: "#send" };
    await runGatedInteractPage(call, deps);
    expect(questions).toEqual([pageSubmitQuestions(click)]);
    expect(answers).toEqual([]);

    await runGatedInteractPage(call, {
      ...deps,
      answered: { approval: click, allow: true },
    });
    expect(asked).toEqual([
      { action: { kind: "click", selector: "#send" } },
      { action: { kind: "click", selector: "#send" }, approved: "fp-1" },
    ]);
    expect(answers).toMatchObject([
      { isError: false, result: { success: true, url: "/contact/thanks" } },
    ]);
  });

  test("the model can never give the approval itself", async () => {
    const { asked, questions, deps } = chat(() =>
      Promise.resolve({ status: "needs-approval", approval: click }),
    );
    await runGatedInteractPage(
      {
        action: "click",
        selector: "#send",
        approved: "fp-1",
        fingerprint: "fp-1",
        answered: { approval: click, allow: true },
      },
      deps,
    );
    expect(asked).toEqual([{ action: { kind: "click", selector: "#send" } }]);
    expect(questions).toHaveLength(1);
  });

  test("after Allow on held requests, sends exactly those", async () => {
    const { asked, answers, deps } = chat((request) =>
      Promise.resolve(
        request.action.kind === "release"
          ? done
          : { status: "needs-approval", approval: held },
      ),
    );
    await runGatedInteractPage(
      { action: "type", selector: "#email", text: "ada" },
      { ...deps, answered: { approval: held, allow: true } },
    );
    expect(asked).toEqual([
      { action: { kind: "release", hold: "hold-1", allow: true } },
    ]);
    expect(answers).toMatchObject([
      {
        result: {
          did: 'typed 3 characters into <input name="email">; clicked <button> "Send message"',
        },
      },
    ]);
  });

  test("tells the model the person said no, and that nothing was done", () => {
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
          "The person did not allow it, and said: not on production Nothing was done or sent. Do not do it another way; say what you would have checked, and let them ask.",
      },
    });
    expect(pageSubmitConfirmationOf(null)).toMatchObject({ allow: false });
    expect(
      pageSubmitConfirmationOf([
        { question: "", selectedOptions: [0], customAnswer: "" },
      ]),
    ).toEqual({ allow: true });
  });

  test("refuses what the page held when there is no chat to ask in", async () => {
    const { asked, answers, deps } = chat((request) =>
      Promise.resolve(
        request.action.kind === "release"
          ? done
          : { status: "needs-approval", approval: held },
      ),
    );
    await runGatedInteractPage(
      { action: "type", selector: "#email", text: "ada" },
      { ...deps, ask: null },
    );
    expect(answers).toMatchObject([
      {
        isError: true,
        result: { error: expect.stringContaining("Nothing was done or sent") },
      },
    ]);
    expect(asked[1]?.action).toEqual({
      kind: "release",
      hold: "hold-1",
      allow: false,
    });
  });

  test("after Stop, neither asks nor answers, and the page drops what it held", async () => {
    let stopped = false;
    const { asked, questions, answers, deps } = chat((request) => {
      // The person pressed Stop while the page was busy.
      stopped = true;
      return Promise.resolve(
        request.action.kind === "release"
          ? done
          : { status: "needs-approval", approval: held },
      );
    });
    await runGatedInteractPage(
      { action: "type", selector: "#email", text: "ada" },
      { ...deps, isCurrent: () => !stopped },
    );
    expect(questions).toEqual([]);
    expect(answers).toEqual([]);
    expect(asked[1]?.action).toEqual({
      kind: "release",
      hold: "hold-1",
      allow: false,
    });
  });
});
