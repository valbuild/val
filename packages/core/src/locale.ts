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
