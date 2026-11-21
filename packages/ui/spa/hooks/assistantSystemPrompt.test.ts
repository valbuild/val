import { createHash } from "crypto";
import {
  assistantSystemPrompt,
  CODE_MODE_PROMPT_SECTION,
  type AssistantSystemPromptInput,
} from "./assistantSystemPrompt";
import { CONTENT_EDITOR_PERSONA } from "./assistantPersona";
import { NO_ASSISTANT_SETTINGS } from "./assistantSettings";
import {
  MAX_PROJECT_INSTRUCTIONS_CHARS,
  projectInstructionsOf,
} from "../proposals/proposalCode";
import {
  buildProjectMap,
  MAX_PROJECT_MAP_CHARS,
  projectMapText,
} from "../proposals/projectMap";

const editor: AssistantSystemPromptInput = {
  codeMode: false,
  sketchpads: false,
  settings: NO_ASSISTANT_SETTINGS,
  webSearchSetting: false,
  page: false,
  code: null,
  projectInstructions: null,
  projectMap: null,
};
const codeMode: AssistantSystemPromptInput = {
  ...editor,
  codeMode: true,
  page: true,
  code: { kind: "proposal" },
  projectInstructions: "### AGENTS.md\nUse tabs.",
  projectMap: "### Files\n./: package.json",
};

describe("the content editor's prompt", () => {
  test("is as it was: code mode's rules changed nothing in it", () => {
    const prompt = assistantSystemPrompt(editor);
    expect(prompt.startsWith(CONTENT_EDITOR_PERSONA)).toBe(true);
    // The whole text, by its hash. `assistantPersona.ts` says not to change
    // the content editor's prompt in passing: if this fails and you meant
    // to change what a content editor's assistant is told, update the hash.
    expect(createHash("sha256").update(prompt).digest("hex")).toBe(
      "b2970bd2c86622a0b9e57ee6a8f5923713b8c3706bae99eef3371fa2e736a0b8",
    );
  });

  test("keeps the content rules, on the site and in a proposal too", () => {
    for (const code of [
      null,
      { kind: "site" as const },
      { kind: "proposal" as const },
    ]) {
      const prompt = assistantSystemPrompt({
        ...editor,
        code,
        // Read for a proposal that had code mode on, and since turned off.
        projectInstructions: "### AGENTS.md\nUse tabs.",
        projectMap: "### Files\n./: package.json",
      });
      expect(prompt).toContain(
        "Always call get_all_schema first unless the question clearly does not require it.",
      );
      expect(prompt).toContain("call this after every change.");
      expect(prompt).toContain("Call this at least once per session, early");
      expect(prompt).not.toContain(CODE_MODE_PROMPT_SECTION);
      expect(prompt).not.toContain("## The project's map");
      expect(prompt).not.toContain("## The project's own instructions");
    }
  });
});

describe("the prompt in code mode", () => {
  const prompt = assistantSystemPrompt(codeMode);

  test("drops the content editor's ceremony a code change does not need", () => {
    expect(prompt).not.toContain("Always call get_all_schema first");
    expect(prompt).not.toContain("call this after every change");
    expect(prompt).not.toContain("at least once per session");
    expect(prompt).toContain("in the same reply as your first other tool call");
  });

  test("says to read together and to edit together", () => {
    expect(prompt).toContain(CODE_MODE_PROMPT_SECTION);
    expect(CODE_MODE_PROMPT_SECTION).toContain("in ONE reply");
  });

  test("ends with what changes most: the instructions, then the map", () => {
    const rules = prompt.indexOf(CODE_MODE_PROMPT_SECTION);
    const instructions = prompt.indexOf("## The project's own instructions");
    const map = prompt.indexOf("## The project's map");
    expect(rules).toBeGreaterThan(0);
    expect(instructions).toBeGreaterThan(rules);
    expect(map).toBeGreaterThan(instructions);
    expect(prompt.endsWith("### Files\n./: package.json")).toBe(true);
  });

  test("a new file moves the end of the prompt, and nothing before the map", () => {
    const withFile = assistantSystemPrompt({
      ...codeMode,
      projectMap: "### Files\n./: new.ts, package.json",
    });
    const map = prompt.indexOf("## The project's map");
    expect(withFile.slice(0, map)).toBe(prompt.slice(0, map));
  });

  test("the same input gives the same prompt: nothing in it is a time or an id", () => {
    expect(assistantSystemPrompt({ ...codeMode })).toBe(prompt);
  });

  test("a long AGENTS.md and a huge project stay inside their budgets together", () => {
    const project: Record<string, string> = {
      "AGENTS.md": "Follow the rules. ".repeat(5000),
    };
    for (let i = 0; i < 6000; i++) {
      project[`src/area${i % 70}/part${i % 13}/File${i}.tsx`] = "";
    }
    const instructions = projectInstructionsOf(project);
    const map = projectMapText(buildProjectMap(project));
    const without = assistantSystemPrompt({
      ...codeMode,
      projectInstructions: null,
      projectMap: null,
    });
    const withBoth = assistantSystemPrompt({
      ...codeMode,
      projectInstructions: instructions,
      projectMap: map,
    });
    // The two budgets, and a few hundred characters of headings and notes.
    expect(withBoth.length - without.length).toBeLessThanOrEqual(
      MAX_PROJECT_INSTRUCTIONS_CHARS + MAX_PROJECT_MAP_CHARS + 1000,
    );
    expect(withBoth).toContain("read_file AGENTS.md for it.");
  });
});
