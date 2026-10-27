import { ModuleFilePath } from "@valbuild/core";
import { toneOfVoicePrompt } from "./toneOfVoicePrompt";

/**
 * The prompt is the feature, so the parts of it that are load-bearing are
 * pinned and the prose is not.
 *
 * Three things in it are not stylistic. Each one, left out, produces a button
 * that appears to work and quietly does the wrong thing — which is the worst
 * kind of failure for an affordance an editor pressed once and will not press
 * again.
 */
const SETTINGS = "/settings.val.ts" as ModuleFilePath;

describe("toneOfVoicePrompt", () => {
  test("names the settings module it must write to", () => {
    // Without this the assistant guesses. `resolveSettingsModule`'s rules —
    // exactly one, at the root of the content tree — are not something it can
    // see, and a wrong guess is a patch to a module that is not the project's
    // settings.
    expect(toneOfVoicePrompt(SETTINGS)).toContain(SETTINGS);
    expect(
      toneOfVoicePrompt("/config/settings.val.ts" as ModuleFilePath),
    ).toContain("/config/settings.val.ts");
  });

  test("names the field, so the answer does not land in context", () => {
    expect(toneOfVoicePrompt(SETTINGS)).toContain("assistant.tone");
  });

  test("says the section may not exist yet", () => {
    // Every key in a settings module is optional, so `{}` is the normal state
    // of a fresh one — and a patch at `assistant.tone` fails when there is no
    // `assistant` to put a key inside. The assistant cannot know that from the
    // schema alone, and the failure would arrive as a rejected patch after the
    // work was done.
    const prompt = toneOfVoicePrompt(SETTINGS);
    expect(prompt).toContain("optional");
    expect(prompt).toContain("assistant");
  });

  test("asks it to read the content rather than invent a house style", () => {
    // The whole premise: "based on the current content". A prompt that only
    // said "write a tone of voice" would produce a plausible paragraph about
    // nothing, which is worse than an empty field because it looks done.
    const prompt = toneOfVoicePrompt(SETTINGS);
    expect(prompt).toContain("search_content");
    expect(prompt).toContain("get_source");
    expect(prompt).toContain("get_all_schema");
  });

  test("asks to see the text before it is written", () => {
    expect(toneOfVoicePrompt(SETTINGS).toLowerCase()).toContain("show me");
  });
});
