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
 * never touched the assistant's settings should not have to edit its settings
 * file the day `locales` or `permissions` land.
 *
 * That is why settings is not sugar over `s.object()`: an object schema errors
 * with `Expected key 'assistant' not found in object` for any absent key (see
 * `ObjectSchema.executeAssert`), and `.nullable()` permits `null`, not absence.
 * `SettingsSchema` gives absent keys the meaning "unset" instead.
 *
 * `null` means unset too, so the editor can clear a field it has already
 * written without removing the key.
 */
export type SettingsSource = {
  assistant?: AssistantSettingsSource;
  locales?: LocalesSettingsSource;
};

/**
 * The languages this project publishes.
 *
 * Content rather than configuration, and deliberately: which languages a site
 * has is a decision the people who write it make, and under a build-time
 * constant it took a developer and a deploy. It is the same move `assistant`
 * makes with `enabled`.
 *
 * Val ships no list of its own. A project with no `locales` section has not
 * said it is translated, and nothing about locales appears anywhere — no picker
 * in the Studio, no checks, nothing.
 *
 * **This list is a decision with a blast radius.** Every locale in content is
 * checked against it, so removing one invalidates the content that uses it, and
 * adding one leaves every locale-keyed record short of a language until it is
 * filled in. That is the intended behaviour — a language that is declared and
 * missing everywhere is worth being told about — but it is why the Studio warns
 * before saving a removal rather than treating this as an ordinary field.
 */
export type LocalesSettingsSource = {
  /**
   * The languages, as canonical BCP 47 tags: `en-US`, `nb-NO`.
   *
   * Order is the project's own, and it is kept: it decides the order of the
   * Studio's picker and of the rows in a locale-keyed record, so a project can
   * put the language it works in first.
   */
  available?: string[] | null;
  /**
   * The language content is written in first.
   *
   * Where the Studio starts, and what a translation is made FROM — never the
   * locale that happens to be on screen, so that the same button on the same
   * field asks the same thing whatever is being looked at.
   *
   * Must be one of `available`. Unset where nothing has been declared, or where
   * a project genuinely has no primary language, in which case nothing offers
   * to translate.
   */
  default?: string | null;
};

/**
 * The assistant: whether editors have one, and what it is told about the
 * project on every message.
 *
 * `context` and `tone` are prose the model reads, not instructions Val
 * interprets, and both are capped (see {@link ASSISTANT_SETTINGS_MAX_LENGTH}):
 * they are prepended to every request the chat makes, so an unbounded field
 * here is an unbounded cost on every turn.
 */
export type AssistantSettingsSource = {
  /**
   * Whether editors have an assistant in this project.
   *
   * Three states, not two — see {@link assistantAvailability}, which is the one
   * place that reads them. Unset is NOT "on": it is "nobody has decided", and
   * the Studio treats that as an offer rather than as an answer.
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
   * several inside `assistant`, leaving room for siblings (`audience`,
   * `glossary`) rather than a field that looks like it should absorb them.
   */
  tone?: string | null;
  /**
   * How to translate into each language, keyed by language.
   *
   * Per language rather than one field, because translation rules are per
   * language: bokmål or nynorsk, `du` or `De`, which product names stay in
   * English. Only the target language's note is sent, so a French rule does not
   * ride along in a Norwegian request.
   *
   * Not every language needs one, so this record is deliberately partial — it
   * is the one place a locale-keyed record is not expected to hold them all.
   */
  translation?: Record<string, string | null> | null;
};

/**
 * The cap on each of the assistant's prose fields, in characters.
 *
 * Roughly a thousand tokens each. Generous enough for a paragraph of
 * background and a house style, small enough that the two of them together do
 * not dominate the system prompt they are appended to.
 */
export const ASSISTANT_SETTINGS_MAX_LENGTH = 4000;

/**
 * Whether a project has an assistant — and the answer is not a boolean.
 *
 * - `"on"`: use it.
 * - `"off"`: every trace of it goes. No button in the top bar, no row in the
 *   quick actions, no panel, nothing sent. A project that says `false` has
 *   decided, and the Studio does not keep offering.
 * - `"unconfigured"`: nobody has said. The affordances are SHOWN, and asking to
 *   use the assistant asks to turn it on first. That is the difference between
 *   this and `"off"`, and the reason `enabled` is a tri-state: hiding an
 *   unconfigured assistant means nobody discovers it, and quietly enabling one
 *   means a project starts sending its content to a model because it did not
 *   know to say no.
 *
 * A project with NO settings module is `"on"`. There is nowhere to record a
 * decision, so there is nothing to prompt for and nothing to prompt INTO — the
 * prompt writes to a settings module, and that project has none.
 *
 * This is the only answer to "does this project have an assistant":
 * `config.ai.chat` is gone, and with it the chat's title, description and
 * suggestions, which nothing replaces. The AI commit-message summariser is
 * deliberately not part of this — `config.ai.commitMessages` stays where it is,
 * and gets settings of its own later.
 */
export type AssistantAvailability = "on" | "off" | "unconfigured";

export function assistantAvailability(
  /** The settings module's source, or `undefined` where the project has none. */
  settings: SettingsSource | undefined,
): AssistantAvailability {
  if (settings === undefined) {
    return "on";
  }
  const enabled = settings.assistant?.enabled;
  if (enabled === true) {
    return "on";
  }
  if (enabled === false) {
    return "off";
  }
  return "unconfigured";
}
