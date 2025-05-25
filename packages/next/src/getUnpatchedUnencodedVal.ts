import type {
  GenericSelector,
  SelectorOf,
  SelectorSource,
} from "@valbuild/core";
import { type StegaOfSource, stegaEncode } from "@valbuild/react/stega";

export function getUnpatchedUnencodedVal<T extends SelectorSource>(
  selector: T,
): SelectorOf<T> extends GenericSelector<infer S> ? StegaOfSource<S> : never {
  // It is weird to use stega encode here since we never actually should stega encode,
  // however, this is a workaround, since if it is disabled, it will behave as we want
  return stegaEncode(selector, {
    disabled: true,
  });
}
