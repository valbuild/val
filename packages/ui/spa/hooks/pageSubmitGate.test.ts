import type { SubmitApproval } from "@valbuild/shared/internal";
import type { PageInteractRequest } from "../components/shell/canvas/CanvasFrame";
import type { AskUserQuestionItem } from "../components/AIChatToolActivities";
import {
  pageSubmitConfirmationOf,
  pageSubmitQuestions,
  runGatedInteractPage,
} from "./pageSubmitGate";

const approval: SubmitApproval = {
  via: "click",
  page: "/contact",
  label: "Send message",
  method: "POST",
  action: "/api/contact",
};

/**
 * A form in the preview is submitted only once the person allowed it: the
 * page answers `needs-approval` without submitting, the Studio asks in its
 * own words, and an Allow runs the call again, allowed -- the web search
 * gate's mechanism (`webSearchGate.ts`), for another reason to hold a call.
 */
describe("the page submit gate", () => {
  test("asks in the Studio's words, quoting only the page's own", () => {
    const [question] = pageSubmitQuestions(approval);
    expect(question.question).toBe(
      "The assistant wants to submit a form on /contact with its “Send message” button, by clicking. " +
        "It sends a POST to /api/contact on the real site, which may save, send or buy something. Let it?",
    );
    expect(question.options.map((option) => option.label)).toEqual([
      "Allow",
      "Don't allow",
    ]);
  });

  test("holds the call, then runs it again allowed once the person says yes", async () => {
    const asked: PageInteractRequest[] = [];
    const interactPage = (request: PageInteractRequest) => {
      asked.push(request);
      return Promise.resolve(
        request.allowSubmit === true
          ? {
              status: "done" as const,
              navigated: true,
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
                  viewport: {
                    width: 1280,
                    height: 800,
                    scrollY: 0,
                    pageHeight: 800,
                  },
                  outline: [],
                },
                log: [],
              },
            }
          : { status: "needs-approval" as const, approval },
      );
    };
    const questions: AskUserQuestionItem[][] = [];
    const answers: unknown[] = [];
    const deps = (allowSubmit: boolean) => ({
      interactPage,
      allowSubmit,
      ask: (asking: AskUserQuestionItem[]) => void questions.push(asking),
      answer: (answer: { result: unknown; isError: boolean }) =>
        void answers.push(answer),
    });
    const call = { action: "click", selector: "#send" };

    await runGatedInteractPage(call, deps(false));
    // Asked, and nothing answered to the model yet: the call is held.
    expect(questions).toEqual([pageSubmitQuestions(approval)]);
    expect(answers).toEqual([]);

    // The person said yes.
    expect(
      pageSubmitConfirmationOf([
        { question: "", selectedOptions: [0], customAnswer: "" },
      ]),
    ).toEqual({
      allow: true,
    });
    await runGatedInteractPage(call, deps(true));
    expect(asked.map((request) => request.allowSubmit)).toEqual([
      undefined,
      true,
    ]);
    expect(answers).toMatchObject([
      {
        isError: false,
        result: { success: true, url: "/contact/thanks" },
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
          "The person did not allow the form to be submitted, and said: not on production Nothing was sent. Do not submit it another way; say what you would have checked, and let them ask.",
      },
    });
    expect(pageSubmitConfirmationOf(null)).toMatchObject({ allow: false });
  });

  test("refuses the submit when there is no chat to ask in", async () => {
    const answers: unknown[] = [];
    await runGatedInteractPage(
      { action: "press", key: "Enter", selector: "#email" },
      {
        interactPage: () =>
          Promise.resolve({ status: "needs-approval", approval }),
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
  });
});
