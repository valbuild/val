import {
  Selector as UnknownSelector,
  SelectorC,
  SelectorOf,
  SelectorSource,
} from ".";
import { Source } from "../Source";

// TODO: docs
export type Selector<T extends boolean> = SelectorC<T>;
