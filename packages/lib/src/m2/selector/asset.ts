import {
  Selector as UnknownSelector,
  SelectorC,
  SelectorOf,
  SelectorSource,
  VAL_OR_EXPR,
} from ".";
import { Val } from "../val";

export type AssetSelector = AssetSelectorC;

class AssetSelectorC
  extends SelectorC<{ url: string }>
  implements AssetSelector
{
  readonly url: UnknownSelector<string> = null as any;

  andThen<U extends SelectorSource>(f: (v: AssetSelector) => U): SelectorOf<U> {
    throw Error("TODO: implement me");
  }
  [VAL_OR_EXPR](): Val<{ url: string }> {
    throw Error("TODO: implement me");
  }
}
