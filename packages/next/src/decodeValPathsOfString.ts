import { ValEncodedString, stegaDecodeStrings } from "@valbuild/react/stega";

export function decodeValPathsOfString(
  encodedString: ValEncodedString,
): string[] | undefined {
  return stegaDecodeStrings(encodedString);
}
