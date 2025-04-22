import { fixCapitalization } from "./fixCapitalization";

export function prettifyFilename(filename: string) {
  if (filename.endsWith(".val.ts")) {
    return fixCapitalization(filename.slice(0, -".val.ts".length));
  }
  if (filename.endsWith(".val.js")) {
    return fixCapitalization(filename.slice(0, -".val.js".length));
  }
  return fixCapitalization(filename);
}
