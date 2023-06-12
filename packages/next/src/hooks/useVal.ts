import {
  GenericSelector,
  Json,
  JsonOfSource,
  SelectorOf,
  SelectorSource,
  Val,
  Internal,
} from "@valbuild/core";
import { useVal as useReactVal } from "@valbuild/react";
import { vercelStegaCombine } from "@vercel/stega";

export function useVal<T extends SelectorSource>(
  selector: T,
  locale?: string
): SelectorOf<T> extends GenericSelector<infer S> ? JsonOfSource<S> : never {
  return stegaEncodeVal(
    useReactVal(selector, locale)
  ) as SelectorOf<T> extends GenericSelector<infer S> ? JsonOfSource<S> : never;
}

function stegaEncodeVal<T extends Json>(val: Val<T>): T {
  if (typeof val.val === "object") {
    if (Array.isArray(val)) {
      return val.map(stegaEncodeVal) as any;
    }

    return Object.fromEntries(
      Object.entries(val).map(([key, value]) => [key, stegaEncodeVal(value)])
    ) as T;
  }
  if (typeof val.val === "string") {
    return vercelStegaCombine(val.val, {
      origin: "app.val.build",
      data: { valPath: Internal.getValPath(val) },
    }) as T;
  }
  return val.val as any;
}
