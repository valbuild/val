import { initVal, ModuleFilePath } from "@valbuild/core";
import {
  aiProjectSettingsPromptSection,
  NO_AI_PROJECT_SETTINGS,
  readAiProjectSettings,
  settingsModuleFilePath,
} from "./aiProjectSettings";

const { s } = initVal();

describe("readAiProjectSettings", () => {
  test("an empty settings module says nothing", () => {
    expect(readAiProjectSettings({})).toEqual(NO_AI_PROJECT_SETTINGS);
  });

  test("reads context and tone", () => {
    expect(
      readAiProjectSettings({
        ai: { context: "A CMS for developers.", tone: "Plain and direct." },
      }),
    ).toEqual({
      enabled: null,
      context: "A CMS for developers.",
      tone: "Plain and direct.",
    });
  });

  test("an empty string is unset", () => {
    // Otherwise the model is handed an instruction with nothing in it, which is
    // worse than no instruction: it has to decide what the blank meant.
    expect(readAiProjectSettings({ ai: { context: "   ", tone: "" } })).toEqual(
      NO_AI_PROJECT_SETTINGS,
    );
  });

  test("enabled is a tri-state: unset is not false", () => {
    expect(readAiProjectSettings({ ai: {} }).enabled).toBe(null);
    expect(readAiProjectSettings({ ai: { enabled: false } }).enabled).toBe(
      false,
    );
    expect(readAiProjectSettings({ ai: { enabled: true } }).enabled).toBe(true);
  });

  test("a source that is not a settings object says nothing", () => {
    expect(readAiProjectSettings(undefined)).toEqual(NO_AI_PROJECT_SETTINGS);
    expect(readAiProjectSettings("nonsense")).toEqual(NO_AI_PROJECT_SETTINGS);
    expect(readAiProjectSettings([])).toEqual(NO_AI_PROJECT_SETTINGS);
    expect(readAiProjectSettings({ ai: "nonsense" })).toEqual(
      NO_AI_PROJECT_SETTINGS,
    );
  });
});

describe("settingsModuleFilePath", () => {
  const settings = s.settings()["executeSerialize"]();
  const page = s.object({ title: s.string() })["executeSerialize"]();

  test("finds the project's settings module", () => {
    expect(
      settingsModuleFilePath({
        ["/content/page.val.ts" as ModuleFilePath]: page,
        ["/settings.val.ts" as ModuleFilePath]: settings,
      }),
    ).toBe("/settings.val.ts");
  });

  test("no settings module, no path", () => {
    expect(
      settingsModuleFilePath({
        ["/content/page.val.ts" as ModuleFilePath]: page,
      }),
    ).toBe(null);
  });

  test("two settings modules resolve to nothing, rather than to one of them", () => {
    expect(
      settingsModuleFilePath({
        ["/settings.val.ts" as ModuleFilePath]: settings,
        ["/config.val.ts" as ModuleFilePath]: settings,
      }),
    ).toBe(null);
  });
});

describe("aiProjectSettingsPromptSection", () => {
  test("nothing set, nothing added to the prompt", () => {
    expect(aiProjectSettingsPromptSection(NO_AI_PROJECT_SETTINGS)).toBe("");
    expect(
      aiProjectSettingsPromptSection({
        enabled: true,
        context: null,
        tone: null,
      }),
    ).toBe("");
  });

  test("context alone", () => {
    const section = aiProjectSettingsPromptSection({
      enabled: null,
      context: "A CMS for developers.",
      tone: null,
    });
    expect(section).toContain("## This project");
    expect(section).toContain("A CMS for developers.");
    expect(section).not.toContain("tone of voice");
  });

  test("tone says where it applies", () => {
    // The tone is for content, not for the chat: an editor asking a question
    // should get a plain answer, not one in the brand's voice.
    const section = aiProjectSettingsPromptSection({
      enabled: null,
      context: null,
      tone: "Playful, with short sentences.",
    });
    expect(section).toContain("Playful, with short sentences.");
    expect(section).toContain("not to what you say to the editor");
  });
});
