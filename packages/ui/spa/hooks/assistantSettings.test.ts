import { initVal, ModuleFilePath } from "@valbuild/core";
import {
  assistantSettingsPromptSection,
  NO_ASSISTANT_SETTINGS,
  readAssistantSettings,
  settingsModuleFilePath,
} from "./assistantSettings";

const { s } = initVal();

describe("readAssistantSettings", () => {
  test("an empty settings module says nothing", () => {
    expect(readAssistantSettings({})).toEqual(NO_ASSISTANT_SETTINGS);
  });

  test("reads context and tone", () => {
    expect(
      readAssistantSettings({
        assistant: {
          context: "A CMS for developers.",
          tone: "Plain and direct.",
        },
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
    expect(
      readAssistantSettings({ assistant: { context: "   ", tone: "" } }),
    ).toEqual(NO_ASSISTANT_SETTINGS);
  });

  test("enabled is a tri-state: unset is not false", () => {
    expect(readAssistantSettings({ assistant: {} }).enabled).toBe(null);
    expect(
      readAssistantSettings({ assistant: { enabled: false } }).enabled,
    ).toBe(false);
    expect(
      readAssistantSettings({ assistant: { enabled: true } }).enabled,
    ).toBe(true);
  });

  test("a source that is not a settings object says nothing", () => {
    expect(readAssistantSettings(undefined)).toEqual(NO_ASSISTANT_SETTINGS);
    expect(readAssistantSettings("nonsense")).toEqual(NO_ASSISTANT_SETTINGS);
    expect(readAssistantSettings([])).toEqual(NO_ASSISTANT_SETTINGS);
    expect(readAssistantSettings({ assistant: "nonsense" })).toEqual(
      NO_ASSISTANT_SETTINGS,
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

describe("assistantSettingsPromptSection", () => {
  test("nothing set, nothing added to the prompt", () => {
    expect(assistantSettingsPromptSection(NO_ASSISTANT_SETTINGS)).toBe("");
    expect(
      assistantSettingsPromptSection({
        enabled: true,
        context: null,
        tone: null,
      }),
    ).toBe("");
  });

  test("context alone", () => {
    const section = assistantSettingsPromptSection({
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
    const section = assistantSettingsPromptSection({
      enabled: null,
      context: null,
      tone: "Playful, with short sentences.",
    });
    expect(section).toContain("Playful, with short sentences.");
    expect(section).toContain("not to what you say to the editor");
  });
});
