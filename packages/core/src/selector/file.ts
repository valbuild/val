import { Selector as UnknownSelector, GenericSelector } from "./index";

// TODO: docs
export type FileSelector = GenericSelector<{ url: string }> & {
  readonly url: UnknownSelector<string>;
};
