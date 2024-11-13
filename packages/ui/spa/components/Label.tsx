import { fromCamelToTitleCase } from "../utils/prettifyText";

export function Label({ children }: { children: string }) {
  return <div>{fromCamelToTitleCase(children)}</div>;
}
