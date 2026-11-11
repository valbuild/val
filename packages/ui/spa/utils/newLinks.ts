import type { Json } from "@valbuild/core";

/**
 * The web addresses a change adds: in the value after it, and not in the value
 * before it.
 *
 * A link in published content is the most likely way out of a project for
 * something that should not leave it: an assistant that read a hostile page
 * can be told to add one, and a person can paste one in without looking at
 * where it goes. So the review shows each new one, with its site, whoever
 * made the change. Computed from the values alone, so it needs nothing to
 * have been recorded about how they got there.
 *
 * Every string in the value is searched, at any depth: a string field, a
 * link's `href` in rich text, a URL inside running text. Only absolute
 * `http(s)` addresses count; a relative one stays on the site.
 */
export function newLinks(
  before: Json | undefined,
  after: Json | undefined,
): NewLink[] {
  const existing = linksIn(before);
  const added: NewLink[] = [];
  for (const url of linksIn(after)) {
    if (existing.has(url)) continue;
    const host = hostOf(url);
    if (host !== null) added.push({ url, host });
  }
  return added.sort((a, b) => a.url.localeCompare(b.url));
}

export type NewLink = { url: string; host: string };

// Stops where a URL cannot go on, and at the quotes and brackets that usually
// surround one in text.
const URL_IN_TEXT = /https?:\/\/[^\s"'<>()[\]{}]+/gi;
// Punctuation that ends a sentence rather than the address.
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;

/** Every absolute http(s) URL in a value, at any depth. Exported for tests. */
export function linksIn(value: Json | undefined): Set<string> {
  const found = new Set<string>();
  const visit = (node: Json | undefined) => {
    if (typeof node === "string") {
      for (const match of node.matchAll(URL_IN_TEXT)) {
        found.add(match[0].replace(TRAILING_PUNCTUATION, ""));
      }
    } else if (Array.isArray(node)) {
      node.forEach(visit);
    } else if (typeof node === "object" && node !== null) {
      Object.values(node).forEach(visit);
    }
  };
  visit(value);
  return found;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}
