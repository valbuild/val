import {
  GenericSelector,
  Selector,
  SelectorOf,
  SelectorSource,
  SourceOf,
} from "./selector";
import { Source } from "../Source";
import { JsonOfSource, Val } from "./val";

export function valuation<T extends SelectorSource>(
  selector: T,
  locale?: string
): SelectorOf<T> extends GenericSelector<infer S>
  ? Val<JsonOfSource<S>>
  : never {
  throw Error("TODO");
}
