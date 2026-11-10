import {
  needsWebSearchConfirmation,
  webSearchConfirmationOf,
  webSearchConfirmationQuestions,
  withWebSearchWaits,
} from "./webSearchGate";
import { CODE_TOOLS } from "../proposals/proposalCode";

describe("the web search gate", () => {
  test("code tools wait only in a turn that searched", () => {
    expect(needsWebSearchConfirmation("write_files", true)).toBe(true);
    expect(needsWebSearchConfirmation("build_proposal", true)).toBe(true);
    expect(needsWebSearchConfirmation("write_files", false)).toBe(false);
  });

  test("reading and content edits never wait", () => {
    expect(needsWebSearchConfirmation("read_file", true)).toBe(false);
    expect(needsWebSearchConfirmation("create_patch", true)).toBe(false);
    expect(needsWebSearchConfirmation("request_code_mode", true)).toBe(false);
  });

  test("the first option allows it", () => {
    expect(
      webSearchConfirmationOf([
        { question: "q", selectedOptions: [0], customAnswer: null },
      ]),
    ).toEqual({ allow: true });
  });

  test("the second option, a typed answer or a closed card do not", () => {
    for (const answers of [
      [{ question: "q", selectedOptions: [1], customAnswer: null }],
      [{ question: "q", selectedOptions: [], customAnswer: "yes do it" }],
      null,
    ]) {
      expect(webSearchConfirmationOf(answers).allow).toBe(false);
    }
  });

  test("what the person typed is passed on to the model", () => {
    const confirmation = webSearchConfirmationOf([
      { question: "q", selectedOptions: [], customAnswer: "only the footer" },
    ]);
    expect(confirmation).toMatchObject({
      allow: false,
      result: { error: expect.stringContaining("only the footer") },
    });
  });

  test("the question names what the tool would do, and offers allow first", () => {
    const [build] = webSearchConfirmationQuestions("build_proposal");
    const [write] = webSearchConfirmationQuestions("write_files");
    expect(build.question).toContain("build the site");
    expect(write.question).toContain("change the site's code");
    expect(write.options[0].label).toBe("Allow");
  });
});

describe("withWebSearchWaits", () => {
  test("with search on, the gated tools wait as long as a question does", () => {
    const tools = withWebSearchWaits(CODE_TOOLS, true);
    for (const name of ["write_files", "build_proposal"]) {
      expect(tools.find((tool) => tool.name === name)?.timeoutMs).toBeNull();
    }
    const readFile = CODE_TOOLS.find((tool) => tool.name === "read_file");
    expect(tools.find((tool) => tool.name === "read_file")).toBe(readFile);
  });

  test("with search off, the tools are sent as they are", () => {
    expect(withWebSearchWaits(CODE_TOOLS, false)).toBe(CODE_TOOLS);
  });
});
