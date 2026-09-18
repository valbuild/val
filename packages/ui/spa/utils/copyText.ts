/**
 * Copy to the clipboard, in an insecure context too.
 *
 * `navigator.clipboard` is secure-context only, exactly like
 * `crypto.randomUUID` ({@link ./randomUUID.ts}) — so a Studio opened over plain
 * http on a LAN address (`http://172.23.135.172:3000` from a browser outside
 * WSL is the one that keeps happening) has no `navigator.clipboard` at all, and
 * reaching straight for `.writeText` throws rather than failing to copy.
 *
 * `document.execCommand("copy")` is deprecated and works everywhere, which is
 * the whole reason to keep it as the fallback. The textarea goes on
 * `document.body` rather than into the Studio's shadow root because the
 * selection APIs `execCommand` reads are the document's.
 */
export function copyText(text: string): void {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  // Off-screen rather than hidden: `execCommand` will not copy from an element
  // that is not rendered.
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-1000px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  try {
    textarea.select();
    document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}
