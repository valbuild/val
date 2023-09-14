import { SelectorSource, SelectorOf, GenericSelector } from "@valbuild/core";
import { transform, StegaOfSource } from "./transform";

export function fetchVal<T extends SelectorSource>(
  selector: T
): SelectorOf<T> extends GenericSelector<infer S>
  ? Promise<StegaOfSource<S>>
  : never {
  return Promise.resolve(
    transform(selector)
  ) as SelectorOf<T> extends GenericSelector<infer S>
    ? Promise<StegaOfSource<S>>
    : never;
}
