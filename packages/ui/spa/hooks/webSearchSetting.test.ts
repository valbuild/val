import type { Json } from "@valbuild/core";
import { applyPatch, JSONOps, type JSONValue } from "@valbuild/core/patch";
import { result } from "@valbuild/core/fp";
import {
  changesWebSearchSetting,
  patchChangesWebSearchSetting,
  readWebSearchSetting,
  REQUEST_WEB_SEARCH_TOOL,
  webSearchRequestOutcome,
  webSearchRequestPromptSection,
  webSearchRequestQuestions,
  webSearchSettingOps,
  withWebSearchRequest,
} from "./webSearchSetting";
import { CODE_TOOLS } from "../proposals/proposalCode";

const answer = (
  selectedOptions: number[],
  customAnswer: string | null = null,
) => [{ question: "q", selectedOptions, customAnswer }];

function apply(source: Json, ops: ReturnType<typeof webSearchSettingOps>) {
  const copy: JSONValue = JSON.parse(JSON.stringify(source));
  const applied = applyPatch(copy, new JSONOps(), ops);
  if (result.isErr(applied)) throw new Error(applied.error.message);
  return applied.value;
}

describe("the web search setting", () => {
  test("is on, off, or not decided", () => {
    expect(readWebSearchSetting({ assistant: { webSearch: true } })).toBe(true);
    expect(readWebSearchSetting({ assistant: { webSearch: false } })).toBe(
      false,
    );
    const undecided: (Json | undefined)[] = [
      {},
      { assistant: {} },
      { assistant: { webSearch: null } },
      { assistant: { webSearch: "yes" } },
      undefined,
    ];
    for (const source of undecided) {
      expect(readWebSearchSetting(source)).toBeNull();
    }
  });

  test("the assistant is offered request_web_search only while undecided", () => {
    expect(withWebSearchRequest(CODE_TOOLS, null)).toContain(
      REQUEST_WEB_SEARCH_TOOL,
    );
    expect(withWebSearchRequest(CODE_TOOLS, false)).toBe(CODE_TOOLS);
    expect(withWebSearchRequest(CODE_TOOLS, true)).toBe(CODE_TOOLS);
  });

  test("and not where the answer could not be saved", () => {
    // No settings module, or read-only settings: "Turn on" would only lead to
    // an error, so the assistant is not given the question to ask.
    expect(withWebSearchRequest(CODE_TOOLS, "cannot-save")).toBe(CODE_TOOLS);
    expect(webSearchRequestPromptSection("cannot-save")).toBe("");
  });

  test("and is told about it only while undecided", () => {
    expect(webSearchRequestPromptSection(null)).toContain("request_web_search");
    expect(webSearchRequestPromptSection(false)).toBe("");
    expect(webSearchRequestPromptSection(true)).toBe("");
  });
});

describe("request_web_search's card", () => {
  test("is Val's question, with the assistant's reason shown as its own", () => {
    const [card] = webSearchRequestQuestions("To check the opening hours.");
    expect(card.question).toContain('It says: "To check the opening hours."');
    expect(card.options.map((o) => o.label)).toEqual([
      "Turn on web search",
      "Don't turn on",
    ]);
  });

  test("turning it on writes true, and says it works from the next message", () => {
    const outcome = webSearchRequestOutcome(answer([0]));
    expect(outcome.write).toBe(true);
    expect(outcome.result.note).toContain("next message");
  });

  test("not turning it on writes false: they are not asked again", () => {
    const outcome = webSearchRequestOutcome(answer([1]));
    expect(outcome.write).toBe(false);
    expect(outcome.result.error).toContain("will not be asked again");
  });

  test("closing the card, or only typing, decides nothing", () => {
    expect(webSearchRequestOutcome(null).write).toBeNull();
    const typed = webSearchRequestOutcome(answer([], "maybe later"));
    expect(typed.write).toBeNull();
    expect(typed.result.error).toContain("maybe later");
  });
});

describe("writing the answer", () => {
  test("into an existing section, only webSearch changes", () => {
    const before = { assistant: { enabled: true, context: "c", tone: null } };
    const after = apply(before, webSearchSettingOps(true, true));
    expect(after).toEqual({
      assistant: { enabled: true, context: "c", tone: null, webSearch: true },
    });
  });

  test("with no section, the section is written with the rest unset", () => {
    const after = apply({}, webSearchSettingOps(false, false));
    expect(after).toEqual({
      assistant: { enabled: null, context: null, tone: null, webSearch: false },
    });
  });
});

describe("the guard on the assistant's own writes", () => {
  test("a patch that turns web search on is caught", () => {
    expect(
      patchChangesWebSearchSetting({ assistant: { enabled: true } }, [
        { op: "add", path: ["assistant", "webSearch"], value: true },
      ]),
    ).toBe(true);
  });

  test("so is replacing the whole section with one that has it", () => {
    expect(
      patchChangesWebSearchSetting({ assistant: { webSearch: false } }, [
        { op: "replace", path: ["assistant"], value: { webSearch: true } },
      ]),
    ).toBe(true);
  });

  test("a patch to another setting is not", () => {
    expect(
      patchChangesWebSearchSetting({ assistant: { webSearch: false } }, [
        { op: "replace", path: ["assistant", "webSearch"], value: false },
        { op: "add", path: ["assistant", "tone"], value: "Plain." },
      ]),
    ).toBe(false);
  });

  test("unset and null are the same decision: none", () => {
    expect(
      changesWebSearchSetting({}, { assistant: { webSearch: null } }),
    ).toBe(false);
  });
});
