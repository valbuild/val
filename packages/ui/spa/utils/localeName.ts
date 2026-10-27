/**
 * The name of a language, in that language.
 *
 * Asked in the tag's OWN locale on purpose: `nb-NO` reads "norsk bokmål" rather
 * than "Norwegian Bokmål", because the row is read by the person who writes that
 * language.
 *
 * `undefined` for anything `Intl` will not parse, so a malformed tag — which
 * validation is already complaining about — shows as itself rather than
 * crashing the row it is in.
 *
 * Its own module, and not a field's export, because the locale filter lives in
 * the shell's chrome: importing it from `LocaleField` dragged the entire field
 * tree into the top bar, and into every test that renders one.
 */
export function localeName(tag: string): string | undefined {
  try {
    return new Intl.DisplayNames([tag], { type: "language" }).of(tag);
  } catch {
    return undefined;
  }
}
