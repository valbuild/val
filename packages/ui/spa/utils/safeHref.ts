/**
 * The href of a server-supplied error action, or undefined if it is not one we
 * will render.
 *
 * The action comes from the content server (today: "go to the admin and set up
 * a key"), so it is not user input — but it is remote input ending up in an
 * `href`, and `javascript:` there runs in the Studio's own context. An
 * allow-list of schemes is the cheap way to make that impossible, and a
 * same-origin path is the common case.
 */
export function safeHref(url: string): string | undefined {
  if (url.startsWith("/") && !url.startsWith("//")) {
    return url;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  return parsed.protocol === "https:" || parsed.protocol === "http:"
    ? url
    : undefined;
}
