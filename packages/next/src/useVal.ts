import { GenericSelector, SelectorOf, SelectorSource } from "@valbuild/core";
import { StegaOfSource, transform } from "@valbuild/react/stega";
import { isValEnabled } from "./isValEnabled";

export function useVal<T extends SelectorSource>(
  selector: T
): SelectorOf<T> extends GenericSelector<infer S> ? StegaOfSource<S> : never {
  return transform(selector, {
    disabled: !isValEnabled(),
  }) as SelectorOf<T> extends GenericSelector<infer S>
    ? StegaOfSource<S>
    : never;
}
