import { Selector } from "./selector";
import { newSelectorProxy } from "./selector/SelectorProxy";
import { Source } from "./Source";

export function selectorOf<T extends Source>(t: T): Selector<T> {
  return newSelectorProxy(t);
}
