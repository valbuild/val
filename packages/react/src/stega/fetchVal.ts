import { SelectorSource, SelectorOf, GenericSelector } from "@valbuild/core";
import { stegaEncodeVal, StegaOfSource } from "./stegaEncode";
import { Internal } from "@valbuild/core";

export function fetchVal<T extends SelectorSource>(
  selector: T,
  locale?: string
): SelectorOf<T> extends GenericSelector<infer S>
  ? Promise<StegaOfSource<S>>
  : never {
  return Internal.fetchVal(selector, locale).then((val) =>
    stegaEncodeVal(val)
  ) as SelectorOf<T> extends GenericSelector<infer S>
    ? Promise<StegaOfSource<S>>
    : never;
}
