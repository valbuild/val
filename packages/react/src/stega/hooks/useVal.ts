import { GenericSelector, SelectorOf, SelectorSource } from "@valbuild/core";
import { transform, StegaOfSource } from "../transform";

export function useVal<T extends SelectorSource>(
  selector: T
): SelectorOf<T> extends GenericSelector<infer S> ? StegaOfSource<S> : never {
  return transform(selector) as SelectorOf<T> extends GenericSelector<infer S>
    ? StegaOfSource<S>
    : never;
}
