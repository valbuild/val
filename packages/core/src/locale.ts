export function validateLocale(locale: string): false | string {
  if (locale.match(/^[a-z]{2}-[a-z]{2}$/)) {
    return false;
  }
  return "Invalid locale format. Must be two lower case letters for language and two lowercase letters for country, separated by a hyphen. Expected format: xx-xx (e.g. en-us, nb-no)";
}
