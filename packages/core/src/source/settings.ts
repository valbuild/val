/**
 * The source of the project's settings module — `s.settings()`.
 *
 * **Every key is optional, at every level, and that is the whole point.** A
 * settings module is written as
 *
 * ```typescript
 * export default c.define("/settings.val.ts", s.settings(), {});
 * ```
 *
 * and `{}` has to keep validating as sections are added to it. A project that
 * never touched the AI settings should not have to edit its settings file the
 * day `locales` or `permissions` land.
 *
 * That is why settings is not sugar over `s.object()`: an object schema errors
 * with `Expected key 'ai' not found in object` for any absent key (see
 * `ObjectSchema.executeAssert`), and `.nullable()` permits `null`, not absence.
 * `SettingsSchema` gives absent keys the meaning "unset" instead.
 *
 * `null` means unset too, so the editor can clear a field it has already
 * written without removing the key.
 */
export type SettingsSource = {
  ai?: AiSettingsSource;
};

/**
 * What the AI assistant is told about this project, on every message.
 *
 * Both fields are prose the model reads, not instructions Val interprets, and
 * both are capped (see {@link AI_SETTINGS_MAX_LENGTH}): they are prepended to
 * every request the chat makes, so an unbounded field here is an unbounded cost
 * on every turn.
 */
export type AiSettingsSource = {
  /**
   * Whether the assistant is available in this project at all.
   *
   * Unset means ON: a project that has bothered to write a settings module and
   * filled in its AI section did not do so to leave the assistant off, and
   * `false` is there to say otherwise.
   */
  enabled?: boolean | null;
  /**
   * Background the model would otherwise have to guess: what this site is, who
   * runs it, what the product does, names and spellings that matter.
   */
  context?: string | null;
  /**
   * How the model should write when it writes content — formal or playful,
   * British or American, sentence case in headings, no exclamation marks.
   *
   * Named `tone` rather than `toneOfVoice` so it reads as one hint among
   * several inside `ai`, leaving room for siblings (`audience`, `glossary`)
   * rather than a field that looks like it should absorb them.
   */
  tone?: string | null;
};

/**
 * The cap on each AI settings field, in characters.
 *
 * Roughly a thousand tokens each. Generous enough for a paragraph of
 * background and a house style, small enough that the two of them together do
 * not dominate the system prompt they are appended to.
 */
export const AI_SETTINGS_MAX_LENGTH = 4000;

/**
 * Whether the assistant is on, from the settings module's source.
 *
 * Unset is ON — see {@link AiSettingsSource.enabled} — so this is not
 * `!!settings?.ai?.enabled`, which is the mistake it exists to prevent. A
 * project with NO settings module has nothing to say either way and is left to
 * whatever decided that before settings existed.
 *
 * TODO: `config.ai.chat` is on its way here (`enabled`, and the chat's title,
 * description and suggestions with it), at which point this is the only answer
 * to "is the assistant on". The AI commit-message summariser is deliberately
 * NOT part of that move: it gets settings of its own later.
 */
export function isAiEnabled(settings: SettingsSource | undefined): boolean {
  return settings?.ai?.enabled !== false;
}
