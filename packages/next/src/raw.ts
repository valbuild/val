import { ValEncodedString, stegaClean } from "@valbuild/react/stega";

export function raw(encodedString: ValEncodedString): string {
  return stegaClean(encodedString);
}
