const CJK =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

function initialOf(part: string): string {
  // A CJK glyph IS the initial - uppercasing it does nothing and taking two
  // characters out of one part would be taking two names.
  return CJK.test(part) ? part[0] : part[0].toLocaleUpperCase();
}

/**
 * The one or two characters that stand in for a person when there is no
 * picture of them.
 *
 * Two characters at most, from the first and last name part: an avatar is a
 * 24px circle, and "ABKL" for "Ada Byron King Lovelace" does not fit in one.
 * A single name part gives its first two letters rather than one, because a
 * circle with "AD" in it reads as a name and one with "A" reads as a bullet.
 */
export function getInitials(fullName: string): string {
  if (!fullName || typeof fullName !== "string") {
    return "?";
  }

  const parts = fullName
    .trim()
    .normalize("NFC")
    .split(/\s+/)
    .filter((part) => part.length > 0);

  if (parts.length === 0) {
    return "?";
  }
  if (parts.length === 1) {
    const only = parts[0];
    return CJK.test(only) ? only[0] : only.slice(0, 2).toLocaleUpperCase();
  }
  return initialOf(parts[0]) + initialOf(parts[parts.length - 1]);
}
