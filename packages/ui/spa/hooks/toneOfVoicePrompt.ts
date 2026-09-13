import { ModuleFilePath } from "@valbuild/core";

/**
 * What "Generate from my content" asks the assistant.
 *
 * A prompt rather than an endpoint, and that is the design rather than a
 * shortcut. The assistant already has every tool this needs — `get_all_schema`
 * to find the modules, `search_content` and `get_source` to read them,
 * `create_patch` to write the answer — so a dedicated route would be a second
 * implementation of reading a project's content, with a worse one at the end of
 * it. What the button actually saves is the typing.
 *
 * Three things follow from that, and all three are better than the alternative:
 *
 * - **The editor sees the work.** Which modules it read, what it concluded, and
 *   the patch it wrote are all in the conversation. A one-shot endpoint would
 *   put a paragraph in a field with no account of where it came from.
 * - **It is a conversation.** "Shorter", "we are not that formal", "keep the
 *   British spellings" are the next message, not a second feature.
 * - **It writes a draft.** `create_patch` goes through the same path every
 *   other edit does, so the result is a pending change an editor can edit or
 *   discard, and it shows in the publish diff like anything else.
 *
 * The prompt is here, alone in a file with a test, because it is the whole of
 * the feature's behaviour: everything else is a button.
 */
export function toneOfVoicePrompt(
  /**
   * Where to write the answer. The Studio knows this and the assistant would
   * have to guess — `resolveSettingsModule`'s rules are not something it can
   * see, and guessing wrong means a patch to a module that is not the
   * project's settings.
   */
  settingsModuleFilePath: ModuleFilePath,
): string {
  return [
    "Write this project's tone of voice, from the content it already has.",
    "",
    "Read a spread of what is actually published rather than one module: use get_all_schema to see what there is, then search_content and get_source to read a sample across a few different kinds of content — a page or two, some body text, a heading, a short label. What you are looking for is how this project already writes, not how a website should be written.",
    "",
    "Then describe it as instructions for someone writing more of it. Concrete and checkable: sentence case or title case, British or American spelling, how formal, whether exclamation marks and questions are used, contractions or not, how long a sentence tends to run, words this project uses for its own things and words it avoids. Say what you observed, not what you would recommend — if the content is inconsistent, say which way it mostly goes.",
    "",
    "A short paragraph, or a handful of lines. It is prepended to every message you are sent from now on, so it needs to earn its length.",
    `Then write it with create_patch to \`${settingsModuleFilePath}\` at \`assistant.tone\`. Check the module's source first: every key in a settings module is optional, so if there is no \`assistant\` section yet you have to write the section — \`{ "enabled": null, "context": null, "tone": "..." }\` — rather than a key inside one that does not exist.`,
    "",
    "Show me the text before you write it, and say which modules it came from.",
  ].join("\n");
}
