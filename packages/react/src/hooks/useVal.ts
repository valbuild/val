import {
  SelectorSource,
  SelectorOf,
  GenericSelector,
  Val,
  getVal,
} from "@valbuild/lib";
import { JsonOfSource } from "@valbuild/lib/src/val";

export function useVal<T extends SelectorSource>(
  selector: T,
  locale?: string
): SelectorOf<T> extends GenericSelector<infer S>
  ? Val<JsonOfSource<S>>
  : never {
  return getVal(selector, locale);
}
