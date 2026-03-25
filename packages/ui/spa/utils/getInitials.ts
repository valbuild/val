// Thanks ChatGPT
export function getInitials(fullName: string): string {
  if (!fullName || typeof fullName !== "string") {
    return "";
  }

  // Normalize the input, trim whitespace, and split by Unicode word boundaries
  const nameParts = fullName
    .trim()
    .normalize("NFC") // Normalize to canonical form
    .split(/\s+/) // Split by whitespace

    .filter((part) => part.length > 0); // Remove empty strings

  // Handle each part
  const initials = nameParts.map((part) => {
    // Special handling for CJK (first character of each part)
    if (
      /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(
        part,
      )
    ) {
      return part[0];
    }
    // Latin and other scripts (use first letter)
    return part[0].toLocaleUpperCase();
  });

  // Join and return initials
  return initials.join("");
}
