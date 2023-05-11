import { Selector } from ".";
import { newSelectorProxy } from "./SelectorProxy";
import { Source } from "../Source";

export function selectorOf<T extends Source>(t: T): Selector<T> {
  return newSelectorProxy(t);
}
