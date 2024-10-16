import { fixCapitalization } from "./fixCapitalization";

export function prettifyFilename(filename: string) {
  return fixCapitalization(filename.split(".")[0]);
}
