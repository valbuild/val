import { ValEncodedString, stegaDecodeString } from "@valbuild/react/stega";

export function decodeValPathOfString(
  encodedString: ValEncodedString,
): string | undefined {
  return stegaDecodeString(encodedString);
}
