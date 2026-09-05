/**
 * Language tags, and what makes one wrong.
 *
 * Val does not ship a list of locales. Which languages a project publishes is a
 * property of that project, so it is declared in the settings module — see
 * `LocalesSettingsSource` — and everything downstream reads it from there.
 *
 * What Val does own is the SPELLING. A tag is checked against BCP 47
 * (RFC 5646) through `Intl.getCanonicalLocales`, which is the same
 * implementation the browser, `<html lang>` and every `Intl` constructor use.
 * Delegating rather than writing a matcher is the point: a tag this accepts is
 * a tag those accept.
 */

/**
 * What is wrong with `tag` as a language tag, or `false` if nothing is.
 *
 * Canonical form, not merely parseable, and the difference is what makes this
 * worth checking at all. `nb-no` parses; `Intl.DisplayNames` and a
 * case-sensitive comparison against a stored key do not agree about it. Since a
 * locale is compared as a string everywhere — a record key, a URL segment, a
 * value in content — one spelling has to win, and the canonical one is the
 * spelling every other tool already produces.
 *
 * The message names the canonical form where there is one, because "not
 * canonical" is not an instruction and `nb-NO` is.
 */
export function localeTagError(tag: string): string | false {
  let canonical: string[];
  try {
    canonical = Intl.getCanonicalLocales(tag);
  } catch {
    // RangeError, for anything the grammar rejects: an underscore instead of a
    // hyphen (`nb_NO`, which is POSIX rather than BCP 47), an empty subtag, a
    // subtag of the wrong length.
    return `'${tag}' is not a language tag. Language then region, separated by a hyphen — 'nb-NO', not 'nb_NO'`;
  }
  if (canonical.length !== 1) {
    // A comma-separated list, or something that canonicalised to nothing.
    return `'${tag}' is not a single language tag`;
  }
  if (canonical[0] !== tag) {
    return `'${tag}' is not canonical. Write it as '${canonical[0]}'`;
  }
  return false;
}

/**
 * A language tag, as content holds it.
 *
 * A *flavoured* string rather than a union or a strict brand. Which languages a
 * project has is declared in its settings module, where the project can change
 * it, so there is no set for a type to enumerate — and a strict brand would make
 * `"nb-NO"` unassignable, which would mean writing every locale in a `.val.ts`
 * through a constructor. Content stays plain data.
 *
 * So this carries no compile-time guarantee, and is not meant to. It names the
 * concept where a bare `string` would say nothing, and the guarantee is the
 * `locale:check-locale` validation against `locales.available`.
 */
declare const localeBrand: unique symbol;
export type Locale = string & { readonly [localeBrand]?: "locale" };

/**
 * How a locale is spelled where it is stored, when that is not the tag itself.
 *
 * Declared on the schema — `s.locale().aliases({ "nb-NO": "no" })` — and it
 * changes what is STORED, not merely what is accepted. It has to: in a route key
 * the stored value IS the URL segment, so a page at `/no/vinterjakke` has `no`
 * in its key and `nb-NO` is derived from it by looking here.
 *
 * A locale may have several spellings (two divisions of one company, both
 * writing American English); the first is what a new value is written with.
 */
export type LocaleAliases = Record<string, string | readonly string[]>;

/** Every spelling a locale is stored as, in declaration order. */
export function spellingsOf(
  aliases: LocaleAliases,
  locale: string,
): readonly string[] {
  const declared = aliases[locale];
  if (declared === undefined) {
    return [];
  }
  return typeof declared === "string" ? [declared] : declared;
}

/**
 * Every value the schema accepts, given its aliases and the project's languages.
 *
 * Without aliases that is the languages themselves. With them it is the
 * spellings alone — the canonical tag is NOT also accepted, and that is the
 * point: if both were, one page could exist at `/no/foo` and `/nb-NO/foo`, two
 * keys for one locale, which is duplicate content nobody would notice.
 *
 * An alias map is also a subset: a map that says nothing about `fr-FR` means
 * this field has no French, which is how a bilingual router says so.
 */
export function acceptedLocaleValues(
  available: readonly string[],
  aliases: LocaleAliases | undefined,
): string[] {
  if (aliases === undefined) {
    return [...available];
  }
  const accepted: string[] = [];
  for (const locale of Object.keys(aliases)) {
    for (const spelling of spellingsOf(aliases, locale)) {
      accepted.push(spelling);
    }
  }
  return accepted;
}

/**
 * The locale a stored value means, or `null` if it means none of them.
 *
 * The one place a stored spelling turns back into a language, so that the Studio,
 * the validation worker and the server cannot disagree about what `/no/…` is.
 */
export function localeOfValue(
  value: string,
  available: readonly string[],
  aliases: LocaleAliases | undefined,
): string | null {
  if (aliases === undefined) {
    return available.includes(value) ? value : null;
  }
  for (const locale of Object.keys(aliases)) {
    if (spellingsOf(aliases, locale).includes(value)) {
      return locale;
    }
  }
  return null;
}
