import { GenericSelector, SelectorOf, SelectorSource } from "@valbuild/core";
import { useVal as useReactVal } from "@valbuild/react";
import { stegaEncodeVal, StegaOfSource } from "../stegaEncode";

export function useVal<T extends SelectorSource>(
  selector: T,
  locale?: string
): SelectorOf<T> extends GenericSelector<infer S> ? StegaOfSource<S> : never {
  return stegaEncodeVal(
    useReactVal(selector, locale)
  ) as SelectorOf<T> extends GenericSelector<infer S>
    ? StegaOfSource<S>
    : never;
}
