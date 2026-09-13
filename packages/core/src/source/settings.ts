import { ImageSource } from "./media";

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
  theme?: ThemeSettingsSource;
  locales?: LocalesSettingsSource;
};

/**
 * How the Studio looks in this project.
 *
 * Chrome, and only chrome: nothing here reaches a visitor to the site. It is
 * the CMS that is being restyled, so that a project can make the tool it edits
 * in feel like its own.
 *
 * This is deliberately NOT the light/dark switch. That one is per-person and
 * per-machine (see `ValThemeProvider`, which keeps it in `localStorage`), and it
 * has to stay that way — one editor working in a dark room is not a fact about
 * the project. {@link ThemeSettingsSource.mode} is the project's DEFAULT for
 * someone who has not chosen, which is a different statement.
 */
export type ThemeSettingsSource = {
  /**
   * The one colour the Studio's chrome is built from, as a hex string.
   *
   * Unset means Val's own green. What it replaces is not a single value but the
   * whole ten-step brand ramp — `--colors-brand-green-100` through `-1000` —
   * because every brand token in `index.css` points into that ramp, and light
   * and dark pick different steps out of it. One accent therefore drives both
   * modes, with nothing to keep in sync.
   *
   * Any hex is allowed rather than a list of approved ones, and that is safe
   * for a measured reason rather than an optimistic one: the ramp is generated
   * by reusing green's LIGHTNESS at each step and changing only the hue, and
   * WCAG contrast is almost entirely a function of lightness. See
   * `accentRamp` in `@valbuild/shared`, whose tests hold every
   * foreground/background pair the chrome renders to AA across the hue circle.
   */
  accent?: string | null;
  /**
   * How round the Studio's corners are.
   *
   * Named steps rather than a length, for two reasons: a number input invites
   * `7px`, which nothing in the chrome is drawn around, and the scale is Val's
   * decision rather than the project's. See {@link THEME_RADIUS_LENGTHS} for
   * what each one is worth.
   */
  radius?: ThemeRadius | null;
  /**
   * The mode the Studio opens in for someone who has not picked one.
   *
   * A default, not a setting: an editor who has flicked the switch behind the
   * account button keeps their choice, and this never overrides it.
   */
  mode?: "dark" | "light" | null;
  /**
   * The project's own mark, shown where Val's is in the Studio.
   *
   * The top of the left rail on desktop, and beside the menu button on mobile.
   * NOT the launcher that floats on the project's own site: there the mark says
   * "this is Val", and a project's logo on its own page says nothing at all —
   * see {@link THEME_LOGO_DIRECTORY} and `architecture/logo.md`.
   *
   * A square-ish mark rather than a wordmark, because the slot it goes in is
   * 32px wide. A wide image is contained rather than cropped, so nothing is
   * cut off — it is simply small.
   */
  logo?: ImageSource | null;
};

/**
 * Where an uploaded logo goes.
 *
 * Its own directory rather than the `/public/val` default, so that the one
 * image a project uploads through the settings panel does not land in the
 * middle of its content's media. `val list-unused-files` reads what is
 * referenced rather than where it sits, so nothing depends on this beyond
 * tidiness.
 */
export const THEME_LOGO_DIRECTORY = "/public/val/brand";

/** @see {@link ThemeSettingsSource.radius} */
export type ThemeRadius = "square" | "tight" | "default" | "soft";

export const THEME_RADIUS_STEPS: readonly ThemeRadius[] = [
  "square",
  "tight",
  "default",
  "soft",
];

/**
 * What each radius step is worth, as a `--radius` value.
 *
 * `--radius` is the only length in the Studio's chrome that is a token:
 * `rounded-sm`, `rounded-md` and `rounded-lg` are all `calc(var(--radius) …)`
 * in `tailwind.config.js`, which is around three hundred call sites moving on
 * one value. `default` is what `index.css` declares, so selecting it and
 * clearing the setting look the same — which is what makes this list the whole
 * of the feature.
 *
 * `rounded-full` and the hand-written `rounded-t` / `-r` / `-b` cases do not
 * follow, and that is visible at `soft`: a pill stays a pill.
 */
export const THEME_RADIUS_LENGTHS: Record<ThemeRadius, string> = {
  square: "0rem",
  tight: "0.25rem",
  default: "0.5rem",
  soft: "1rem",
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
 *
 * There is no default language, deliberately. Every locale-specific field asks
 * which language it is in, and a default is exactly the answer that lets that
 * question go unanswered — content ends up filed under a language nobody chose,
 * which is the state translation is meant to make visible.
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
   * Keyed by language, so it holds every one of them once it exists at all —
   * `null` where a language needs no special instruction, which is most of them.
   * That is the same rule every locale-keyed record follows (see
   * `declaredKeys.ts`): a gap you can count and see in a diff, rather than a key
   * that is simply not there. A project with no notes at all leaves the whole
   * field unset and nothing is required.
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
